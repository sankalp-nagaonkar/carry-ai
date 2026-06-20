import { PATIENT, REAL_PATIENT, OTHER_APPOINTMENTS, REAL_APPOINTMENTS, SCENARIOS, REAL_SCENARIO } from '/data.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const NODE_W = 132, NODE_H = 48;

const state = {
  source: null,
  currentSessionId: null,
  running: false,
  scenario: 'visit1',
  transcriptSource: 'simulator',
  patient: PATIENT,
  appointments: OTHER_APPOINTMENTS,
  turns: 0,
  minChunks: 4,
  chunksSinceInsight: 0,
  lastHeardAt: null,
  lastInsightAt: null,
  processState: 'Idle',
  processTimer: null,
  activitySeen: new Set(),
  symptoms: new Set(),
  meds: new Map(),
  safety: [],
  record: null,        // derived from backend memory
  newestSession: null, // session id highlighted as fresh in graph
};

init();

async function init() {
  bindNav();
  await loadRuntimeMode();
  await refresh();
}

async function loadRuntimeMode() {
  const mode = await fetch('/api/mode').then((r) => r.json()).catch(() => null);
  applyRuntimeMode(mode?.transcriptSource === 'websocket' ? 'websocket' : 'simulator', mode);
}

function applyRuntimeMode(source, mode = {}) {
  state.transcriptSource = source === 'websocket' ? 'websocket' : 'simulator';
  const isReal = state.transcriptSource === 'websocket';
  state.patient = isReal ? { ...REAL_PATIENT, id: mode?.realEntityId || REAL_PATIENT.id } : PATIENT;
  state.appointments = isReal ? REAL_APPOINTMENTS : OTHER_APPOINTMENTS;
  document.body.dataset.transcriptSource = state.transcriptSource;
  document.title = isReal ? 'Carry Real Clinical Transcript' : 'Carry Clinical Co-Pilot';
  $('.rail-foot-title').textContent = isReal ? 'Doctor Mode · Real' : 'Doctor Mode · Simulator';
  $('.rail-foot-copy').textContent = isReal
    ? 'Real transcript input. Clinician approves. End visit manually.'
    : 'AI prepares. Clinician approves. No automatic actions.';
  $('#scenario-picker')?.toggleAttribute('hidden', isReal);
  $('#reset-demo').textContent = isReal ? 'Start new live record' : 'Reset record';
  $$('.launch-visit').forEach((b) => { b.textContent = isReal ? 'Begin new real visit' : 'Begin next visit'; });
}

function bindNav() {
  $$('.rail-link').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
  $$('.launch-visit').forEach((b) => b.addEventListener('click', startVisit));
  $$('.scenario-opt').forEach((b) => b.addEventListener('click', () => setScenario(b.dataset.scenario)));
  $('#end-visit')?.addEventListener('click', endVisit);
  $('#approve-all')?.addEventListener('click', () => go('today'));
  $('#reset-demo')?.addEventListener('click', resetDemo);
}

