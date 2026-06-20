// Static scaffolding only. The patient identity and the ambient day schedule are
// clinic-owned context. Everything clinical (allergies, medications, conditions,
// symptoms, timeline, knowledge graph) is built live from backend memory as visits
// happen. There is no seeded clinical data here on purpose.

export const PATIENT = {
  id: 'patient_demo_001',
  name: 'Anaya Mehta',
  initials: 'AM',
  age: 34,
  sex: 'Female',
  mrn: 'MRN-4821',
  pronouns: 'she/her',
  primaryDoctor: 'Dr. Rao',
};

// Ambient schedule for the day. Anaya is the live slot; the rest are context.
export const OTHER_APPOINTMENTS = [
  { id: 'a2', time: '10:15', name: 'Marcus Hill', reason: 'Hypertension review', status: 'scheduled' },
  { id: 'a3', time: '11:00', name: 'Lena Park', reason: 'Post-op follow-up', status: 'scheduled' },
  { id: 'a4', time: '11:45', name: 'David Osei', reason: 'Lab results review', status: 'scheduled' },
];

// Scenario framing for the next visit. Agenda hints are clinician prompts, not data.
export const SCENARIOS = {
  visit1: {
    label: 'First consult',
    badge: 'New patient',
    reason: 'Nasal congestion, seasonal',
    agenda: [
      'Characterize congestion and seasonal pattern',
      'Capture any medication allergies',
      'Decide on symptomatic treatment',
    ],
  },
  visit2: {
    label: 'Return visit',
    badge: 'Returning patient',
    reason: 'Sore throat, fever',
    agenda: [
      'Characterize current sore throat and fever',
      'Confirm known allergies before any antibiotic',
      'Assess need for rapid strep testing',
    ],
  },
};
