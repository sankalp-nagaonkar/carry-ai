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

export const REAL_PATIENT = {
  id: 'patient_real_sam_altman',
  name: 'Sam Altman',
  initials: 'SA',
  age: 41,
  sex: 'Male',
  mrn: 'MRN-1001',
  pronouns: 'he/him',
  primaryDoctor: 'Dr. Rao',
};

// Ambient schedule for the simulated day. Anaya is the live slot; the rest are context.
export const OTHER_APPOINTMENTS = [
  { id: 'a2', time: '10:15', name: 'Marcus Hill', reason: 'Hypertension review', status: 'scheduled' },
  { id: 'a3', time: '11:00', name: 'Lena Park', reason: 'Post-op follow-up', status: 'scheduled' },
  { id: 'a4', time: '11:45', name: 'David Osei', reason: 'Lab results review', status: 'scheduled' },
];

export const REAL_APPOINTMENTS = [
  { id: 'r2', time: '10:15', name: 'Mira Patel', reason: 'Annual check-in', status: 'scheduled' },
  { id: 'r3', time: '11:00', name: 'Jon Bell', reason: 'Respiratory symptoms', status: 'scheduled' },
  { id: 'r4', time: '11:45', name: 'Eva Chen', reason: 'Medication review', status: 'scheduled' },
];

// Scenario framing for the simulated visits. Agenda hints are clinician prompts, not data.
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

export const REAL_SCENARIO = {
  label: 'Live transcript',
  badge: 'Live transcript',
  reason: 'Live clinical conversation',
  agenda: [
    'Confirm identity and reason for visit verbally',
    'Let Carry redact identifiers before processing',
    'End the visit manually when the conversation is complete',
  ],
};