function go(page) {
  $$('.rail-link').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${page}`));
}

function setScenario(scenario) {
  if (state.running || scenario === state.scenario) return;
  state.scenario = scenario;
  syncScenarioButtons();
  renderToday();
}

function syncScenarioButtons() {
  $$('.scenario-opt').forEach((b) => b.classList.toggle('active', b.dataset.scenario === state.scenario));
  $$('.scenario-opt').forEach((b) => { b.disabled = state.running; });
}

/* ---------------- LIVE RECORD (from backend memory) ---------------- */
async function refresh() {
  const data = await fetch(`/api/context?entityId=${entityId()}`).then((r) => r.json()).catch(() => ({ items: [], sessions: [] }));
  state.record = deriveRecord(data.items || [], data.sessions || []);
  // Decide which simulated visit is next based on how many visits have actually happened.
  if (!state.running && state.transcriptSource !== 'websocket') {
    state.scenario = state.record.visits.length === 0 ? 'visit1' : 'visit2';
    syncScenarioButtons();
  }
  renderToday();
  renderProfile();
  renderTimeline();
  renderGraph();
}

// Turn raw memory items into a structured longitudinal record.
function deriveRecord(items, sessions) {
  // Map session id to a visit number in chronological order.
  const order = new Map();
  sessions.forEach((s, i) => order.set(s.sessionId, i + 1));
  // Some items may belong to sessions not in the list; append them in encounter order.
  for (const it of items) if (!order.has(it.session_id)) order.set(it.session_id, order.size + 1);

  const visits = [...new Set(items.map((i) => i.session_id))]
    .map((sid) => ({ sessionId: sid, n: order.get(sid) }))
    .sort((a, b) => a.n - b.n);

  const allergies = [];
  const medications = [];
  const conditions = [];
  const symptoms = [];
  const precautions = [];

  for (const it of items) {
    const v = it.value || {};
    const sid = it.session_id;
    if (it.type === 'allergy_statement' || it.type === 'allergy') {
      const name = v.allergen || v.substance || v.drug || v.name || 'Allergen';
      allergies.push({ name: cap(name), reaction: listOf(v.reaction).join(', '), severity: v.severity || '', sid });
    } else if (it.type === 'symptom_history' || it.type === 'symptom') {
      const list = v.symptoms ? listOf(v.symptoms) : (v.symptom ? [v.symptom] : []);
      list.forEach((s) => symptoms.push({ name: cap(s), detail: v.duration || v.pattern || v.details || '', sid }));
    } else if (it.type === 'care_plan' || it.type === 'medication_mention' || it.type === 'medication_history') {
      const dx = v.diagnosis || v.condition;
      if (dx) conditions.push({ name: cap(dx), sid });
      const med = v.recommended_medication || v.prescribed_medication || v.recommended_treatment || v.medication || v.drug;
      if (med) medications.push({ name: cap(med), sid });
    } else if (it.type === 'encounter_summary') {
      if (v.diagnosis) conditions.push({ name: cap(v.diagnosis), sid });
      if (v.treatment) medications.push({ name: cap(v.treatment), sid });
      if (v.symptoms) symptoms.push({ name: cap(formatSummaryVal(v.symptoms)), detail: '', sid });
    } else if (it.type === 'return_precautions') {
      const text = v.instructions || (v.triggers ? `Return if: ${listOf(v.triggers).join(', ')}` : '');
      if (text) precautions.push({ text, sid });
    }
  }

  // Latest visit summary, used in the Today pre-read.
  const lastSid = visits.length ? visits[visits.length - 1].sessionId : null;
  const lastSummary = summarizeVisit(lastSid, { conditions, medications, symptoms });

  return {
    items, visits, order,
    allergies: dedupeBy(allergies, 'name'),
    medications: dedupeBy(medications, 'name'),
    conditions: dedupeBy(conditions, 'name'),
    symptoms: dedupeBy(symptoms, 'name'),
    precautions,
    lastSid, lastSummary,
  };
}

function summarizeVisit(sid, rec) {
  if (!sid) return '';
  const dx = rec.conditions.filter((c) => c.sid === sid).map((c) => c.name);
  const med = rec.medications.filter((m) => m.sid === sid).map((m) => m.name);
  const parts = [];
  if (dx.length) parts.push(dx.join(', '));
  if (med.length) parts.push(`Started ${med.join(', ')}`);
  return parts.join('. ') || 'Visit documented.';
}

/* ---------------- TODAY ---------------- */
function renderPatientChrome() {
  const p = state.patient;
  $('#visit-patient').textContent = p.name;
  $('#profile-avatar').textContent = p.initials;
  $('#profile-name').textContent = p.name;
  $('#profile-meta').textContent = `${p.age}, ${p.pronouns} · ${p.mrn} · Primary: ${p.primaryDoctor}`;
  $('#timeline-patient').textContent = p.name;
  $('#graph-patient').textContent = p.name;
}

function renderToday() {
  const rec = state.record || emptyRecord();
  const isReal = state.transcriptSource === 'websocket';
  const scn = isReal ? REAL_SCENARIO : SCENARIOS[state.scenario];
  const patient = state.patient;
  const hasHistory = rec.visits.length > 0;
  renderPatientChrome();

  $('#brief-avatar').textContent = patient.initials;
  $('#brief-name').textContent = patient.name;
  $('#brief-meta').textContent = `${patient.age}, ${patient.pronouns} \u00b7 ${patient.mrn} \u00b7 09:30`;
  $('#brief-badge').textContent = scn.badge;
  $('#brief-lead').textContent = isReal
    ? 'Real transcript mode. Carry listens to the POC WebSocket stream. Press End visit when the conversation is complete.'
    : hasHistory
      ? 'Pre-visit briefing, built from what Carry captured in earlier visits.'
      : 'First consult. No prior visits on file yet.';

  $('#brief-last').textContent = hasHistory ? rec.lastSummary : 'No prior visits recorded for this patient.';
  setChips('#brief-meds', rec.medications.map((m) => m.name), 'None on file');
  setChips('#brief-allergies', rec.allergies.map((a) => a.name), 'None recorded yet');
  setChips('#brief-symptoms', rec.symptoms.map((s) => s.name), hasHistory ? 'None active' : 'Reported at booking');
  setList('#brief-unresolved', hasHistory ? openItems(rec) : ['Allergy history not yet captured', 'Current medications unknown']);
  setList('#brief-agenda', scn.agenda, true);

  // "Carried forward" strip shows facts Carry already knows going into the visit.
  const carried = [
    ...rec.allergies.map((a) => `${a.name} allergy`),
    ...rec.conditions.map((c) => c.name),
    ...rec.medications.map((m) => m.name),
  ];
  const strip = $('#carried-strip');
  if (carried.length) {
    strip.hidden = false;
    setChips('#carried-list', carried.slice(0, 6));
  } else {
    strip.hidden = true;
  }

  const appts = [
    { id: 'a1', time: '09:30', name: patient.name, reason: scn.reason, status: 'next' },
    ...state.appointments,
  ];
  $('#schedule-count').textContent = `${appts.length} appointments`;
  $('#appt-list').innerHTML = appts.map((a) => `
    <li class="appt-row ${a.status === 'next' ? 'is-next' : ''}">
      <span class="appt-time">${esc(a.time)}</span>
      <span>
        <span class="appt-name">${esc(a.name)}</span>
        <span class="appt-reason">${esc(a.reason)}</span>
      </span>
      ${a.status === 'next' ? '<span class="tag tag-live">Next</span>' : '<span class="tag">Scheduled</span>'}
    </li>`).join('');

  renderAttention(rec);
}

function openItems(rec) {
  const out = [];
  if (rec.precautions.length) out.push(rec.precautions[rec.precautions.length - 1].text);
  out.push('Confirm symptom course since last visit');
  return out.slice(0, 3);
}

function renderAttention(rec) {
  const tiles = [
    { label: 'Notes captured', value: rec.visits.length, tone: 'review', detail: 'Visit drafts on record' },
    { label: 'Allergies known', value: rec.allergies.length, tone: 'flag', detail: 'Carried into every visit' },
    { label: 'Active medications', value: rec.medications.length, tone: 'follow', detail: 'From captured visits' },
    { label: 'Conditions tracked', value: rec.conditions.length, tone: 'lab', detail: 'Across the record' },
  ];
  $('#attention-list').innerHTML = tiles.map((a) => `
    <li class="attention-row">
      <span class="attn-count attn-${a.tone}">${a.value}</span>
      <span class="attn-text">
        <span class="attn-label">${esc(a.label)}</span>
        <span class="attn-detail">${esc(a.detail)}</span>
      </span>
    </li>`).join('');
}

function pushUpdate(text) {
  const list = $('#update-list');
  list.querySelector('.update-empty')?.remove();
  const li = document.createElement('li');
  li.className = 'fresh';
  li.textContent = text;
  list.prepend(li);
  while (list.children.length > 6) list.lastChild.remove();
}

/* ---------------- PROFILE ---------------- */
function renderProfile() {
  const rec = state.record || emptyRecord();
  const grid = $('#profile-grid');
  $('#profile-risk').hidden = rec.allergies.length === 0;
  if (rec.allergies.length) $('#profile-risk').textContent = `${rec.allergies[0].name} allergy`;

  if (!rec.visits.length) {
    grid.innerHTML = `<section class="pcard"><h3>No record yet</h3>
      <div class="prow"><div class="prow-sub">Run a visit. Conditions, medications and allergies will appear here as Carry captures them.</div></div></section>`;
    return;
  }

  grid.innerHTML = [
    pcard('Active conditions', rec.conditions.length
      ? rec.conditions.map((c) => prow(c.name, `Captured in Visit ${visitN(c.sid)}`, '<span class="tag tag-teal">Active</span>'))
      : [emptyRow('No conditions recorded')]),
    pcard('Medications', rec.medications.length
      ? rec.medications.map((m) => prow(m.name, `Captured in Visit ${visitN(m.sid)}`, '<span class="tag tag-good">Active</span>'))
      : [emptyRow('No medications recorded')], 'meds-card'),
    pcard('Allergies', rec.allergies.length
      ? rec.allergies.map((a) => prow(a.name, a.reaction || 'Reaction noted', `<span class="tag tag-danger">${esc(a.severity || 'Flagged')}</span>`))
      : [emptyRow('None recorded')], 'allergy-card'),
    pcard('Symptoms', rec.symptoms.length
      ? rec.symptoms.map((s) => prow(s.name, s.detail || `Visit ${visitN(s.sid)}`))
      : [emptyRow('None recorded')], 'sym-card'),
    pcard('Return precautions', rec.precautions.length
      ? rec.precautions.map((p) => `<div class="prow"><div class="prow-name" style="font-weight:450">${esc(p.text)}</div></div>`)
      : [emptyRow('None recorded')], 'plan-card'),
  ].join('');
}

function pcard(title, rows, id) {
  return `<section class="pcard"${id ? ` id="${id}"` : ''}><h3>${esc(title)}</h3>${rows.join('')}</section>`;
}
function prow(name, sub, right = '') {
  return `<div class="prow"><div class="prow-top"><span class="prow-name">${esc(name)}</span>${right}</div>${sub ? `<div class="prow-sub">${esc(sub)}</div>` : ''}</div>`;
}
function emptyRow(text) { return `<div class="prow"><div class="prow-sub">${esc(text)}</div></div>`; }

/* ---------------- TIMELINE ---------------- */
function renderTimeline() {
  const rec = state.record || emptyRecord();
  const tl = $('#timeline');
  if (!rec.visits.length) {
    tl.innerHTML = '<p class="muted">No history yet. Run a visit to build the timeline.</p>';
    return;
  }
  // Newest first.
  const events = [];
  [...rec.visits].reverse().forEach((v) => {
    const n = v.n;
    const fresh = v.sessionId === state.newestSession;
    const conds = rec.conditions.filter((c) => c.sid === v.sessionId).map((c) => c.name);
    const meds = rec.medications.filter((m) => m.sid === v.sessionId).map((m) => m.name);
    const algs = rec.allergies.filter((a) => a.sid === v.sessionId);
    events.push({ kind: 'visit', when: `Visit ${n}`, title: conds[0] || 'Clinical visit', detail: summarizeVisit(v.sessionId, rec), tags: [`Visit ${n}`, 'Captured'], fresh });
    meds.forEach((m) => events.push({ kind: 'medication', when: `Visit ${n}`, title: `Medication: ${m}`, detail: 'Captured from the conversation.', tags: ['Medication'] }));
    algs.forEach((a) => events.push({ kind: 'allergy', when: `Visit ${n}`, title: `Allergy: ${a.name}`, detail: a.reaction || 'Reaction noted.', tags: ['Allergy'] }));
  });

  tl.innerHTML = events.map((e) => `
    <div class="tl-item ${e.fresh ? 'fresh' : ''}">
      <span class="tl-dot ${esc(e.kind)}"></span>
      <div class="tl-when">${esc(e.when)}</div>
      <div class="tl-title">${esc(e.title)}</div>
      <div class="tl-detail">${esc(e.detail)}</div>
      <div class="tl-tags">${(e.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
}

/* ---------------- GRAPH (auto-laid out from the live record) ---------------- */
function renderGraph() {
  const rec = state.record || emptyRecord();
  const svg = $('#graph-canvas');
  const { nodes, edges } = buildGraph(rec);
  state.graphNodes = nodes;

  if (nodes.length <= 1) {
    svg.innerHTML = `<text x="500" y="330" text-anchor="middle" class="gnode-sub">Run a visit to grow the knowledge graph.</text>`;
    $('#graph-status').textContent = 'No data yet';
    renderLegend();
    return;
  }

  const byId = (id) => nodes.find((n) => n.id === id);
  const edgeSvg = edges.filter((e) => byId(e.from) && byId(e.to)).map((e) => {
    const a = byId(e.from), b = byId(e.to);
    const cls = `gedge ${e.kind || ''} ${e.fresh ? 'gnew' : ''}`;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return `<path class="${cls}" d="M ${a.x} ${a.y} L ${b.x} ${b.y}" />
      ${e.label ? `<text class="gedge-label" x="${mx}" y="${my - 4}" text-anchor="middle">${esc(e.label)}</text>` : ''}`;
  }).join('');

  const nodeSvg = nodes.map((n) => {
    const c = nodeColor(n.type);
    return `<g class="gnode ${n.fresh ? 'gnew' : ''}" data-id="${n.id}" transform="translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})">
      <rect class="gnode-box" width="${NODE_W}" height="${NODE_H}" rx="12" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5" />
      <circle cx="16" cy="${NODE_H / 2}" r="5" fill="${c.dot}" />
      <text class="gnode-label" x="30" y="${NODE_H / 2 - 3}">${esc(clip(n.label, 16))}</text>
      <text class="gnode-sub" x="30" y="${NODE_H / 2 + 11}">${esc(clip(n.sub, 18))}</text>
    </g>`;
  }).join('');

  svg.innerHTML = edgeSvg + nodeSvg;
  svg.querySelectorAll('.gnode').forEach((g) => g.addEventListener('click', () => showNode(g.dataset.id)));
  $('#graph-status').textContent = state.newestSession ? 'Updated after the latest visit' : `Built from ${rec.visits.length} visit${rec.visits.length > 1 ? 's' : ''}`;
  renderLegend();
}

// Provenance layout: patient at center, a visit node per session, and each
// captured fact connected to the visit where Carry learned it.
function buildGraph(rec) {
  const cx = 500, cy = 330;
  const nodes = [{ id: 'patient', type: 'patient', label: state.patient.name, sub: 'Patient', x: cx, y: cy }];
  const edges = [];

  const visitCount = rec.visits.length;
  rec.visits.forEach((v, vi) => {
    const vx = cx + (visitCount === 1 ? 0 : (vi - (visitCount - 1) / 2) * 300);
    const vy = cy - 230;
    const vid = `visit_${v.n}`;
    const fresh = v.sessionId === state.newestSession;
    nodes.push({ id: vid, type: 'visit', label: `Visit ${v.n}`, sub: 'Encounter', x: vx, y: vy, fresh, sid: v.sessionId });
    edges.push({ from: 'patient', to: vid, fresh });

    // Facts for this visit, fanned below the visit node.
    const facts = [
      ...rec.allergies.filter((a) => a.sid === v.sessionId).map((a) => ({ type: 'allergy', label: a.name, sub: 'Allergy', src: a })),
      ...rec.conditions.filter((c) => c.sid === v.sessionId).map((c) => ({ type: 'condition', label: c.name, sub: 'Condition', src: c })),
      ...rec.medications.filter((m) => m.sid === v.sessionId).map((m) => ({ type: 'medication', label: m.name, sub: 'Medication', src: m })),
      ...rec.symptoms.filter((s) => s.sid === v.sessionId).map((s) => ({ type: 'symptom', label: s.name, sub: 'Symptom', src: s })),
    ];
    const spread = 150;
    facts.forEach((f, fi) => {
      const fx = vx + (fi - (facts.length - 1) / 2) * spread;
      const baseY = cy + 90 + (fi % 2) * 120;
      const fid = `${vid}_f${fi}`;
      nodes.push({ id: fid, type: f.type, label: f.label, sub: f.sub, x: clampX(fx), y: baseY, fresh, detail: f });
      edges.push({ from: vid, to: fid, fresh, kind: f.type === 'allergy' ? 'conflict' : '' });
    });
  });

  return { nodes, edges };
}

function clampX(x) { return Math.max(110, Math.min(890, x)); }

function nodeColor(type) {
  const map = {
    patient: ['oklch(96% 0.024 244)', 'oklch(54% 0.108 244)', 'oklch(54% 0.108 244)'],
    visit: ['oklch(96% 0.024 244)', 'oklch(80% 0.04 244)', 'oklch(54% 0.108 244)'],
    allergy: ['oklch(96% 0.04 27)', 'oklch(82% 0.06 27)', 'oklch(56% 0.142 27)'],
    condition: ['oklch(96% 0.03 196)', 'oklch(82% 0.04 196)', 'oklch(42% 0.11 244)'],
    medication: ['oklch(96% 0.03 196)', 'oklch(82% 0.05 196)', 'oklch(58% 0.082 196)'],
    symptom: ['oklch(96.5% 0.05 76)', 'oklch(84% 0.07 76)', 'oklch(64% 0.114 76)'],
  };
  const [fill, stroke, dot] = map[type] || map.visit;
  return { fill, stroke, dot };
}

function renderLegend() {
  const types = [
    ['Patient', 'patient'], ['Visit', 'visit'], ['Condition', 'condition'],
    ['Symptom', 'symptom'], ['Medication', 'medication'], ['Allergy', 'allergy'],
  ];
  $('#graph-legend').innerHTML = types.map(([label, type]) => {
    const c = nodeColor(type);
    return `<span class="leg"><i style="background:${c.dot}"></i>${esc(label)}</span>`;
  }).join('');
}

function showNode(id) {
  const node = (state.graphNodes || []).find((n) => n.id === id);
  const box = $('#graph-detail');
  if (!node) return;
  const d = node.detail?.src;
  const visitN = node.sid ? state.record.order.get(node.sid) : (node.detail ? state.record.order.get(node.detail.src.sid) : null);
  box.innerHTML = `
    <p class="block-label">Node detail</p>
    <p class="gd-name">${esc(node.label)}</p>
    <span class="tag">${esc(node.sub)}</span>
    ${d ? `
      <p class="gd-row"><b>Captured in</b><br>Visit ${esc(String(visitN || '1'))}</p>
      ${d.reaction ? `<p class="gd-row"><b>Reaction</b><br>${esc(d.reaction)}</p>` : ''}
      ${d.detail ? `<p class="gd-row"><b>Detail</b><br>${esc(d.detail)}</p>` : ''}
      <p class="gd-row"><b>Source</b><br>Extracted live from the visit conversation.</p>
    ` : node.type === 'visit'
      ? `<p class="gd-row"><b>Source</b><br>A recorded encounter. Connected facts were captured during this visit.</p>`
      : '<p class="gd-row">Patient record root.</p>'}`;
}

/* ---------------- LIVE VISIT (real backend SSE) ---------------- */
async function startVisit() {
  if (state.running) return;
  if (state.transcriptSource === 'websocket') await clearCurrentRecord({ stayOnToday: true });
  resetVisit();
  go('visit');
  state.running = true;
  $('#visit-scenario').textContent = state.transcriptSource === 'websocket'
    ? 'Real WebSocket'
    : (state.scenario === 'visit1' ? 'Visit 1' : 'Visit 2');
  $$('.launch-visit').forEach((b) => { b.disabled = true; b.textContent = 'Visit in progress'; });
  $$('.scenario-opt').forEach((b) => { b.disabled = true; });
  $('#reset-demo') && ($('#reset-demo').disabled = true);
  $('#end-visit').hidden = state.transcriptSource !== 'websocket';
  $('#end-visit').disabled = true;
  setLive('live', state.transcriptSource === 'websocket' ? 'Connecting' : 'Listening');

  const source = new EventSource(`/api/live?scenario=${state.scenario}&source=${state.transcriptSource}`);
  state.source = source;

  source.addEventListener('session', (e) => onSession(parse(e)));
  source.addEventListener('chunk', (e) => onChunk(parse(e)));
  source.addEventListener('websocket_status', (e) => onWebsocketStatus(parse(e)));
  source.addEventListener('websocket_complete', (e) => { addActivity('Live transcript complete', `Capture ended: ${parse(e).reason || 'completed'}.`, 'tag-teal'); setProcessState('Drafting final'); });
  source.addEventListener('incremental_started', () => { setLive('thinking', 'Understanding'); setProcessState('Understanding now'); addActivity('Understanding pass started', 'Carry has enough context to update the draft.', 'tag-teal'); });
  source.addEventListener('incremental_queued', () => { setProcessState('Still listening during processing'); });
  source.addEventListener('incremental', (e) => { onIncremental(parse(e).draft); setLive('live', 'Listening'); markInsightUpdated(); });
  source.addEventListener('final_started', () => { setLive('thinking', 'Drafting note'); setProcessState('Drafting final'); addActivity('Final drafting started', 'Carry is preparing the review draft.', 'tag-warn'); });
  source.addEventListener('final', (e) => { onFinal(parse(e).output); markInsightUpdated('Draft ready'); });
  source.addEventListener('notion_started', () => addAction('Notion sync', 'Creating the patient page and timestamped markdown visit note.', 'tag'));
  source.addEventListener('notion', (e) => onNotion(parse(e)));
  source.addEventListener('done', (e) => finishVisit(source, parse(e)));
  source.addEventListener('error', (e) => {
    if (e.data) addAction('Issue', parse(e).error || 'Stream error', 'tag-danger');
    if (source.readyState === EventSource.CLOSED) finishVisit(source, {});
  });
}

function resetVisit() {
  state.turns = 0; state.chunksSinceInsight = 0; state.lastHeardAt = null; state.lastInsightAt = null; state.processState = 'Collecting transcript'; state.activitySeen = new Set();
  state.symptoms.clear(); state.meds.clear(); state.safety = [];
  stopProcessTimer(); startProcessTimer();
  $('#convo-stream').innerHTML = '<p class="convo-empty">Listening for the conversation to begin.</p>';
  $('#convo-count').textContent = '0';
  setSoapPending();
  $('#soap-progress').textContent = 'Listening'; $('#soap-progress').className = 'tag';
  $('#live-symptoms').innerHTML = '<li class="live-empty">Appears after enough context</li>';
  $('#live-meds').innerHTML = '<li class="live-empty">Medication signals appear here</li>';
  $('#live-safety').innerHTML = '<li class="live-empty">No safety signal yet</li>';
  $('#live-missing').innerHTML = '<li class="live-empty">Questions appear after enough context</li>';
  $('#action-stack') && ($('#action-stack').innerHTML = '<p class="live-empty">Live system events appear here.</p>');
  $('#end-visit').hidden = true;
  $('#end-visit').disabled = false;
  $('#review').hidden = true;
  $('#card-safety').classList.remove('flag');
  renderProcessing();
}

function setSoapPending() {
  const copy = {
    s: 'Collecting context',
    o: 'Appears after enough transcript',
    a: 'Draft, clinician review required',
    p: state.transcriptSource === 'websocket' ? 'End visit for final plan' : 'Appears after final pass',
  };
  Object.entries(copy).forEach(([k, text]) => { const el = $(`#soap-${k}`); el.textContent = text; el.className = 'pending'; });
}

function startProcessTimer() {
  if (state.processTimer) return;
  state.processTimer = setInterval(renderProcessing, 1000);
}

function stopProcessTimer() {
  if (!state.processTimer) return;
  clearInterval(state.processTimer);
  state.processTimer = null;
}

function setProcessState(label) {
  state.processState = label;
  renderProcessing();
}

function markHeard() {
  state.lastHeardAt = Date.now();
  state.chunksSinceInsight = Math.min(state.minChunks, state.chunksSinceInsight + 1);
  if (state.chunksSinceInsight >= state.minChunks) setProcessState('Enough context collected');
  else setProcessState('Waiting for enough context');
}

function markInsightUpdated(label = 'Listening for more context') {
  state.lastInsightAt = Date.now();
  state.chunksSinceInsight = 0;
  setProcessState(label);
}

function renderProcessing() {
  const strip = $('#process-strip');
  if (!strip) return;
  const thinking = /understanding|drafting/i.test(state.processState);
  const waiting = /waiting/i.test(state.processState);
  const done = /ready|complete/i.test(state.processState);
  strip.dataset.state = thinking ? 'thinking' : waiting ? 'waiting' : done ? 'done' : 'idle';
  $('#process-state').textContent = state.processState || 'Idle';
  $('#process-heard').textContent = `Last heard: ${state.lastHeardAt ? relTime(state.lastHeardAt) : 'none'}`;
  $('#process-context').textContent = `Context: ${Math.min(state.chunksSinceInsight, state.minChunks)} / ${state.minChunks} turns`;
  $('#intel-updated').textContent = state.lastInsightAt ? `Updated ${relTime(state.lastInsightAt)}` : (state.running ? 'Collecting context' : 'Not started');
  const pct = state.minChunks ? Math.min(100, Math.round((state.chunksSinceInsight / state.minChunks) * 100)) : 0;
  $('#process-bar-fill').style.width = thinking ? '100%' : `${pct}%`;
}

function relTime(ts) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 2) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return min === 1 ? '1 min ago' : `${min} min ago`;
}

