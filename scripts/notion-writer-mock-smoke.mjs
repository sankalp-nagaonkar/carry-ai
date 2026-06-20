import { loadConfig } from '../src/config/config-loader.mjs';
import { ScalekitNotionWriter } from '../src/integrations/scalekit-notion-writer.mjs';

const config = loadConfig({ profession: 'doctor' });
const writer = new ScalekitNotionWriter(config);
const calls = [];
writer.readPatientRegistry = () => ({});
writer.writePatientRegistry = () => {};
writer.client = {
  actions: {
    executeTool: async (call) => {
      calls.push(call);
      if (call.toolName.includes('search')) return { data: { results: [] } };
      const title = call.toolInput.properties.title.title[0].text.content;
      return { data: { id: title === 'Sam Altman' ? 'patient-page-id' : 'visit-page-id', url: `https://notion.local/${encodeURIComponent(title)}` } };
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
  safety_flags: {},
  missing_information: [],
  icd10_suggestions: [],
  follow_up_plan: {},
  patient_summary: { draft: 'Draft summary' },
};

await writer.createDoctorVisitPage({ sessionId: 'mock-session', output, patientName: 'Sam Altman', visitAt: new Date('2026-06-20T21:14:00') });
const creates = calls.filter((c) => c.toolName === 'notion_page_create');
const patientCreate = creates[0].toolInput;
const visitCreate = creates[1].toolInput;
console.log(JSON.stringify({
  patientParent: patientCreate.parent_page_id,
  patientTitle: patientCreate.properties.title.title[0].text.content,
  visitParent: visitCreate.parent_page_id,
  visitTitle: visitCreate.properties.title.title[0].text.content,
  blockTypes: visitCreate.child_blocks.slice(0, 8).map((b) => b.type),
}, null, 2));
if (visitCreate.parent_page_id !== 'patient-page-id') throw new Error('visit page not nested under patient page');
if (!visitCreate.child_blocks.some((b) => b.type === 'heading_1')) throw new Error('markdown did not render to heading blocks');
if (!visitCreate.child_blocks.some((b) => b.type === 'bulleted_list_item')) throw new Error('markdown did not render to bullet blocks');
