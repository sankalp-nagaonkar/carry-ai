import { readPrompt } from '../../config/config-loader.mjs';

export class LawyerBrain {
  constructor({ config, llm, store }) {
    this.config = config;
    this.llm = llm;
    this.store = store;
  }

  async incrementalPass(sessionId) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const chunks = this.store.listChunks(sessionId);
    const transcript = chunks.map((c) => `${c.speaker_id} (${c.source_speaker_label}): ${c.sanitized_text}`).join('\n');
    const memory = this.getSafeMemoryForLlm(session, 10);
    const system = readPrompt(this.config, 'incremental_pass');
    const user = JSON.stringify({
      session: {
        session_id: session.session_id,
        profession: session.profession,
        entity_type: session.entity_type,
        entity_id: session.entity_id,
        source: session.source,
        metadata: safeJson(session.metadata_json),
      },
      existing_memory: memory,
      partial_sanitized_transcript: transcript,
    }, null, 2);

    const output = await this.llm.completeJson({ system, user, maxTokens: 3500 });
    this.store.saveOutput({ sessionId, passType: 'incremental', output });
    this.store.audit({ sessionId, eventType: 'lawyer_incremental_pass_completed', payload: { chunks: chunks.length } });
    return output;
  }

  async finalPass(sessionId) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const chunks = this.store.listChunks(sessionId);
    const transcript = chunks.map((c) => `${c.speaker_id} (${c.source_speaker_label}): ${c.sanitized_text}`).join('\n');
    const memory = this.getSafeMemoryForLlm(session, 20);
    const system = readPrompt(this.config, 'final_pass');
    const user = JSON.stringify({
      session: {
        session_id: session.session_id,
        profession: session.profession,
        entity_type: session.entity_type,
        entity_id: session.entity_id,
        source: session.source,
        metadata: safeJson(session.metadata_json),
      },
      matter_context: {
        existing_memory: memory,
      },
      sanitized_transcript: transcript,
    }, null, 2);

    let output;
    try {
      output = await this.llm.completeJson({ system, user });
    } catch (error) {
      output = fallbackFinalOutput({ transcript, memory, error });
    }
    this.store.saveOutput({ sessionId, passType: 'final', output });
    if (this.config.app.memory?.enabled && this.config.profession.memory?.enabled) {
      const safeItems = this.filterMemoryUpdates(output.memory_updates || []);
      output.memory_updates = safeItems;
      this.store.saveMemoryItems({ session, items: safeItems });
    }
    this.store.audit({ sessionId, eventType: 'lawyer_final_pass_completed', payload: { artifactKeys: Object.keys(output || {}) } });
    return output;
  }

  getSafeMemoryForLlm(session, limit) {
    const blocked = new Set(this.config.profession.memory?.blocked_types || []);
    const rows = this.store.listMemoryItems({
      profession: session.profession,
      entityType: session.entity_type,
      entityId: session.entity_id,
      limit,
    });
    return rows
      .filter((item) => !blocked.has(item.type))
      .map((item) => ({
        memory_id: item.memory_id,
        type: item.type,
        value: scrubPrivateFields(item.value),
        confidence: item.confidence,
        created_at: item.created_at,
      }));
  }

  filterMemoryUpdates(items) {
    const blocked = new Set(this.config.profession.memory?.blocked_types || []);
    const allowed = new Set(this.config.profession.memory?.allowed_types || []);
    return items
      .filter((item) => item && item.store !== false)
      .filter((item) => item.type && !blocked.has(item.type))
      .filter((item) => allowed.size === 0 || allowed.has(item.type))
      .map((item) => ({
        ...item,
        value: scrubPrivateFields(item.value ?? {}),
        store: true,
      }));
  }
}

function safeJson(value) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function scrubPrivateFields(value) {
  if (Array.isArray(value)) return value.map(scrubPrivateFields);
  if (!value || typeof value !== 'object') return scrubPrivateString(value);

  const blockedKeys = new Set([
    'name', 'full_name', 'first_name', 'last_name', 'phone', 'phone_number',
    'email', 'address', 'dob', 'date_of_birth', 'client_identifier', 'identifier'
  ]);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (blockedKeys.has(key.toLowerCase())) continue;
    out[key] = scrubPrivateFields(val);
  }
  return out;
}