function onSession(data) {
  state.currentSessionId = data?.sessionId || null;
  state.minChunks = Number(data?.minChunks || state.minChunks || 4);
  renderProcessing();
  if (data?.sourceMode === 'websocket') {
    $('#end-visit').hidden = false;
    $('#end-visit').disabled = false;
    addActivity('Real transcript source', 'End the visit manually when the conversation is over.', 'tag-teal');
  }
}

async function endVisit() {
  if (!state.running) return;
  $('#end-visit').disabled = true;
  setLive('thinking', 'Ending visit');
  addActivity('End requested', 'Final draft will run after the live transcript stream closes.', 'tag-warn');
  const suffix = state.currentSessionId ? `?sessionId=${encodeURIComponent(state.currentSessionId)}` : '';
  const result = await fetch(`/api/end-live${suffix}`).then((r) => r.json()).catch((error) => ({ ok: false, error: error.message || String(error) }));
  if (!result.ok) {
    $('#end-visit').disabled = false;
    setLive('live', 'Still listening');
    addActivity('End visit issue', result.error || 'Could not end active stream.', 'tag-danger');
  }
}

function onWebsocketStatus(data) {
  const status = data?.status || 'event';
  if (status === 'connecting') {
    setLive('thinking', 'Connecting');
    addActivityOnce('Real transcript source', `Connecting to ${data.backendUrl || 'the live WebSocket'}.`, 'tag-teal', 'ws_connecting');
  } else if (status === 'connected') {
    setLive('live', 'Listening');
    addActivityOnce('Real transcript connected', `Listening to ${data.scope || 'global'} stream.`, 'tag-good', 'ws_connected');
  } else if (status === 'conversation_started') {
    setLive('live', 'Conversation started');
  } else if (status === 'transcript_updated' && data.speakers?.length) {
    setLive('live', `Listening: ${data.speakers.join(', ')}`);
  } else if (status === 'error') {
    addActivity('WebSocket issue', data.error || 'Connection issue', 'tag-warn');
  }
}

