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

export const EXAMPLE_MATTERS = [
  {
    id: 'employment-dismissal',
    matterNumber: 'MAT-1042',
    title: 'Employment dismissal claim',
    client: 'Senior operations manager',
    practice: 'Employment litigation',
    stage: 'Pre-action',
    status: 'Deadline review',
    priority: 'high',
    owner: 'Maya Chen',
    court: 'Employment Tribunal',
    nextDeadline: 'Acas early conciliation deadline - 12 Jun',
    summary: 'Client alleges unfair dismissal after restructuring. Carry has captured the dismissal date, employer identity, requested remedy, and a proposed filing timeline that needs deadline verification.',
    facts: [
      'Dismissal occurred after performance concerns were raised informally.',
      'Client wants reinstatement considered, but compensation is the fallback objective.',
      'Employer name and HR contact have been captured for conflict screening.',
    ],
    issues: ['Unfair dismissal', 'Wrongful dismissal', 'Limitation period', 'Mitigation evidence'],
    actions: [
      { label: 'Verify limitation date', owner: 'Attorney', due: 'Today', status: 'urgent' },
      { label: 'Draft Acas notification', owner: 'Paralegal', due: '12 Jun', status: 'next' },
      { label: 'Request dismissal letter and contract', owner: 'Client', due: 'Open', status: 'waiting' },
    ],
    documents: ['Dismissal letter', 'Employment contract', 'Performance notes'],
  },
  {
    id: 'supplier-breach',
    matterNumber: 'LIT-2218',
    title: 'SaaS supplier breach dispute',
    client: 'Regional logistics company',
    practice: 'Commercial litigation',
    stage: 'Demand letter',
    status: 'Drafting',
    priority: 'medium',
    owner: 'Arjun Rao',
    court: 'High Court commercial list',
    nextDeadline: 'Preservation notice - 24 Jun',
    summary: 'Vendor outage and failed data export allegedly caused service credits and customer churn. The team is preparing a demand letter and litigation-hold package.',
    facts: [
      'Master services agreement includes uptime and export assistance obligations.',
      'Client reports three failed export attempts over a two-week period.',
      'Damages model needs finance review before any quantified demand.',
    ],
    issues: ['Breach of contract', 'Service credits', 'Data portability', 'Damages evidence'],
    actions: [
      { label: 'Finalize chronology', owner: 'Associate', due: 'Tomorrow', status: 'next' },
      { label: 'Prepare preservation notice', owner: 'Attorney', due: '24 Jun', status: 'urgent' },
      { label: 'Collect outage logs', owner: 'Client', due: 'Open', status: 'waiting' },
    ],
    documents: ['MSA', 'SLA exhibit', 'Incident tickets', 'Finance impact sheet'],
  },
  {
    id: 'lease-injunction',
    matterNumber: 'LIT-2307',
    title: 'Retail lease injunction',
    client: 'Multi-site retailer',
    practice: 'Real estate litigation',
    stage: 'Interim relief',
    status: 'Hearing prep',
    priority: 'high',
    owner: 'Maya Chen',
    court: 'County Court',
    nextDeadline: 'Evidence bundle - 26 Jun',
    summary: 'Landlord threatened lockout after disputed arrears. The file is in urgent hearing preparation with witness statement and exhibit gaps still open.',
    facts: [
      'Client disputes arrears because rent concession emails were exchanged.',
      'Lockout notice affects the highest revenue location.',
      'Witness statement needs exhibit references before filing.',
    ],
    issues: ['Forfeiture risk', 'Interim injunction', 'Rent concession evidence', 'Balance of convenience'],
    actions: [
      { label: 'Settle witness statement', owner: 'Attorney', due: 'Today', status: 'urgent' },
      { label: 'Assemble exhibit bundle', owner: 'Paralegal', due: '26 Jun', status: 'next' },
      { label: 'Confirm undertaking position', owner: 'Client', due: 'Today', status: 'urgent' },
    ],
    documents: ['Lease', 'Lockout notice', 'Rent concession emails', 'Draft witness statement'],
  },
  {
    id: 'founder-deadlock',
    matterNumber: 'COR-1189',
    title: 'Founder deadlock litigation risk',
    client: 'Venture-backed startup',
    practice: 'Shareholder disputes',
    stage: 'Strategy',
    status: 'Conflict screen',
    priority: 'medium',
    owner: 'Nina Patel',
    court: 'Pre-litigation',
    nextDeadline: 'Board packet review - 28 Jun',
    summary: 'Two founders are deadlocked over financing authority and IP control. The matter needs entity-party conflict review before deeper strategy work.',
    facts: [
      'Board consents and investor rights documents are incomplete.',
      'Client is concerned about unilateral IP transfers.',
      'Potential derivative and fiduciary-duty theories require jurisdiction review.',
    ],
    issues: ['Board deadlock', 'Fiduciary duties', 'IP ownership', 'Investor consent rights'],
    actions: [
      { label: 'Run expanded conflict screen', owner: 'Conflicts team', due: 'Today', status: 'urgent' },
      { label: 'Review cap table and consents', owner: 'Associate', due: '28 Jun', status: 'next' },
      { label: 'Prepare options memo', owner: 'Attorney', due: 'Open', status: 'waiting' },
    ],
    documents: ['Shareholders agreement', 'Board consents', 'Cap table', 'IP assignment records'],
  },
];
