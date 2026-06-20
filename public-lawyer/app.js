import { MATTER, OTHER_MEETINGS, SCENARIOS } from '/data.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const ENTITY = MATTER.id;
const NODE_W = 132, NODE_H = 48;

const state = {
  source: null,
  running: false,
  scenario: 'meeting1',
  turns: 0,
  facts: new Set(),
  issues: new Set(),
  deadlines: new Map(),
  conflicts: [],
  record: null,
  newestSession: null,
};

init();

async function init() {
  bindNav();
  await refresh();
}

function bindNav() {
  $$('.rail-link').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
  $$('.launch-visit').forEach((b) => b.addEventListener('click', startMeeting));
  $$('.scenario-opt').forEach((b) => b.addEventListener('click', () => setScenario(b.dataset.scenario)));
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
}

/* ---------------- LIVE MATTER RECORD ---------------- */
async function refresh() {
  const data = await fetch(`/api/context?entityId=${ENTITY}`).then((r) => r.json()).catch(() => ({ items: [], sessions: [] }));
  state.record = deriveRecord(data.items || [], data.sessions || []);
  if (!state.running) {
    state.scenario = state.record.meetings.length === 0 ? 'meeting1' : 'meeting2';
    syncScenarioButtons();
  }
  renderToday();
  renderMatter();
  renderTimeline();
  renderGraph();
}

function deriveRecord(items, sessions) {
  const order = new Map();
  sessions.forEach((s, i) => order.set(s.sessionId, i + 1));
  for (const it of items) if (!order.has(it.session_id)) order.set(it.session_id, order.size + 1);

  const meetings = [...new Set(items.map((i) => i.session_id))]
    .map((sid) => ({ sessionId: sid, n: order.get(sid) }))
    .sort((a, b) => a.n - b.n);

  const summaries = [];
  const facts = [];
  const issues = [];
  const parties = [];
  const deadlines = [];
  const objectives = [];
  const nextSteps = [];
  const unresolved = [];
  const risks = [];

  for (const it of items) {
    const v = it.value || {};
    const sid = it.session_id;
    if (it.type === 'meeting_summary') {
      const text = v.summary || v.draft || v.value || v.description || '';
      if (text) summaries.push({ text: clean(text), sid });
      if (v.matter_type) issues.push({ name: clean(v.matter_type), strength: '', sid });
    } else if (it.type === 'key_fact') {
      const text = v.fact || v.event || v.summary || v.value || v.description || '';
      if (text) facts.push({ text: clean(text), date: v.date_text || v.date || '', sid });
    } else if (it.type === 'legal_issue') {
      const name = v.issue || v.name || v.value || v.description || '';
      if (name) issues.push({ name: clean(name), strength: v.strength || '', sid });
    } else if (it.type === 'opposing_party' || it.type === 'conflict_check_item') {
      const name = v.name || v.party || v.organization || v.company || v.value || '';
      if (name) parties.push({ name: clean(name), role: v.role || 'party to check', sid });
    } else if (it.type === 'deadline') {
      const due = v.due_text || v.deadline || v.date_text || v.value || '';
      if (due) deadlines.push({ due: clean(due), rule: v.rule_basis || v.basis || '', trigger: v.triggering_event || v.event || '', urgency: v.urgency || 'medium', sid });
    } else if (it.type === 'client_objective') {
      const text = v.objective || v.value || v.description || '';
      if (text) objectives.push({ text: clean(text), sid });
    } else if (it.type === 'next_step') {
      const text = v.step || v.action || v.value || v.description || '';
      if (text) nextSteps.push({ text: clean(text), owner: v.owner || 'unassigned', due: v.due_text || '', sid });
    } else if (it.type === 'unresolved_question') {
      const text = v.question || v.field || v.reason || v.value || '';
      if (text) unresolved.push({ text: clean(text), sid });
    } else if (it.type === 'risk_context') {
      const text = v.risk || v.reason || v.value || v.description || '';
      if (text) risks.push({ text: clean(text), sid });
    }
  }

  const lastSid = meetings.length ? meetings[meetings.length - 1].sessionId : null;
  const lastSummary = summarizeMeeting(lastSid, { summaries, issues, deadlines });

  return {
    items, meetings, order,
    summaries,
    facts: dedupeBy(facts, 'text'),
    issues: dedupeBy(issues, 'name'),
    parties: dedupeBy(parties, 'name'),
    deadlines: dedupeBy(deadlines, 'due'),
    objectives: dedupeBy(objectives, 'text'),
    nextSteps,
    unresolved,
    risks,
    lastSid,
    lastSummary,
  };
}