function onChunk(c) {
  state.turns += 1;
  markHeard();
  addActivityOnce('Transcript received', 'Carry is redacting identifiers before processing.', 'tag-teal', 'transcript_received');
  $('#convo-count').textContent = String(state.turns);
  const stream = $('#convo-stream');
  stream.querySelector('.convo-empty')?.remove();
  const who = speakerRole(c);
  const turn = document.createElement('div');
  turn.className = `turn ${who.className}`;

  const redactions = c.redactions || [];
  const original = c.incomingText || c.sanitizedText || '';
  const sanitized = c.sanitizedText || original;
  const hasRedactions = redactions.length > 0;

  // Show both the captured audio transcript and the sanitized version that is
  // actually sent for processing. When nothing was redacted, the two are identical
  // so we only show one block to keep the stream calm.
  const body = hasRedactions
    ? `<div class="turn-block">
         <span class="turn-tag raw">Captured</span>
         <div class="turn-text">${highlightOriginals(original, redactions)}</div>
       </div>
       <div class="turn-block">
         <span class="turn-tag safe">Sent for processing</span>
         <div class="turn-text">${highlightRedactions(sanitized, redactions)}</div>
       </div>
       <div class="turn-redact">${redactions.length} item${redactions.length > 1 ? 's' : ''} redacted before anything leaves the device</div>`
    : `<div class="turn-text">${esc(sanitized)}</div>`;

  turn.innerHTML = `<span class="turn-who">${esc(who.label)}</span>${body}`;
  stream.appendChild(turn);
  stream.scrollTop = stream.scrollHeight;
}

