import { loadConfig } from '../src/config/config-loader.mjs';
import { ScalekitNotionWriter } from '../src/integrations/scalekit-notion-writer.mjs';

const config = loadConfig({ profession: 'doctor' });
const writer = new ScalekitNotionWriter(config);
const calls = [];
writer.client = {
  actions: {
    executeTool: async (call) => {
      calls.push(call);
      if (call.toolName === 'notion_page_content_append') return { data: { ok: true } };
      const title = call.toolInput.properties.title.title[0].text.content;
      return { data: { id: 'visit-page-id', url: `https://notion.local/${encodeURIComponent(title)}` } };
    },
  },
};

const output = {
  status: 'draft_requires_clinician_review',
  soap_note: {
    subjective: { chief_complaint: 'Sore throat' },
    objective: { value: 'Not discussed' },
    assessment: { draft_impression: 'Draft assessment' },
    plan: { treatment: 'Supportive care' },
  },
  clinical_facts: { chief_complaint: { value: 'Sore throat' }, positive_symptoms: ['fever'], negative_symptoms: ['cough denied'] },
  medication_decision_tracking: {},
  safety_flags: {},
  missing_information: [],
  icd10_suggestions: [],
  follow_up_plan: {},
  patient_summary: { draft: 'Draft summary' },
};

await writer.createDoctorVisitPage({ sessionId: 'mock-session', output, patientName: 'Sam Altman', visitAt: new Date('2026-06-20T21:14:00') });
const creates = calls.filter((c) => c.toolName === 'notion_page_create');
const appends = calls.filter((c) => c.toolName === 'notion_page_content_append');
const visitCreate = creates[0].toolInput;
const visitAppend = appends.find((c) => c.toolInput.block_id === 'visit-page-id').toolInput;
console.log(JSON.stringify({
  createCount: creates.length,
  visitParent: visitCreate.parent_page_id,
  visitTitle: visitCreate.properties.title.title[0].text.content,
  appendTarget: visitAppend.block_id,
  blockTypes: visitAppend.blocks.slice(0, 8).map((b) => b.type),
  firstBlocks: visitAppend.blocks.slice(0, 8),
}, null, 2));
if (creates.length !== 1) throw new Error(`expected exactly one Notion page create, got ${creates.length}`);
if (visitCreate.parent_page_id !== '385ed79b-5001-801c-bc50-d4dcae27c1ee') throw new Error('visit page not created under configured root page');
if (visitCreate.properties.title.title[0].text.content !== 'Sam Altman - Jun 20, 2026, 9:14 PM Visit Note') throw new Error('visit title does not include patient name and date');
if (visitCreate.child_blocks) throw new Error('visit page should not receive raw child_blocks during create');
if (!visitAppend.blocks.some((b) => b.type === 'heading_1')) throw new Error('markdown did not render to heading blocks');
if (!visitAppend.blocks.some((b) => b.type === 'bulleted_list_item')) throw new Error('markdown did not render to bullet blocks');
if (visitAppend.blocks.some((b) => String(b.text || '').startsWith('##'))) throw new Error('raw markdown heading leaked into Notion text');
