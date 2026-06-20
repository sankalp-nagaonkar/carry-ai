// Static scaffolding only. Matter identity and the ambient day schedule are
// firm-owned context. Every legal fact, deadline, party, issue, timeline item,
// and graph node is built live from backend memory as meetings happen.

export const MATTER = {
  id: 'matter_demo_001',
  clientLabel: 'Employment client',
  initials: 'EC',
  matterNumber: 'MAT-1042',
  attorney: 'Maya Chen',
  firm: 'Northstar Legal',
  practice: 'Employment',
};

export const OTHER_MEETINGS = [
  { id: 'm2', time: '10:30', name: 'Lease review', reason: 'Commercial lease redlines', status: 'scheduled' },
  { id: 'm3', time: '11:15', name: 'Founder call', reason: 'SAFE note questions', status: 'scheduled' },
  { id: 'm4', time: '12:00', name: 'Demand letter', reason: 'Construction dispute', status: 'scheduled' },
];

export const SCENARIOS = {
  meeting1: {
    label: 'Intake',
    badge: 'New matter',
    reason: 'Unfair dismissal intake',
    agenda: [
      'Capture dismissal date and employer name',
      'Identify potential claims and parties',
      'Open conflict check and document request',
    ],
  },
  meeting2: {
    label: 'Strategy',
    badge: 'Returning matter',
    reason: 'Deadline and claim strategy',
    agenda: [
      'Confirm limitation deadline from prior intake',
      'Resolve filing timeline before the deadline',
      'Prepare Acas notification and draft claim',
    ],
  },
};
