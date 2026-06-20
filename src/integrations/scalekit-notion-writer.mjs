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

  async createDoctorVisitPage({ sessionId, output }) {
    if (!this.connector) throw new Error('Missing Notion connection name env');
    if (!this.parentPageId) throw new Error('Missing doctor Notion parent_page_id in config');

    const title = `Carry Doctor Visit Draft - ${new Date().toISOString().slice(0, 10)} - ${sessionId.slice(0, 8)}`;
    const blocks = doctorOutputToBlocks(output);
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