// Person 1 leads the consult (clinician), Person 2 is the patient. Fall back to a
// keyword check for any other labeling scheme.
function speakerRole(chunk) {
  const speaker = typeof chunk === 'string' ? chunk : chunk?.speaker;
  const sourceMode = typeof chunk === 'object' ? chunk?.sourceMode : null;
  const s = String(speaker || '').trim();
  const lower = s.toLowerCase();

  // Real WebSocket transcripts are diarized but not role-labeled. Preserve the
  // diarized speaker labels instead of pretending every speaker is the clinician.
  if (sourceMode === 'websocket') {
    const m = lower.match(/(?:speaker|spk|person)[_\s-]*(\d+)/);
    const n = m ? Number(m[1]) : null;
    const label = m ? `Speaker ${n}` : (s || 'Speaker');
    const className = n != null && n % 2 === 0 ? 'doctor' : 'patient';
    return { label, className };
  }

  // Simulator convention: Person 1 leads the consult, Person 2 is the patient.
  if (lower.includes('patient') || /\b(person\s*2|speaker\s*2|p2|s2)\b/.test(lower)) return { label: 'Patient', className: 'patient' };
  if (lower.includes('doctor') || lower.includes('clinician') || /\b(person\s*1|speaker\s*1|p1|s1)\b/.test(lower)) return { label: 'Clinician', className: 'doctor' };
  return { label: s || 'Clinician', className: 'doctor' };
}