function summarizeMeeting(sid, rec) {
  if (!sid) return '';
  const summary = rec.summaries.find((s) => s.sid === sid)?.text;
  if (summary) return summary;
  const issue = rec.issues.filter((i) => i.sid === sid).map((i) => i.name).slice(0, 2).join(', ');
  const deadline = rec.deadlines.find((d) => d.sid === sid)?.due;
  const parts = [];
  if (issue) parts.push(issue);
  if (deadline) parts.push(`Deadline tracked: ${deadline}`);
  return parts.join('. ') || 'Meeting documented.';
}

/* ---------------- TODAY ---------------- */
function renderToday() {
  const rec = state.record || emptyRecord();
  const scn = SCENARIOS[state.scenario];
  const hasHistory = rec.meetings.length > 0;

  $('#brief-avatar').textContent = MATTER.initials;
  $('#brief-name').textContent = MATTER.clientLabel;
  $('#brief-meta').textContent = `${MATTER.matterNumber} \u00b7 ${MATTER.practice} \u00b7 09:30`;
  $('#brief-badge').textContent = scn.badge;
  $('#brief-lead').textContent = hasHistory
    ? 'Matter briefing, built from what Carry captured in earlier meetings.'
    : 'New matter. No prior meetings on file yet.';

  $('#brief-last').textContent = hasHistory ? rec.lastSummary : 'No prior meetings recorded for this matter.';
  setChips('#brief-deadlines', rec.deadlines.map((d) => d.due), 'None tracked yet');
  setChips('#brief-parties', rec.parties.map((p) => p.name), 'None recorded yet');
  setChips('#brief-issues', rec.issues.map((i) => i.name), hasHistory ? 'None spotted' : 'To be assessed');
  setList('#brief-unresolved', hasHistory ? openItems(rec) : ['Conflict check not yet run', 'Limitation deadline not yet verified']);
  setList('#brief-agenda', scn.agenda, true);

  const carried = [
    ...rec.deadlines.map((d) => `Deadline: ${d.due}`),
    ...rec.parties.map((p) => `Party: ${p.name}`),
    ...rec.issues.map((i) => i.name),
  ];
  const strip = $('#carried-strip');
  if (carried.length) {
    strip.hidden = false;
    setChips('#carried-list', carried.slice(0, 6));
  } else {
    strip.hidden = true;
  }

  const meetings = [
    { id: 'm1', time: '09:30', name: MATTER.clientLabel, reason: scn.reason, status: 'next' },
    ...OTHER_MEETINGS,
  ];
  $('#schedule-count').textContent = `${meetings.length} meetings`;
  $('#appt-list').innerHTML = meetings.map((m) => `
    <li class="appt-row ${m.status === 'next' ? 'is-next' : ''}">
      <span class="appt-time">${esc(m.time)}</span>
      <span>
        <span class="appt-name">${esc(m.name)}</span>
        <span class="appt-reason">${esc(m.reason)}</span>
      </span>
      ${m.status === 'next' ? '<span class="tag tag-live">Next</span>' : '<span class="tag">Scheduled</span>'}
    </li>`).join('');

  renderAttention(rec);
}

function openItems(rec) {
  const out = [];
  if (rec.deadlines.length) out.push('Verify limitation deadline and jurisdiction');
  if (rec.nextSteps.length) out.push(rec.nextSteps[rec.nextSteps.length - 1].text);
  out.push('Confirm client objective and desired remedy');
  return out.slice(0, 3);
}

