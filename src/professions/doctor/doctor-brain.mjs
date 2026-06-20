import { readPrompt } from '../../config/config-loader.mjs';

export class DoctorBrain {
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
    this.store.audit({ sessionId, eventType: 'doctor_incremental_pass_completed', payload: { chunks: chunks.length } });
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
      patient_context: {
        existing_memory: memory,
      },
      sanitized_transcript: transcript,
    }, null, 2);

    const output = await this.llm.completeJson({ system, user });
    this.store.saveOutput({ sessionId, passType: 'final', output });
    if (this.config.app.memory?.enabled && this.config.profession.memory?.enabled) {
      const safeItems = this.filterMemoryUpdates(output.memory_updates || []);
      output.memory_updates = safeItems;
      this.store.saveMemoryItems({ session, items: safeItems });
    }
    this.store.audit({ sessionId, eventType: 'doctor_final_pass_completed', payload: { artifactKeys: Object.keys(output || {}) } });
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
    'email', 'address', 'dob', 'date_of_birth', 'mrn', 'medical_record_number',
    'patient_identifier', 'identifier'
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
