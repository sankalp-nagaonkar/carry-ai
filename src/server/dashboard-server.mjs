import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CarryBackend } from '../core/carry-backend.mjs';
import { getDoctorScenario, streamChunks } from '../simulators/doctor-transcript-simulator.mjs';
import { ScalekitNotionWriter } from '../integrations/scalekit-notion-writer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');
const port = Number(process.env.PORT || 5173);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/live') return handleLive(req, res, url);
    if (url.pathname === '/api/reset') return sendJson(res, resetRecord(url.searchParams.get('entityId') || 'patient_demo_001'));
    if (url.pathname === '/api/sessions') return sendJson(res, listSessions());
    if (url.pathname === '/api/context') return sendJson(res, listContext(url.searchParams.get('entityId') || 'patient_demo_001'));
    if (url.pathname === '/api/health') return sendJson(res, { ok: true, name: 'Carry dashboard' });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || String(error) }, 500);
  }
});

server.listen(port, () => {
  console.log(`Carry dashboard running at http://localhost:${port}`);
  console.log('Open the URL, then press Start live demo.');
});

async function handleLive(req, res, url) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  req.on('close', () => { closed = true; });

  const emit = (event, data = {}) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const delayMs = Number(url.searchParams.get('delayMs') || process.env.SIM_DELAY_MS || 1500);
  const scenario = url.searchParams.get('scenario') === 'visit1' ? 'visit1' : 'visit2';
  const carry = new CarryBackend({ profession: 'doctor' });
  const minChunks = carry.config.app.processing?.min_new_chunks_for_incremental_pass || 4;
  const llm = {
    model: carry.config.profession.llm?.model || carry.config.app.llm?.default_model,
    provider: carry.config.app.llm?.provider,
  };

  const session = carry.createSession({
    profession: 'doctor',
    entityType: 'patient',
    entityId: 'patient_demo_001',
    source: 'dashboard_live_simulator',
    metadata: { encounter_type: 'outpatient_visit', demo: true, scenario },
  });

  emit('session', {
    sessionId: session.session_id,
    entityId: session.entity_id,
    scenario,
    privacyEnabled: Boolean(carry.config.app.privacy?.enabled),
    minChunks,
    delayMs,
    llm,
    notionEnabled: Boolean(process.env.NOTION_CONNECTION_NAME),
  });

  let chunksSincePass = 0;
  let incrementalCount = 0;

  try {
    await streamChunks(getDoctorScenario(scenario), async (chunk) => {
      if (closed) return;
      const result = carry.ingestChunk({ sessionId: session.session_id, ...chunk });
      chunksSincePass++;
      emit('chunk', {
        chunkId: chunk.chunkId,
        speaker: chunk.speaker,
        incomingText: chunk.text,
        sanitizedText: result.sanitizedText,
        redactions: result.redactions,
        speakerId: result.speakerId,
      });

      if (chunksSincePass >= minChunks) {
        incrementalCount++;
        emit('incremental_started', { pass: incrementalCount });
        try {
          const draft = await carry.processIncremental(session.session_id);
          emit('incremental', { pass: incrementalCount, draft });
        } catch (error) {
          // A failed incremental pass must not abort the visit. The final pass is
          // authoritative for the record. Surface it quietly and continue.
          emit('incremental', { pass: incrementalCount, draft: null, note: 'incremental skipped' });
        }
        chunksSincePass = 0;
      }
    }, { delayMs });

    if (closed) return;
    emit('final_started', {});
    const finalOutput = await carry.endSession(session.session_id, 'dashboard_live_completed');
    emit('final', { output: finalOutput });

    emit('notion_started', {});
    try {
      const writer = new ScalekitNotionWriter(carry.config);
      const page = await writer.createDoctorVisitPage({ sessionId: session.session_id, output: finalOutput });
      emit('notion', { ok: true, page });
    } catch (error) {
      emit('notion', { ok: false, error: error.message || String(error) });
    }

    emit('done', { sessionId: session.session_id });
  } catch (error) {
    emit('error', { error: error.message || String(error) });
  } finally {
    if (!closed) res.end();
  }
}

function listSessions() {
  const carry = new CarryBackend({ profession: 'doctor' });
  const rows = carry.store.db.prepare(`
    SELECT s.*,
      (SELECT output_json FROM outputs o WHERE o.session_id = s.session_id AND o.pass_type = 'final' ORDER BY o.created_at DESC LIMIT 1) AS final_output_json,
      (SELECT COUNT(*) FROM transcript_chunks c WHERE c.session_id = s.session_id) AS chunk_count
    FROM sessions s
    ORDER BY s.started_at DESC
    LIMIT 20
  `).all();

  return rows.map((row) => {
    const output = parseJson(row.final_output_json) || {};
    return {
      sessionId: row.session_id,
      profession: row.profession,
      status: row.status,
      source: row.source,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      entityId: row.entity_id,
      chunkCount: row.chunk_count,
      finalStatus: output.status,
      summary: output.soap_note?.subjective?.chief_complaint || output.patient_summary?.draft || 'Session in progress',
      safetyCount: (output.safety_flags?.red_flags_present || []).length,
      followUp: output.follow_up_plan?.timeframe_text,
      actionCount: (output.action_plan || []).length,
    };
  });
}

function listContext(entityId) {
  const carry = new CarryBackend({ profession: 'doctor' });
  const items = carry.store.listMemoryItems({
    profession: 'doctor',
    entityType: 'patient',
    entityId,
    limit: 60,
  });
  // Oldest first so the client can order visits chronologically.
  items.reverse();
  const sessions = carry.store.db.prepare(`
    SELECT session_id, started_at, ended_at,
      json_extract(metadata_json, '$.scenario') AS scenario
    FROM sessions WHERE entity_id = ? ORDER BY started_at ASC
  `).all(entityId).map((r) => ({
    sessionId: r.session_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    scenario: r.scenario,
  }));
  return { entityId, sessions, items };
}

function resetRecord(entityId) {
  const carry = new CarryBackend({ profession: 'doctor' });
  const db = carry.store.db;
  const sids = db.prepare('SELECT session_id FROM sessions WHERE entity_id = ?').all(entityId).map((r) => r.session_id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memory_items WHERE entity_id = ?').run(entityId);
    for (const sid of sids) {
      db.prepare('DELETE FROM transcript_chunks WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM outputs WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM audit_events WHERE session_id = ?').run(sid);
    }
    db.prepare('DELETE FROM sessions WHERE entity_id = ?').run(entityId);
  });
  tx();
  return { ok: true, entityId, clearedSessions: sids.length };
}

function serveStatic(res, requestPath) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
  const target = path.normalize(path.join(publicDir, cleanPath));
  if (!target.startsWith(publicDir)) return sendText(res, 'Not found', 404);

  fs.readFile(target, (error, data) => {
    if (error) return sendText(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': mimeFor(target) });
    res.end(data);
  });
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
