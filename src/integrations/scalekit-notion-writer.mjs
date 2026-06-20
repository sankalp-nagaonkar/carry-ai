import fs from 'node:fs';
import path from 'node:path';
import { ScalekitClient } from '@scalekit-sdk/node';

export class ScalekitNotionWriter {
  constructor(config) {
    this.config = config;
    const envUrlName = config.app.scalekit?.environment_url_env || 'SCALEKIT_ENVIRONMENT_URL';
    const envUrl = process.env[envUrlName] || process.env.SCALEKIT_ENV_URL;
    this.client = new ScalekitClient(
      envUrl,
      process.env[config.app.scalekit?.client_id_env || 'SCALEKIT_CLIENT_ID'],
      process.env[config.app.scalekit?.client_secret_env || 'SCALEKIT_CLIENT_SECRET'],
    );
    this.identifier = process.env.DEMO_USER_ID || 'demo_user';
    this.connector = process.env[config.app.tools?.notion?.connection_name_env || 'NOTION_CONNECTION_NAME'];
    this.parentPageId = config.profession.tools?.notion?.parent_page_id;
  }

  async createDoctorVisitPage({ sessionId, output, patientName = 'Patient', visitAt = new Date() }) {
    if (!this.connector) throw new Error('Missing Notion connection name env');
    if (!this.parentPageId) throw new Error('Missing doctor Notion parent_page_id in config');

    const patientPage = await this.getOrCreatePatientPage(patientName);
    if (!patientPage?.id) throw new Error(`Could not resolve Notion patient page for ${patientName}`);

    const title = `${formatHumanDateTime(visitAt)} Visit Note`;
    const markdown = doctorOutputToMarkdown({ output, sessionId, patientName, visitAt });
    const result = await this.createNotionPage({ parentPageId: patientPage.id, title });
    if (!result?.id) throw new Error(`Notion visit page was created but no page id was returned for ${title}`);
    await this.appendNotionBlocks({ blockId: result.id, blocks: markdownToNotionBlocks(markdown) });
    return { ...result, patientPage, markdownTitle: title };
  }

  async getOrCreatePatientPage(patientName) {
    const registry = this.readPatientRegistry();
    const registryKey = `${this.parentPageId}:${patientName.toLowerCase()}`;
    if (registry[registryKey]) {
      const cached = await this.validatePatientPage(registry[registryKey], patientName).catch(() => null);
      if (cached?.id) return { ...cached, source: 'local_registry' };
      delete registry[registryKey];
      this.writePatientRegistry(registry);
    }

    const found = await this.findPatientPage(patientName).catch(() => null);
    if (found?.id) {
      registry[registryKey] = normalizeNotionId(found.id);
      this.writePatientRegistry(registry);
      return { ...found, source: 'notion_search' };
    }

    const created = await this.createNotionPage({ parentPageId: this.parentPageId, title: patientName });
    if (!created.id) throw new Error(`Notion patient page was created but no page id was returned for ${patientName}`);
    await this.appendNotionBlocks({
      blockId: created.id,
      blocks: [{ type: 'paragraph', text: 'Carry patient record. Visit notes appear as timestamped subpages.' }],
    });
    registry[registryKey] = normalizeNotionId(created.id);
    this.writePatientRegistry(registry);
    return { id: normalizeNotionId(created.id), title: patientName, source: 'created' };
  }

  async validatePatientPage(pageId, patientName) {
    const result = await this.client.actions.executeTool({
      toolName: 'notion_page_get',
      identifier: this.identifier,
      connector: this.connector,
      toolInput: { page_id: normalizeNotionId(pageId) },
    });
    const title = notionTitle(result.data);
    const parentPageId = notionParentPageId(result.data);
    if (title?.trim().toLowerCase() !== patientName.trim().toLowerCase()) return null;
    if (normalizeNotionId(parentPageId) !== normalizeNotionId(this.parentPageId)) return null;
    return { id: normalizeNotionId(pageId), title, parentPageId: normalizeNotionId(parentPageId) };
  }