// In the captured block, highlight the original private values that will be masked.
function highlightOriginals(text, redactions) {
  const src = String(text || '');
  const values = redactions.map((r) => r.value).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!values.length) return esc(src);
  const re = new RegExp(`(${values.map(escapeRegex).join('|')})`, 'g');
  const labelFor = new Map(redactions.map((r) => [r.value, (r.label || 'redacted').replace(/^private_/, '').replace(/_/g, ' ')]));
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    out += `<mark class="redact raw" title="${esc(labelFor.get(m[0]) || 'redacted')} will be masked">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return out;
}

// Wrap each placeholder token in the sanitized text with a highlighted pill.
function highlightRedactions(text, redactions) {
  const src = String(text || '');
  const byPlaceholder = new Map();
  for (const r of redactions) if (r.placeholder) byPlaceholder.set(r.placeholder, r);
  const placeholders = [...byPlaceholder.keys()].sort((a, b) => b.length - a.length);
  if (!placeholders.length) return esc(src);
  const re = new RegExp(`(${placeholders.map(escapeRegex).join('|')})`, 'g');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const r = byPlaceholder.get(m[0]);
    const label = (r?.label || 'redacted').replace(/^private_/, '').replace(/_/g, ' ');
    out += `<mark class="redact" title="${esc(label)} redacted before processing">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return out;
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function onIncremental(draft) {
  if (!draft) return;
  const facts = draft.emerging_facts || {};
  const med = draft.medication_decision_tracking || {};

  if (facts.chief_complaint) fillSoap('s', `${facts.chief_complaint}${facts.duration ? `, ${facts.duration}` : ''}`);
  if (facts.positive_symptoms?.length) fillSoap('o', facts.positive_symptoms.join(', '));
  if (med.current_plan) { fillSoap('a', 'Working assessment in progress'); fillSoap('p', listText(med.current_plan)); }
  $('#soap-progress').textContent = 'Drafting'; $('#soap-progress').className = 'tag tag-warn';

  (facts.positive_symptoms || []).forEach((s) => {
    if (!state.symptoms.has(s)) {
      state.symptoms.add(s);
      addLive('#live-symptoms', `<span class="li-mark warn"></span><span>${esc(s)}</span>`);
      pushUpdate(`Symptom noted: ${s}`);
    }
  });

  syncMed(med.initially_proposed, 'proposed');
  syncMed(med.cancelled_or_avoided, 'cancelled');
  syncMed(med.current_plan, 'active');

  if (facts.allergies && !state.safety.includes('allergy')) {
    state.safety.push('allergy');
    addLive('#live-safety', `<span class="li-mark bad"></span><span>Allergy on record: ${esc(formatVal(facts.allergies))}</span>`, true);
    $('#card-safety').classList.add('flag');
    pushUpdate('Allergy confirmed');
  }

  const missing = draft.missing_information_so_far || [];
  if (missing.length) {
    $('#live-missing').innerHTML = '';
    missing.slice(0, 4).forEach((m) => {
      addLive('#live-missing', `<span class="li-mark"></span><span>${esc(m.field || m.reason || formatVal(m))}<span class="li-sub"> ${esc(m.reason && m.field ? m.reason : '')}</span></span>`);
    });
  }
}

