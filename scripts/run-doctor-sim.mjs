import 'dotenv/config';
import { CarryBackend } from '../src/core/carry-backend.mjs';
import { doctorVisitOneChunks, streamChunks } from '../src/simulators/doctor-transcript-simulator.mjs';

const carry = new CarryBackend({ profession: 'doctor' });

const session = carry.createSession({
  profession: 'doctor',
  entityType: 'patient',
  entityId: 'patient_demo_001',
  source: 'simulator',
  metadata: { encounter_type: 'outpatient_visit', demo: true },
});

console.log('Created session:', session.session_id);

await streamChunks(doctorVisitOneChunks(), async (chunk) => {
  const result = carry.ingestChunk({ sessionId: session.session_id, ...chunk });
  console.log(`${result.chunkId}: ${result.sanitizedText}`);
  if (result.redactions.length) {
    console.log('  redactions:', result.redactions.map((r) => ({ label: r.label, placeholder: r.placeholder })));
  }
});

console.log('\nRunning final DoctorBrain pass...');
const output = await carry.endSession(session.session_id, 'simulator_completed');
console.log(JSON.stringify(output, null, 2));