  async findPatientPage(patientName) {
    let lastError;
    for (const toolName of ['notion_data_fetch', 'notion_search', 'notion_page_search']) {
      try {
        const result = await this.client.actions.executeTool({
          toolName,
          identifier: this.identifier,
          connector: this.connector,
          toolInput: { query: patientName, page_size: 10 },
        });
        const candidates = extractNotionSearchResults(result.data)
          .filter((p) => p.title?.trim().toLowerCase() === patientName.trim().toLowerCase() && p.id);
        for (const candidate of candidates) {
          const validated = await this.validatePatientPage(candidate.id, patientName).catch(() => null);
          if (validated?.id) return validated;
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  async createNotionPage({ parentPageId, title, blocks = null }) {
    if (!parentPageId) throw new Error(`Cannot create Notion page "${title}" without a parent page id`);
    const toolInput = {
      parent_page_id: normalizeNotionId(parentPageId),
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
    };
    if (blocks?.length) toolInput.child_blocks = blocks;

    const result = await this.client.actions.executeTool({
      toolName: 'notion_page_create',
      identifier: this.identifier,
      connector: this.connector,
      toolInput,
    });
    return normalizeCreatedPage(result.data);
  }

  async appendNotionBlocks({ blockId, blocks }) {
    if (!blockId) throw new Error('Cannot append Notion blocks without a page or block id');
    if (!blocks?.length) return null;
    const result = await this.client.actions.executeTool({
      toolName: 'notion_page_content_append',
      identifier: this.identifier,
      connector: this.connector,
      toolInput: {
        block_id: normalizeNotionId(blockId),
        blocks,
      },
    });
    return result.data;
  }

  registryPath() {
    return path.join(this.config.rootDir || process.cwd(), 'data', 'notion-patient-pages.json');
  }

  readPatientRegistry() {
    try { return JSON.parse(fs.readFileSync(this.registryPath(), 'utf8')); } catch { return {}; }
  }

  writePatientRegistry(registry) {
    const file = this.registryPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(registry, null, 2));
  }

  async createLawyerMatterPage({ sessionId, output }) {
    if (!this.connector) throw new Error('Missing Notion connection name env');
    if (!this.parentPageId) throw new Error('Missing lawyer Notion parent_page_id in config');

    const title = `Carry Matter Memo Draft - ${new Date().toISOString().slice(0, 10)} - ${sessionId.slice(0, 8)}`;
    const blocks = lawyerOutputToBlocks(output);
    const result = await this.client.actions.executeTool({
      toolName: 'notion_page_create',
      identifier: this.identifier,
      connector: this.connector,
      toolInput: {
        parent_page_id: this.parentPageId,
        properties: {
          title: { title: [{ text: { content: title } }] },
        },
        child_blocks: blocks,
      },
    });
    return result.data;
  }
}

function extractNotionSearchResults(data) {
  const raw = data?.results || data?.pages || data?.objects || data?.data?.results || data?.result?.results || (Array.isArray(data) ? data : []);
  return raw.map((page) => ({ id: extractPageId(page), title: notionTitle(page) })).filter((p) => p.id || p.title);
}

function notionTitle(page) {
  const propTitle = page?.properties?.title?.title || page?.properties?.Name?.title || page?.properties?.name?.title;
  if (Array.isArray(propTitle)) return propTitle.map((x) => x.plain_text || x.text?.content || '').join('');
  return page?.title || page?.name || page?.properties?.title || '';
}

function notionParentPageId(page, depth = 0) {
  if (!page || typeof page !== 'object' || depth > 4) return null;
  const parent = page.parent;
  if (parent?.page_id || parent?.pageId) return parent.page_id || parent.pageId;
  for (const key of ['page', 'data', 'result', 'object']) {
    const found = notionParentPageId(page[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeCreatedPage(data) {
  const id = extractPageId(data);
  const url = data?.url || data?.page?.url || data?.data?.url || data?.result?.url;
  return {
    ...(data || {}),
    id: id ? normalizeNotionId(id) : undefined,
    url,
  };
}

function extractPageId(data, depth = 0) {
  if (!data || depth > 4) return null;
  if (typeof data === 'string' && /^[0-9a-f-]{32,36}$/i.test(data)) return data;
  if (typeof data !== 'object') return null;
  const direct = data.id || data.page_id || data.pageId;
  if (direct) return direct;
  for (const key of ['page', 'data', 'result', 'object']) {
    const found = extractPageId(data[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeNotionId(id) {
  const value = String(id || '').trim();
  const compact = value.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(compact)) {
    return [compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16), compact.slice(16, 20), compact.slice(20)].join('-');
  }
  return value;
}

function formatHumanDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

function markdownToNotionBlocks(markdown) {
  const lines = String(markdown || '').split('\n');
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    blocks.push(...chunkString(text, 1800).map((content) => notionBlock('paragraph', content)));
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { flushParagraph(); continue; }
    if (line.trim() === '---') { flushParagraph(); blocks.push({ type: 'divider' }); continue; }

    const h3 = line.match(/^###\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/);

    if (h3) { flushParagraph(); blocks.push(notionBlock('heading_3', h3[1])); continue; }
    if (h2) { flushParagraph(); blocks.push(notionBlock('heading_2', h2[1])); continue; }
    if (h1) { flushParagraph(); blocks.push(notionBlock('heading_1', h1[1])); continue; }
    if (bullet) { flushParagraph(); blocks.push(notionBlock('bulleted_list_item', bullet[1])); continue; }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks.slice(0, 90);
}

function notionBlock(type, content) {
  return { type, text: String(content || '').slice(0, 1900) };
}

function chunkString(text, size) {
  const src = String(text || '');
  const out = [];
  for (let i = 0; i < src.length; i += size) out.push(src.slice(i, i + size));
  return out.length ? out : [''];
}

function listText(value) {
  if (!value) return '';
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(summaryText).filter(Boolean).join('; ');
}

function summaryText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(summaryText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        const text = summaryText(v);
        return ['value', 'draft', 'description', 'details', 'medication', 'reason', 'evidence'].includes(k) ? text : `${humanize(k)}: ${text}`;
      })
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

function humanize(key) {
  return String(key || '').replace(/_/g, ' ');
}

function doctorOutputToMarkdown({ output, sessionId, patientName, visitAt }) {
  const soap = output.soap_note || {};
  const facts = output.clinical_facts || {};
  const meds = output.medication_decision_tracking || {};
  const safety = output.safety_flags || {};
  const follow = output.follow_up_plan || {};
  const codes = output.icd10_suggestions || [];
  const missing = output.missing_information || [];

  return [
    `# Carry Visit Note`,
    ``,
    `- Patient: ${patientName}`,
    `- Visit time: ${formatHumanDateTime(visitAt)}`,
    `- Session: ${sessionId}`,
    `- Status: ${output.status || 'draft_requires_clinician_review'}`,
    `- Review: clinician review required`,
    ``,
    `## SOAP Note`,
    ``,
    `### Subjective`,
    summaryText(soap.subjective) || 'Not discussed in transcript',
    ``,
    `### Objective`,
    summaryText(soap.objective) || 'Not discussed in transcript',
    ``,
    `### Assessment`,
    summaryText(soap.assessment) || 'Draft assessment requires clinician review',
    ``,
    `### Plan`,
    summaryText(soap.plan) || 'Not discussed in transcript',
    ``,
    `## Clinical Facts`,
    ``,
    `- Chief complaint: ${summaryText(facts.chief_complaint) || 'Not discussed in transcript'}`,
    `- History: ${summaryText(facts.history_of_present_illness) || 'Not discussed in transcript'}`,
    `- Positive symptoms: ${listText(facts.positive_symptoms) || 'None captured'}`,
    `- Negative symptoms: ${listText(facts.negative_symptoms) || 'None captured'}`,
    `- Allergies: ${summaryText(facts.allergies) || 'Not discussed in transcript'}`,
    ``,
    `## Medication Decision Tracking`,
    ``,
    `- Initially proposed: ${listText(meds.initially_proposed) || 'None'}`,
    `- Allergy or contraindication discovered: ${listText(meds.allergy_or_contraindication_discovered) || 'None'}`,
    `- Cancelled or avoided: ${listText(meds.cancelled_or_avoided) || 'None'}`,
    `- Final stated plan: ${listText(meds.final_stated_plan) || 'None'}`,
    ``,
    `## Safety`,
    ``,
    `- Present: ${listText(safety.red_flags_present) || 'None captured'}`,
    `- Denied: ${listText(safety.red_flags_denied) || 'None captured'}`,
    `- Not assessed: ${listText(safety.red_flags_not_assessed) || 'None captured'}`,
    `- Note: ${safety.safety_note || 'None'}`,
    ``,
    `## Missing Information`,
    ``,
    missing.length ? missing.map((x) => `- ${x.field || 'Field'}: ${x.reason || x.importance || ''}`).join('\n') : '- None captured',
    ``,
    `## ICD-10 Suggestions`,
    ``,
    codes.length ? codes.map((x) => `- ${x.code || ''} ${x.description || ''} (${x.confidence ?? 'review'})`).join('\n') : '- None suggested',
    ``,
    `## Follow-up Plan`,
    ``,
    `- Needed: ${follow.needed === false ? 'No' : 'Yes or review'}`,
    `- Timeframe: ${follow.timeframe_text || 'Not discussed in transcript'}`,
    `- Reason: ${follow.reason || 'Not discussed in transcript'}`,
    ``,
    `## Patient Summary Draft`,
    ``,
    output.patient_summary?.draft || 'No patient summary drafted',
    ``,
    `---`,
    `Generated by Carry. Clinician review required before relying on this note.`,
  ].join('\n');
}

function doctorOutputToBlocks(output) {
  const blocks = [];
  const add = (type, text) => blocks.push({ object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content: String(text || '') } }] } });
  const addPara = (text) => add('paragraph', text);
  const addH2 = (text) => add('heading_2', text);
  const addH3 = (text) => add('heading_3', text);

  addH2('Status');
  addPara(output.status || 'draft_requires_review');

  addH2('Speaker Role Inference');
  addPara(JSON.stringify(output.speaker_role_inference || {}, null, 2));

  addH2('SOAP Note Draft');
  addH3('Subjective');
  addPara(JSON.stringify(output.soap_note?.subjective || {}, null, 2));
  addH3('Objective');
  addPara(JSON.stringify(output.soap_note?.objective || {}, null, 2));
  addH3('Assessment');
  addPara(JSON.stringify(output.soap_note?.assessment || {}, null, 2));
  addH3('Plan');
  addPara(JSON.stringify(output.soap_note?.plan || {}, null, 2));

  addH2('Missing Information');
  addPara((output.missing_information || []).map((x) => `- ${x.field}: ${x.reason}`).join('\n') || 'None');

  addH2('Safety Flags');
  addPara(JSON.stringify(output.safety_flags || {}, null, 2));

  addH2('ICD-10 Suggestions');
  addPara((output.icd10_suggestions || []).map((x) => `- ${x.code} ${x.description} (${x.confidence})`).join('\n') || 'None');

  addH2('Patient Summary Draft');
  addPara(output.patient_summary?.draft || 'None');

  addH2('Follow-up Plan');
  addPara(JSON.stringify(output.follow_up_plan || {}, null, 2));

  return blocks;
}

function lawyerOutputToBlocks(output) {
  const blocks = [];
  const add = (type, text) => blocks.push({ object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content: String(text || '') } }] } });
  const addPara = (text) => add('paragraph', text);
  const addH2 = (text) => add('heading_2', text);
  const addH3 = (text) => add('heading_3', text);
  const memo = output.matter_memo || {};

  addH2('Status');
  addPara(output.status || 'draft_requires_attorney_review');

  addH2('Matter Memo Draft');
  addH3('Summary');
  addPara(memo.summary?.draft || 'None');
  addH3('Facts');
  addPara(memo.facts?.draft || 'None');
  addH3('Issues');
  addPara(memo.issues?.draft || 'None');
  addH3('Analysis');
  addPara(memo.analysis?.draft || 'None');
  addH3('Next Steps');
  addPara(memo.next_steps?.draft || 'None');

  addH2('Issue Spotting');
  addPara((output.issue_spotting || []).map((x) => `- ${x.issue} (${x.strength})`).join('\n') || 'None');

  addH2('Deadline Tracking');
  addPara(JSON.stringify(output.deadline_tracking || {}, null, 2));

  addH2('Conflict Screen');
  addPara(JSON.stringify(output.conflict_screen || {}, null, 2));

  addH2('Next Steps');
  addPara((output.next_steps || []).map((x) => `- ${x.step} (${x.owner}, ${x.due_text || 'no due date'})`).join('\n') || 'None');

  addH2('Client Summary Draft');
  addPara(output.client_summary?.draft || 'None');

  return blocks;
}