function scrubPrivateString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\[PRIVATE_(?:PERSON|PHONE|EMAIL|ADDRESS|DATE|URL|ACCOUNT_NUMBER|SECRET)_\d+\]/g, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE]');
}

function fallbackFinalOutput({ transcript, memory, error }) {
  const lines = String(transcript || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const excerpt = lines.slice(-12).join(' ').replace(/\s+/g, ' ').slice(0, 900);
  const priorDeadlines = (memory || [])
    .filter((item) => item.type === 'deadline')
    .map((item) => item.value)
    .filter(Boolean)
    .slice(0, 5);

  return {
    profession: 'lawyer',
    workflow: 'client_meeting',
    status: 'draft_requires_attorney_review',
    processing_note: 'Automated legal drafting used a conservative fallback because the model response could not be parsed. Attorney review is required.',
    internal_error_type: error?.code || error?.name || 'final_pass_parse_error',
    speaker_role_inference: {},
    legal_facts: {
      matter_type: { value: 'not discussed in transcript', basis: 'not_discussed', evidence: [] },
      summary_of_facts: {
        value: excerpt || 'No transcript content was captured before the meeting was ended.',
        evidence: lines.slice(-3),
      },
      key_facts: excerpt ? [{ fact: excerpt, basis: 'explicit', evidence: lines.slice(-3), requires_review: true }] : [],
      parties: [],
      client_objectives: [],
      jurisdiction: { value: 'not discussed in transcript', evidence: [] },
    },
    matter_memo: {
      summary: { draft: excerpt || 'Meeting ended before a usable transcript was captured.', review_required: true },
      facts: { draft: excerpt || 'No facts captured.' },
      issues: { draft: 'Issue spotting was not completed. Attorney review required.' },
      analysis: { draft: 'Analysis was not completed because automated drafting could not produce a parseable structured response.', review_required: true },
      next_steps: { draft: 'Review the transcript, complete issue spotting, verify deadlines, and run the firm conflict process.' },
    },
    issue_spotting: [],
    deadline_tracking: {
      triggering_events: [],
      computed_deadlines: priorDeadlines.map((value) => ({
        deadline: value.deadline || value.due_text || value.value || 'deadline from matter memory',
        rule_basis: value.rule_basis || value.basis || 'from matter memory',
        due_text: value.due_text || value.deadline || value.value || '',
        urgency: value.urgency || 'medium',
        requires_verification: true,
        evidence: [],
      })),
      timing_conflicts: [],
      corrected_plan: [],
    },
    conflict_screen: {
      parties_to_check: [],
      note: 'Run the firm conflict process. This is a prompt, not a clearance.',
    },
    missing_information: [
      { field: 'structured legal memo', importance: 'high', reason: 'Automated final drafting could not produce parseable JSON.' },
      { field: 'deadline verification', importance: 'high', reason: 'Deadlines require attorney verification.' },
    ],
    next_steps: [
      { step: 'Review the captured transcript and complete the matter memo.', owner: 'attorney', due_text: '', requires_review: true },
      { step: 'Verify any limitation periods or filing deadlines before relying on the draft.', owner: 'attorney', due_text: '', requires_review: true },
    ],
    billing_summary: {
      activity: 'Client meeting review and draft preparation',
      estimated_time: 'not discussed in transcript',
      requires_review: true,
    },
    client_summary: {
      draft: 'Based on today\'s meeting, the attorney should review the captured transcript and confirm next steps.',
      requires_attorney_approval: true,
    },
    memory_updates: excerpt ? [
      {
        type: 'meeting_summary',
        value: { summary: excerpt, fallback: true },
        source: 'transcript',
        confidence: 0.4,
        store: true,
        reason: 'Fallback summary from sanitized transcript after model parse failure.',
      },
      {
        type: 'unresolved_question',
        value: { question: 'Attorney review required because automated final drafting could not parse the model response.' },
        source: 'system',
        confidence: 1,
        store: true,
        reason: 'Ensure follow-up review is visible in matter memory.',
      },
    ] : [],
    action_plan: [
      {
        action_id: 'review_fallback_memo',
        tool: 'none',
        operation: 'attorney_review',
        description: 'Review the fallback matter memo and transcript before taking any action.',
        requires_approval: true,
        risk: 'high',
        payload: {},
      },
    ],
  };
}