function renderAttention(rec) {
  const tiles = [
    { label: 'Meetings captured', value: rec.meetings.length, tone: 'review', detail: 'Draft memos on record' },
    { label: 'Deadlines tracked', value: rec.deadlines.length, tone: 'flag', detail: 'Attorney verification required' },
    { label: 'Parties to check', value: rec.parties.length, tone: 'follow', detail: 'Conflict screen inputs' },
    { label: 'Issues spotted', value: rec.issues.length, tone: 'lab', detail: 'Suggestions only' },
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

/* ---------------- MATTER FILE ---------------- */
function renderMatter() {
  const rec = state.record || emptyRecord();
  const grid = $('#profile-grid');
  $('#profile-risk').hidden = rec.deadlines.length === 0;
  if (rec.deadlines.length) $('#profile-risk').textContent = `Deadline: ${rec.deadlines[0].due}`;

  if (!rec.meetings.length) {
    grid.innerHTML = `<section class="pcard"><h3>No matter memory yet</h3>
      <div class="prow"><div class="prow-sub">Run a meeting. Parties, facts, issues, and deadlines will appear here as Carry captures them.</div></div></section>`;
    return;
  }

  grid.innerHTML = [
    pcard('Deadlines', rec.deadlines.length
      ? rec.deadlines.map((d) => prow(d.due, `${d.rule || 'Rule basis requires verification'} · Captured in Meeting ${meetingN(d.sid)}`, `<span class="tag tag-danger">${esc(d.urgency || 'Review')}</span>`))
      : [emptyRow('No deadlines recorded')], 'deadline-card'),
    pcard('Parties and conflict screen', rec.parties.length
      ? rec.parties.map((p) => prow(p.name, `Captured in Meeting ${meetingN(p.sid)}`, '<span class="tag tag-warn">Check</span>'))
      : [emptyRow('No parties recorded')]),
    pcard('Legal issues', rec.issues.length
      ? rec.issues.map((i) => prow(i.name, `Captured in Meeting ${meetingN(i.sid)}`, '<span class="tag tag-teal">Suggestion</span>'))
      : [emptyRow('No issues spotted')]),
    pcard('Key facts', rec.facts.length
      ? rec.facts.map((f) => prow(f.text, f.date || `Meeting ${meetingN(f.sid)}`))
      : [emptyRow('No facts recorded')]),
    pcard('Next steps', rec.nextSteps.length
      ? rec.nextSteps.map((n) => prow(n.text, `${n.owner}${n.due ? ` · ${n.due}` : ''}`))
      : [emptyRow('No next steps recorded')], 'plan-card'),
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
  if (!rec.meetings.length) {
    tl.innerHTML = '<p class="muted">No history yet. Run a meeting to build the timeline.</p>';
    return;
  }
  const events = [];
  [...rec.meetings].reverse().forEach((m) => {
    const n = m.n;
    const fresh = m.sessionId === state.newestSession;
    const issue = rec.issues.filter((i) => i.sid === m.sessionId).map((i) => i.name);
    const deadline = rec.deadlines.filter((d) => d.sid === m.sessionId);
    const parties = rec.parties.filter((p) => p.sid === m.sessionId);
    events.push({ kind: 'visit', when: `Meeting ${n}`, title: issue[0] || 'Client meeting', detail: summarizeMeeting(m.sessionId, rec), tags: [`Meeting ${n}`, 'Captured'], fresh });
    deadline.forEach((d) => events.push({ kind: 'allergy', when: `Meeting ${n}`, title: `Deadline: ${d.due}`, detail: d.rule || 'Requires verification.', tags: ['Deadline'] }));
    parties.forEach((p) => events.push({ kind: 'medication', when: `Meeting ${n}`, title: `Party: ${p.name}`, detail: 'Added to conflict screen.', tags: ['Conflict check'] }));
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

/* ---------------- GRAPH ---------------- */
function renderGraph() {
  const rec = state.record || emptyRecord();
  const svg = $('#graph-canvas');
  const { nodes, edges } = buildGraph(rec);
  state.graphNodes = nodes;

  if (nodes.length <= 1) {
    svg.innerHTML = `<text x="500" y="330" text-anchor="middle" class="gnode-sub">Run a meeting to grow the knowledge graph.</text>`;
    $('#graph-status').textContent = 'No data yet';
    renderLegend();
    return;
  }

  const byId = (id) => nodes.find((n) => n.id === id);
  const edgeSvg = edges.filter((e) => byId(e.from) && byId(e.to)).map((e) => {
    const a = byId(e.from), b = byId(e.to);
    const cls = `gedge ${e.kind || ''} ${e.fresh ? 'gnew' : ''}`;
    return `<path class="${cls}" d="M ${a.x} ${a.y} L ${b.x} ${b.y}" />`;
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
  $('#graph-status').textContent = state.newestSession ? 'Updated after the latest meeting' : `Built from ${rec.meetings.length} meeting${rec.meetings.length > 1 ? 's' : ''}`;
  renderLegend();
}

function buildGraph(rec) {
  const cx = 500, cy = 330;
  const nodes = [{ id: 'matter', type: 'matter', label: MATTER.clientLabel, sub: 'Matter', x: cx, y: cy }];
  const edges = [];
  const count = rec.meetings.length;
  rec.meetings.forEach((m, mi) => {
    const mx = cx + (count === 1 ? 0 : (mi - (count - 1) / 2) * 300);
    const my = cy - 230;
    const mid = `meeting_${m.n}`;
    const fresh = m.sessionId === state.newestSession;
    nodes.push({ id: mid, type: 'meeting', label: `Meeting ${m.n}`, sub: 'Client call', x: mx, y: my, fresh, sid: m.sessionId });
    edges.push({ from: 'matter', to: mid, fresh });

    const facts = [
      ...rec.deadlines.filter((d) => d.sid === m.sessionId).map((d) => ({ type: 'deadline', label: d.due, sub: 'Deadline', src: d })),
      ...rec.parties.filter((p) => p.sid === m.sessionId).map((p) => ({ type: 'party', label: p.name, sub: 'Party', src: p })),
      ...rec.issues.filter((i) => i.sid === m.sessionId).map((i) => ({ type: 'issue', label: i.name, sub: 'Issue', src: i })),
      ...rec.facts.filter((f) => f.sid === m.sessionId).map((f) => ({ type: 'fact', label: f.text, sub: 'Fact', src: f })),
    ];
    const spread = 150;
    facts.slice(0, 6).forEach((f, fi) => {
      const fx = mx + (fi - (facts.length - 1) / 2) * spread;
      const fy = cy + 90 + (fi % 2) * 120;
      const fid = `${mid}_f${fi}`;
      nodes.push({ id: fid, type: f.type, label: f.label, sub: f.sub, x: clampX(fx), y: fy, fresh, detail: f });
      edges.push({ from: mid, to: fid, fresh, kind: f.type === 'deadline' ? 'conflict' : '' });
    });
  });
  return { nodes, edges };
}

function clampX(x) { return Math.max(110, Math.min(890, x)); }

function nodeColor(type) {
  const map = {
    matter: ['oklch(96% 0.024 244)', 'oklch(54% 0.108 244)', 'oklch(54% 0.108 244)'],
    meeting: ['oklch(96% 0.024 244)', 'oklch(80% 0.04 244)', 'oklch(54% 0.108 244)'],
    deadline: ['oklch(96% 0.04 27)', 'oklch(82% 0.06 27)', 'oklch(56% 0.142 27)'],
    party: ['oklch(96.5% 0.05 76)', 'oklch(84% 0.07 76)', 'oklch(64% 0.114 76)'],
    issue: ['oklch(96% 0.03 196)', 'oklch(82% 0.05 196)', 'oklch(58% 0.082 196)'],
    fact: ['oklch(97.2% 0.005 247)', 'oklch(88% 0.01 257)', 'oklch(58% 0.016 257)'],
  };
  const [fill, stroke, dot] = map[type] || map.meeting;
  return { fill, stroke, dot };
}

function renderLegend() {
  const types = [['Matter', 'matter'], ['Meeting', 'meeting'], ['Deadline', 'deadline'], ['Party', 'party'], ['Issue', 'issue'], ['Fact', 'fact']];
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
  const n = node.sid ? state.record.order.get(node.sid) : (d ? state.record.order.get(d.sid) : null);
  box.innerHTML = `
    <p class="block-label">Node detail</p>
    <p class="gd-name">${esc(node.label)}</p>
    <span class="tag">${esc(node.sub)}</span>
    ${d ? `
      <p class="gd-row"><b>Captured in</b><br>Meeting ${esc(String(n || '1'))}</p>
      ${d.rule ? `<p class="gd-row"><b>Rule basis</b><br>${esc(d.rule)}</p>` : ''}
      ${d.role ? `<p class="gd-row"><b>Role</b><br>${esc(d.role)}</p>` : ''}
      <p class="gd-row"><b>Source</b><br>Extracted live from the meeting conversation.</p>
    ` : node.type === 'meeting'
      ? `<p class="gd-row"><b>Source</b><br>A recorded client meeting. Connected facts were captured during this meeting.</p>`
      : '<p class="gd-row">Matter record root.</p>'}`;
}

/* ---------------- LIVE MEETING ---------------- */
function startMeeting() {
  if (state.running) return;
  resetMeeting();
  go('visit');
  state.running = true;
  $('#visit-scenario').textContent = state.scenario === 'meeting1' ? 'Meeting 1' : 'Meeting 2';
  $$('.launch-visit').forEach((b) => { b.disabled = true; b.textContent = 'Meeting in progress'; });
  $$('.scenario-opt').forEach((b) => { b.disabled = true; });
  $('#reset-demo') && ($('#reset-demo').disabled = true);
  setLive('live', 'Listening');

  const source = new EventSource(`/api/live?scenario=${state.scenario}`);
  state.source = source;

  source.addEventListener('chunk', (e) => onChunk(parse(e)));
  source.addEventListener('incremental_started', () => setLive('thinking', 'Understanding'));
  source.addEventListener('incremental', (e) => { onIncremental(parse(e).draft); setLive('live', 'Listening'); });
  source.addEventListener('final_started', () => setLive('thinking', 'Drafting memo'));
  source.addEventListener('final', (e) => onFinal(parse(e).output));
  source.addEventListener('notion_started', () => addAction('Notion sync', 'Preparing matter memo for sync.', 'tag'));
  source.addEventListener('notion', (e) => onNotion(parse(e)));
  source.addEventListener('done', (e) => finishMeeting(source, parse(e)));
  source.addEventListener('error', (e) => {
    if (e.data) addAction('Issue', parse(e).error || 'Stream error', 'tag-danger');
    if (source.readyState === EventSource.CLOSED) finishMeeting(source, {});
  });
}

function resetMeeting() {
  state.turns = 0; state.facts.clear(); state.issues.clear(); state.deadlines.clear(); state.conflicts = [];
  $('#convo-stream').innerHTML = '<p class="convo-empty">Listening for the meeting to begin.</p>';
  $('#convo-count').textContent = '0';
  ['f', 'i', 'a', 'n'].forEach((k) => { const el = $(`#memo-${k}`); el.textContent = 'Awaiting conversation'; el.className = 'pending'; });
  $('#memo-progress').textContent = 'Listening'; $('#memo-progress').className = 'tag';
  $('#live-facts').innerHTML = '<li class="live-empty">None detected yet</li>';
  $('#live-deadlines').innerHTML = '<li class="live-empty">No deadlines detected</li>';
  $('#live-issues').innerHTML = '<li class="live-empty">No issues spotted yet</li>';
  $('#live-missing').innerHTML = '<li class="live-empty">Memo looks complete so far</li>';
  $('#action-stack').innerHTML = '<p class="live-empty">Memo, calendar, and conflict-check drafts appear here as the meeting progresses.</p>';
  $('#review').hidden = true;
  $('#card-deadline').classList.remove('flag');
}

function onChunk(c) {
  state.turns += 1;
  $('#convo-count').textContent = String(state.turns);
  const stream = $('#convo-stream');
  stream.querySelector('.convo-empty')?.remove();
  const who = speakerRole(c.speaker);
  const turn = document.createElement('div');
  turn.className = `turn ${who === 'client' ? 'patient' : 'doctor'}`;

  const redactions = c.redactions || [];
  const original = c.incomingText || c.sanitizedText || '';
  const sanitized = c.sanitizedText || original;
  const hasRedactions = redactions.length > 0;
  const body = hasRedactions
    ? `<div class="turn-block">
         <span class="turn-tag raw">Captured</span>
         <div class="turn-text">${highlightOriginals(original, redactions)}</div>
       </div>
       <div class="turn-block">
         <span class="turn-tag safe">Sent for processing</span>
         <div class="turn-text">${highlightRedactions(sanitized, redactions)}</div>
       </div>
       <div class="turn-redact">${redactions.length} item${redactions.length > 1 ? 's' : ''} redacted before processing</div>`
    : `<div class="turn-text">${esc(sanitized)}</div>`;

  turn.innerHTML = `<span class="turn-who">${who === 'client' ? 'Client' : 'Attorney'}</span>${body}`;
  stream.appendChild(turn);
  stream.scrollTop = stream.scrollHeight;
}

function speakerRole(speaker) {
  const s = String(speaker || '').toLowerCase();
  if (s.includes('client') || /\b(person\s*2|speaker\s*2|p2|s2)\b/.test(s)) return 'client';
  if (s.includes('attorney') || s.includes('lawyer') || /\b(person\s*1|speaker\s*1|p1|s1)\b/.test(s)) return 'attorney';
  return 'attorney';
}

function highlightOriginals(text, redactions) {
  const src = String(text || '');
  const values = redactions.map((r) => r.value).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!values.length) return esc(src);
  const re = new RegExp(`(${values.map(escapeRegex).join('|')})`, 'g');
  const labelFor = new Map(redactions.map((r) => [r.value, (r.label || 'redacted').replace(/^private_/, '').replace(/_/g, ' ')]));
  let out = '', last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    out += `<mark class="redact raw" title="${esc(labelFor.get(m[0]) || 'redacted')} will be masked">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return out;
}

function highlightRedactions(text, redactions) {
  const src = String(text || '');
  const byPlaceholder = new Map();
  for (const r of redactions) if (r.placeholder) byPlaceholder.set(r.placeholder, r);
  const placeholders = [...byPlaceholder.keys()].sort((a, b) => b.length - a.length);
  if (!placeholders.length) return esc(src);
  const re = new RegExp(`(${placeholders.map(escapeRegex).join('|')})`, 'g');
  let out = '', last = 0;
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
  const deadline = draft.deadline_tracking || {};

  if (facts.summary) fillMemo('f', facts.summary);
  if (facts.matter_type) fillMemo('i', facts.matter_type);
  if ((draft.issue_spotting || []).length) fillMemo('a', listText((draft.issue_spotting || []).map((i) => i.issue || i)));
  if ((deadline.computed_deadlines || []).length) fillMemo('n', listText(deadline.computed_deadlines.map((d) => d.due_text || d.deadline || d)));
  $('#memo-progress').textContent = 'Drafting'; $('#memo-progress').className = 'tag tag-warn';

  (facts.key_facts || []).forEach((f) => addUniqueFact(formatVal(f)));
  (draft.issue_spotting || []).forEach((i) => addUniqueIssue(i.issue || formatVal(i), i.strength));
  (deadline.computed_deadlines || []).forEach((d) => addDeadline(d.due_text || d.deadline || formatVal(d), d.urgency, d.rule_basis));
  (deadline.timing_conflicts || []).forEach((c) => addTimingConflict(c));

  const missing = draft.missing_information_so_far || [];
  if (missing.length) {
    $('#live-missing').innerHTML = '';
    missing.slice(0, 4).forEach((m) => addLive('#live-missing', `<span class="li-mark"></span><span>${esc(m.field || m.reason || formatVal(m))}<span class="li-sub"> ${esc(m.reason && m.field ? m.reason : '')}</span></span>`));
  }
}

function addUniqueFact(text) {
  if (!text || state.facts.has(text)) return;
  state.facts.add(text);
  addLive('#live-facts', `<span class="li-mark warn"></span><span>${esc(text)}</span>`);
  pushUpdate(`Fact captured: ${clip(text, 48)}`);
}

function addUniqueIssue(text, strength = '') {
  if (!text || state.issues.has(text)) return;
  state.issues.add(text);
  addLive('#live-issues', `<span class="li-mark good"></span><span>${esc(text)}</span><span class="li-sub"> ${esc(strength || 'review')}</span>`);
  pushUpdate(`Issue spotted: ${clip(text, 48)}`);
}

function addDeadline(text, urgency = '', rule = '') {
  if (!text) return;
  const key = text.toLowerCase();
  if (state.deadlines.has(key)) return;
  state.deadlines.set(key, { text, urgency, rule });
  renderDeadlines();
  $('#card-deadline').classList.add('flag');
  addAction('Deadline draft', `${text}. Attorney verification required.`, 'tag-danger');
}

function addTimingConflict(c) {
  const text = c.reason || c.proposed_plan || formatVal(c);
  if (!text || state.conflicts.includes(text)) return;
  state.conflicts.push(text);
  renderDeadlines();
  $('#card-deadline').classList.add('flag');
  addAction('Timing conflict', text, 'tag-danger');
  pushUpdate('Timing conflict detected from prior matter memory');
}

function renderDeadlines() {
  const rows = [];
  for (const d of state.deadlines.values()) {
    rows.push(`<li><span class="li-mark bad"></span><span>${esc(d.text)}</span><span class="li-sub"> ${esc(d.rule || 'verify')}</span></li>`);
  }
  state.conflicts.forEach((c) => rows.push(`<li><span class="li-mark bad"></span><span class="li-strike">${esc(c)}</span><span class="li-sub"> conflicts</span></li>`));
  $('#live-deadlines').innerHTML = rows.length ? rows.join('') : '<li class="live-empty">No deadlines detected</li>';
}

function fillMemo(k, text) {
  const el = $(`#memo-${k}`);
  const val = clean(text);
  if (!val || el.textContent === val) return;
  el.textContent = val;
  el.className = 'filled';
}

function addLive(sel, html, prepend) {
  const list = $(sel);
  list.querySelector('.live-empty')?.remove();
  const li = document.createElement('li');
  li.innerHTML = html;
  prepend ? list.prepend(li) : list.appendChild(li);
}

function addAction(title, body, tag = 'tag') {
  const stack = $('#action-stack');
  stack.querySelector('.live-empty')?.remove();
  const card = document.createElement('div');
  card.className = 'action-card';
  card.innerHTML = `<div class="action-card-head"><span class="action-title">${esc(title)}</span><span class="tag ${tag}">Draft</span></div>
    <div class="action-body">${esc(body)}</div>`;
  stack.prepend(card);
}

function onFinal(output) {
  setLive('thinking', 'Preparing review');
  const memo = output.matter_memo || {};
  fillMemo('f', summaryText(memo.facts) || summaryText(memo.summary) || $('#memo-f').textContent);
  fillMemo('i', summaryText(memo.issues) || $('#memo-i').textContent);
  fillMemo('a', summaryText(memo.analysis) || $('#memo-a').textContent);
  fillMemo('n', summaryText(memo.next_steps) || $('#memo-n').textContent);
  $('#memo-progress').textContent = 'Ready for review'; $('#memo-progress').className = 'tag tag-good';

  const deadlines = output.deadline_tracking?.computed_deadlines || [];
  deadlines.forEach((d) => addDeadline(d.due_text || d.deadline || formatVal(d), d.urgency, d.rule_basis));
  const steps = output.next_steps || [];
  steps.slice(0, 2).forEach((s) => addAction('Next step', `${s.step || formatVal(s)}${s.due_text ? `, ${s.due_text}` : ''}`, 'tag-teal'));
  renderReview(output);
}

function renderReview(output) {
  const memo = output.matter_memo || {};
  const deadlines = output.deadline_tracking || {};
  const conflict = output.conflict_screen || {};
  const steps = output.next_steps || [];
  const issues = output.issue_spotting || [];
  const items = [
    reviewItem('Matter memo', 'Draft', `<p><b>Facts:</b> ${esc(summaryText(memo.facts))}</p><p><b>Issues:</b> ${esc(summaryText(memo.issues))}</p><p><b>Next:</b> ${esc(summaryText(memo.next_steps))}</p>`, true),
    reviewItem('Deadline tracking', 'Verify', `<p>${esc(listText(deadlines.computed_deadlines) || 'No deadline suggested')}</p><p>${esc(listText(deadlines.timing_conflicts) || 'No timing conflicts')}</p>`),
    reviewItem('Issue spotting', 'Suggestion', issues.length ? issues.map((i) => `<p>${esc(i.issue)} ${esc(i.strength || '')}</p>`).join('') : '<p>No issues spotted</p>'),
    reviewItem('Conflict screen', 'Check', `<p>${esc(listText(conflict.parties_to_check) || 'No parties listed')}</p><p>${esc(conflict.note || 'Run firm conflict process')}</p>`),
    reviewItem('Next steps', 'Draft', steps.length ? steps.map((s) => `<p>${esc(s.step || formatVal(s))} ${esc(s.due_text || '')}</p>`).join('') : '<p>No next steps suggested</p>'),
  ];
  $('#review-grid').innerHTML = items.join('');
  $('#review').hidden = false;
}

function reviewItem(title, status, body, full) {
  const tag = status === 'Draft' ? 'tag-warn' : status === 'Verify' ? 'tag-danger' : status === 'Check' ? 'tag-teal' : 'tag';
  return `<div class="review-item ${full ? 'full' : ''}">
    <div class="review-item-head"><h4>${esc(title)}</h4><span class="tag ${tag}">${esc(status)}</span></div>${body}</div>`;
}

function onNotion(data) {
  if (data.ok && data.page?.url) addAction('Notion synced', `Matter memo created. ${data.page.url}`, 'tag-good');
  else if (data.ok) addAction('Notion synced', 'Matter memo created in Notion.', 'tag-good');
  else addAction('Notion sync', `Needs review: ${data.error || 'unknown error'}`, 'tag-warn');
}

async function finishMeeting(source, payload) {
  source?.close();
  state.source = null;
  state.running = false;
  state.newestSession = payload?.sessionId || null;
  setLive('done', 'Meeting complete');
  $$('.launch-visit').forEach((b) => { b.disabled = false; b.textContent = 'Begin next meeting'; });
  $$('.scenario-opt').forEach((b) => { b.disabled = false; });
  $('#reset-demo') && ($('#reset-demo').disabled = false);
  await refresh();
  pushUpdate('Matter memory updated from the latest meeting');
  if (state.scenario === 'meeting2') pushUpdate('Deadline catch now spans both meetings');
}

function setLive(stateName, label) {
  $('#live-dot').dataset.state = stateName;
  $('#live-label').textContent = label;
}

async function resetDemo() {
  if (state.running) return;
  await fetch(`/api/reset?entityId=${ENTITY}`).catch(() => {});
  state.newestSession = null;
  $('#update-list').innerHTML = '<li class="update-empty">Updates from meetings appear here as Carry understands them.</li>';
  await refresh();
  go('today');
}

/* ---------------- utils ---------------- */
function emptyRecord() {
  return { items: [], meetings: [], order: new Map(), summaries: [], facts: [], issues: [], parties: [], deadlines: [], objectives: [], nextSteps: [], unresolved: [], risks: [], lastSummary: '' };
}
function meetingN(sid) { return state.record?.order.get(sid) || 1; }
function setChips(sel, arr, empty) {
  const el = $(sel);
  el.innerHTML = arr.length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : (empty ? `<li class="li-muted">${esc(empty)}</li>` : '');
}
function setList(sel, arr) { $(sel).innerHTML = (arr || []).map((x) => `<li>${esc(x)}</li>`).join(''); }
function dedupeBy(arr, key) {
  const seen = new Set(), out = [];
  for (const x of arr) { const k = (x[key] || '').toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
function parse(e) { try { return JSON.parse(e.data); } catch { return {}; } }
function listText(v) { return toList(v).join('; '); }
function toList(v) { if (!v) return []; if (Array.isArray(v)) return v.map(formatVal).filter(Boolean); return [formatVal(v)].filter(Boolean); }
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
  if (typeof v === 'object') return Object.values(v).map(formatVal).filter(Boolean).join(' ');
  return String(v);
}
function clean(v) { return String(formatVal(v) || '').replace(/\[PRIVATE_[^\]]+\]/g, '').replace(/\s+/g, ' ').trim(); }
function clip(s, n) { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
function esc(v = '') { return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