function syncMed(value, kind) {
  toList(value).forEach((name) => {
    if (!name) return;
    const key = name.toLowerCase().slice(0, 24);
    if (state.meds.get(key) === kind) return;
    state.meds.set(key, kind);
    renderMeds();
    if (kind === 'active') addAction('Medication update', `${name} added as active draft.`, 'tag-good');
    else if (kind === 'cancelled') addAction('Safety catch', `${name} avoided due to allergy conflict.`, 'tag-danger');
  });
}

function renderMeds() {
  const items = [...state.meds.entries()];
  if (!items.length) { $('#live-meds').innerHTML = '<li class="live-empty">None mentioned yet</li>'; return; }
  $('#live-meds').innerHTML = items.map(([name, kind]) => {
    const label = cap(name);
    if (kind === 'cancelled') return `<li><span class="li-mark bad"></span><span class="li-strike">${esc(label)}</span><span class="li-sub"> avoided</span></li>`;
    if (kind === 'active') return `<li><span class="li-mark good"></span><span>${esc(label)}</span><span class="li-sub"> active draft</span></li>`;
    return `<li><span class="li-mark"></span><span>${esc(label)}</span><span class="li-sub"> proposed</span></li>`;
  }).join('');
}

function fillSoap(k, text) {
  const el = $(`#soap-${k}`);
  if (el.textContent === text) return;
  el.textContent = text;
  el.className = 'filled';
}

function addLive(sel, html, prepend) {
  const list = $(sel);
  list.querySelector('.live-empty')?.remove();
  const li = document.createElement('li');
  li.innerHTML = html;
  prepend ? list.prepend(li) : list.appendChild(li);
}

function addAction(title, body, tag = 'tag', status = 'Draft') {
  const stack = $('#action-stack');
  if (!stack) return;
  stack.querySelector('.live-empty')?.remove();
  const card = document.createElement('div');
  card.className = 'action-card';
  card.innerHTML = `<div class="action-card-head"><span class="action-title">${esc(title)}</span><span class="tag ${tag}">${esc(status)}</span></div>
    <div class="action-body">${esc(body)}</div>`;
  stack.prepend(card);
  while (stack.children.length > 7) stack.lastChild.remove();
}

function addActivity(title, body, tag = 'tag') {
  addAction(title, body, tag, 'Live');
}

function addActivityOnce(title, body, tag, key) {
  if (state.activitySeen.has(key)) return;
  state.activitySeen.add(key);
  addActivity(title, body, tag);
}

