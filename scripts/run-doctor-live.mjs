import 'dotenv/config';
import { CarryBackend } from '../src/core/carry-backend.mjs';
import { getDoctorScenario, streamChunks } from '../src/simulators/doctor-transcript-simulator.mjs';
import { ScalekitNotionWriter } from '../src/integrations/scalekit-notion-writer.mjs';

const args = new Set(process.argv.slice(2));
const writeNotion = args.has('--notion');
const safeDisplay = args.has('--safe-display');
const delayMs = Number(process.env.SIM_DELAY_MS || 1500);
const scenario = process.env.DOCTOR_SCENARIO || (args.has('--med-change') ? 'med_change' : 'default');

const carry = new CarryBackend({ profession: 'doctor' });
const minChunks = carry.config.app.processing?.min_new_chunks_for_incremental_pass || 4;

const session = carry.createSession({
  profession: 'doctor',
  entityType: 'patient',
  entityId: 'patient_demo_001',
  source: 'live_simulator',
  metadata: { encounter_type: 'outpatient_visit', demo: true },
});

banner('Carry Doctor Mode - Live Streaming Demo');
console.log(`Session: ${session.session_id}`);
console.log(`Entity:  ${session.entity_type}:${session.entity_id}`);
console.log(`Privacy: ${carry.config.app.privacy?.enabled ? 'ON' : 'OFF'}`);
console.log(`Scenario: ${scenario}`);
console.log(`Incremental pass every ${minChunks} new chunks + debounce simulation`);
console.log('');

let chunksSincePass = 0;
let incrementalCount = 0;

await streamChunks(getDoctorScenario(scenario), async (chunk) => {
  const result = carry.ingestChunk({ sessionId: session.session_id, ...chunk });
  chunksSincePass++;

  console.log(`🟦 ${chunk.chunkId} ${chunk.speaker}`);
  console.log(`   incoming:  ${safeDisplay ? redactForDisplay(chunk.text, result.redactions) : chunk.text}`);
  console.log(`   sanitized: ${result.sanitizedText}`);
  if (result.redactions.length) {
    console.log(`   privacy:   ${result.redactions.map((r) => `${r.label} → ${r.placeholder}`).join(', ')}`);
  }
  console.log('');

  if (chunksSincePass >= minChunks) {
    incrementalCount++;
    banner(`Incremental DoctorBrain Pass #${incrementalCount}`);
    const draft = await carry.processIncremental(session.session_id);
    printIncremental(draft);
    chunksSincePass = 0;
  }
}, { delayMs });

banner('Conversation ended → Final DoctorBrain Pass');
const finalOutput = await carry.endSession(session.session_id, 'live_simulator_completed');
printFinal(finalOutput);

if (writeNotion) {
  banner('Writing final draft to Notion via Scalekit');
  const writer = new ScalekitNotionWriter(carry.config);
  const page = await writer.createDoctorVisitPage({ sessionId: session.session_id, output: finalOutput });
  console.log('✅ Notion page created:', page.url || page.id);
}

banner('Done');
console.log(`SQLite DB: ${carry.config.app.storage.sqlite_path}`);

function redactForDisplay(text, redactions = []) {
  let out = text;
  for (const r of [...redactions].sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(r.value).join(r.placeholder);
  }
  return out;
}

function banner(text) {
  console.log('\n' + '═'.repeat(80));
  console.log(text);
  console.log('═'.repeat(80));
}

function printIncremental(draft) {
  console.log('Current likely speakers:');
  for (const [speaker, info] of Object.entries(draft.speaker_role_inference || {})) {
    console.log(`  ${speaker}: ${info.role} (${info.confidence}) - ${info.reason}`);
  }
  const facts = draft.emerging_facts || {};
  console.log('\nEmerging facts:');
  console.log(`  Chief complaint: ${facts.chief_complaint}`);
  console.log(`  Duration:        ${facts.duration}`);
  console.log(`  Positive:        ${(facts.positive_symptoms || []).join(', ') || 'none yet'}`);
  console.log(`  Negative:        ${(facts.negative_symptoms || []).join(', ') || 'none yet'}`);
  console.log(`  Allergies:       ${facts.allergies}`);
  console.log(`  Medications:     ${(facts.medications_mentioned || []).map((m) => typeof m === 'string' ? m : JSON.stringify(m)).join(', ') || 'none yet'}`);

  const fu = draft.follow_up_tracking || {};
  const med = draft.medication_decision_tracking || {};
  console.log('\nMedication decision tracking:');
  console.log(`  Initially proposed: ${(med.initially_proposed || []).map(formatMaybeObject).join('; ') || 'none yet'}`);
  console.log(`  Allergy/contra:     ${(med.allergy_or_contraindication_discovered || []).map(formatMaybeObject).join('; ') || 'none yet'}`);
  console.log(`  Cancelled/avoided:  ${(med.cancelled_or_avoided || []).map(formatMaybeObject).join('; ') || 'none yet'}`);
  console.log(`  Current plan:       ${(med.current_plan || []).map(formatMaybeObject).join('; ') || 'none yet'}`);

  console.log('\nFollow-up tracking:');
  console.log(`  Mentioned: ${fu.mentioned}`);
  if (fu.timeframe_text) console.log(`  Timeframe: ${fu.timeframe_text}`);
  if (fu.inferred_date_or_offset) console.log(`  Inferred:  ${fu.inferred_date_or_offset} (${fu.basis})`);

  console.log('\nMissing info so far:');
  for (const item of (draft.missing_information_so_far || []).slice(0, 5)) {
    console.log(`  - ${item.field}: ${item.reason}`);
  }
  console.log('\nRunning summary:');
  console.log(`  ${draft.running_summary || ''}`);
}

function formatMaybeObject(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function printFinal(output) {
  console.log('Final status:', output.status);
  console.log('\nSOAP draft:');
  console.log(JSON.stringify(output.soap_note, null, 2));
  console.log('\nMissing information:');
  for (const item of output.missing_information || []) console.log(`  - [${item.importance}] ${item.field}: ${item.reason}`);
  console.log('\nSafety flags:');
  console.log(JSON.stringify(output.safety_flags, null, 2));
  console.log('\nICD-10 suggestions:');
  for (const x of output.icd10_suggestions || []) console.log(`  - ${x.code}: ${x.description} (${x.confidence})`);
  console.log('\nMedication decision tracking:');
  console.log(JSON.stringify(output.medication_decision_tracking || {}, null, 2));
  console.log('\nMedication / prescription drafts:');
  console.log(JSON.stringify(output.medication_or_prescription_drafts || [], null, 2));
  console.log('\nFollow-up plan:');
  console.log(JSON.stringify(output.follow_up_plan, null, 2));
  console.log('\nMemory updates stored/proposed:');
  for (const x of output.memory_updates || []) console.log(`  - ${x.type}: ${JSON.stringify(x.value)} store=${x.store}`);
  console.log('\nAction plan:');
  for (const x of output.action_plan || []) console.log(`  - ${x.tool}.${x.operation}: ${x.description} risk=${x.risk}`);
}