function onFinal(output) {
  setLive('thinking', 'Preparing review');
  const soap = output.soap_note || {};
  fillSoap('s', summaryText(soap.subjective) || $('#soap-s').textContent);
  fillSoap('o', summaryText(soap.objective) || $('#soap-o').textContent);
  fillSoap('a', summaryText(soap.assessment) || $('#soap-a').textContent);
  fillSoap('p', summaryText(soap.plan) || $('#soap-p').textContent);
  $('#soap-progress').textContent = 'Ready for review'; $('#soap-progress').className = 'tag tag-good';

  const followUp = output.follow_up_plan || {};
  if (followUp.timeframe_text) addAction('Calendar draft', `Follow-up: ${followUp.timeframe_text}.`, 'tag-teal');

  renderReview(output);
}

function renderReview(output) {
  const soap = output.soap_note || {};
  const meds = output.medication_decision_tracking || {};
  const followUp = output.follow_up_plan || {};
  const codes = output.icd10_suggestions || [];
  const items = [
    reviewItem('SOAP note', 'Draft', `<p><b>S:</b> ${esc(summaryText(soap.subjective))}</p><p><b>A:</b> ${esc(summaryText(soap.assessment))}</p><p><b>P:</b> ${esc(summaryText(soap.plan))}</p>`, true),
    reviewItem('Medication updates', 'Needs confirmation', `<p>Active: ${esc(listText(meds.final_stated_plan) || 'None')}</p><p>Avoided: ${esc(listText(meds.cancelled_or_avoided) || 'None')}</p>`),
    reviewItem('Follow-up plan', 'Draft', `<p>${esc(followUp.timeframe_text || 'No follow-up specified')}</p>${followUp.reason ? `<p>${esc(followUp.reason)}</p>` : ''}`),
    reviewItem('Coding suggestions', 'Draft', codes.length ? codes.map((c) => `<p>${esc(c.code)} ${esc(c.description || '')}</p>`).join('') : '<p>No codes suggested</p>'),
  ];
  $('#review-grid').innerHTML = items.join('');
  $('#review').hidden = false;
}

function reviewItem(title, status, body, full) {
  const tag = status === 'Draft' ? 'tag-warn' : status.includes('confirm') ? 'tag-teal' : 'tag';
  return `<div class="review-item ${full ? 'full' : ''}">
    <div class="review-item-head"><h4>${esc(title)}</h4><span class="tag ${tag}">${esc(status)}</span></div>${body}</div>`;
}

function onNotion(data) {
  if (data.ok && data.page?.url) addAction('Notion synced', `Markdown visit note created under the patient page. ${data.page.url}`, 'tag-good', 'Done');
  else if (data.ok) addAction('Notion synced', 'Markdown visit note created under the patient page.', 'tag-good', 'Done');
  else addAction('Notion sync', `Needs review: ${data.error || 'unknown error'}`, 'tag-warn');
}

async function finishVisit(source, payload) {
  source?.close();
  state.source = null;
  state.currentSessionId = null;
  state.running = false;
  state.newestSession = payload?.sessionId || null;
  setLive('done', 'Visit complete');
  setProcessState('Visit complete');
  stopProcessTimer();
  $$('.launch-visit').forEach((b) => { b.disabled = false; b.textContent = state.transcriptSource === 'websocket' ? 'Begin new real visit' : 'Begin next visit'; });
  $('#end-visit').hidden = true;
  $('#end-visit').disabled = false;
  syncScenarioButtons();
  $('#reset-demo') && ($('#reset-demo').disabled = false);

  // The record is now genuinely updated in the backend. Rebuild every view from it.
  await refresh();
  pushUpdate('Record updated from the latest visit');
  if (state.scenario === 'visit2') pushUpdate('Knowledge graph and timeline now span both visits');
}

function setLive(stateName, label) {
  $('#live-dot').dataset.state = stateName;
  $('#live-label').textContent = label;
}

async function resetDemo() {
  if (state.running) return;
  await clearCurrentRecord();
}

async function clearCurrentRecord({ stayOnToday = false } = {}) {
  await fetch(`/api/reset?entityId=${entityId()}`).catch(() => {});
  state.newestSession = null;
  $('#update-list').innerHTML = '<li class="update-empty">Updates from visits appear here as Carry understands them.</li>';
  await refresh();
  if (!stayOnToday) go('today');
}

/* ---------------- utils ---------------- */
function entityId() { return state.patient.id; }
function emptyRecord() {
  return { items: [], visits: [], order: new Map(), allergies: [], medications: [], conditions: [], symptoms: [], precautions: [], lastSummary: '' };
}
function visitN(sid) { return state.record?.order.get(sid) || 1; }
function setChips(sel, arr, empty) {
  const el = $(sel);
  el.innerHTML = arr.length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : (empty ? `<li class="li-muted">${esc(empty)}</li>` : '');
}
function setList(sel, arr, ordered) {
  $(sel).innerHTML = (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
}
function dedupeBy(arr, key) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = (x[key] || '').toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
function listOf(v) { if (!v) return []; return Array.isArray(v) ? v.map(String) : [String(v)]; }
function formatSummaryVal(v) { return Array.isArray(v) ? v.join(', ') : String(v); }
function cap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function parse(e) { try { return JSON.parse(e.data); } catch { return {}; } }
function toList(v) { if (!v) return []; if (Array.isArray(v)) return v.map(formatVal).filter(Boolean); return [formatVal(v)].filter(Boolean); }
function listText(v) { return toList(v).join('; '); }
function clip(s, n) { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s; }

function summaryText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(summaryText).filter(Boolean).join(' ');
  if (typeof v === 'object') return Object.values(v).map(summaryText).filter(Boolean).join(' ');
  return String(v);
}
function formatVal(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatVal).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v).filter(([, x]) => x != null && x !== '')
      .map(([k, x]) => (k === 'name' || k === 'drug' || k === 'medication' ? formatVal(x) : `${formatVal(x)}`)).join(' ');
  }
  return String(v);
}
function esc(v = '') {
  return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
