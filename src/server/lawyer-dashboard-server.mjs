import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CarryBackend } from '../core/carry-backend.mjs';
import { getLawyerScenario, streamChunks } from '../simulators/lawyer-transcript-simulator.mjs';
import { ScalekitNotionWriter } from '../integrations/scalekit-notion-writer.mjs';
import { LiveTranscriptWsConsumer } from '../transcripts/live-transcript-ws-consumer.mjs';
import { shouldKeepSegmentAfterCutoff } from '../transcripts/transcript-timestamp-filter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public-lawyer');
const port = Number(process.env.LAWYER_PORT || 5174);
const ENTITY = 'matter_demo_001';
const activeLiveSessions = new Map();
const serverRunId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const realEntityId = process.env.CARRY_LAWYER_REAL_ENTITY_ID || `matter_real_live_${serverRunId}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/live') return handleLive(req, res, url);
    if (url.pathname === '/api/end-live') return sendJson(res, endLiveSession(url.searchParams.get('sessionId')));
    if (url.pathname === '/api/reset') return sendJson(res, resetRecord(url.searchParams.get('entityId') || ENTITY));
    if (url.pathname === '/api/sessions') return sendJson(res, listSessions());
    if (url.pathname === '/api/context') return sendJson(res, listContext(url.searchParams.get('entityId') || ENTITY));
    if (url.pathname === '/api/mode') return sendJson(res, runtimeMode());
    if (url.pathname === '/api/health') return sendJson(res, { ok: true, name: 'Carry lawyer dashboard' });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || String(error) }, 500);
  }
});

server.listen(port, () => {
  console.log(`Carry lawyer dashboard running at http://localhost:${port}`);
  console.log('Open the URL, then press Start meeting.');
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
  const requestedSource = url.searchParams.get('source') || process.env.CARRY_TRANSCRIPT_SOURCE || 'simulator';
  const sourceMode = ['websocket', 'real', 'live'].includes(requestedSource) ? 'websocket' : 'simulator';
  const scenario = sourceMode === 'simulator'
    ? (url.searchParams.get('scenario') === 'meeting1' ? 'meeting1' : 'meeting2')
    : 'real_websocket';
  const entityId = sourceMode === 'websocket' ? realEntityId : ENTITY;
  const meetingStartedAt = new Date();
  const meetingStartCutoffMs = meetingStartedAt.getTime();
  const carry = new CarryBackend({ profession: 'lawyer' });
  const minChunks = carry.config.app.processing?.min_new_chunks_for_incremental_pass || 4;
  const llm = {
    model: carry.config.profession.llm?.model || carry.config.app.llm?.default_model,
    provider: carry.config.app.llm?.provider,
  };

  const session = carry.createSession({
    profession: 'lawyer',
    entityType: 'matter',
    entityId,
    source: sourceMode === 'websocket' ? 'poc_global_live_transcript_websocket' : 'dashboard_live_simulator',
    metadata: { meeting_type: 'client_meeting', demo: true, scenario, source_mode: sourceMode },
  });

  emit('session', {
    sessionId: session.session_id,
    entityId: session.entity_id,
    scenario,
    sourceMode,
    privacyEnabled: Boolean(carry.config.app.privacy?.enabled),
    minChunks,
    delayMs,
    llm,
    notionEnabled: Boolean(process.env.NOTION_CONNECTION_NAME),
    websocket: sourceMode === 'websocket' ? {
      backendUrl: process.env.CARRY_BACKEND_WS_URL || 'https://aa22-42-104-224-81.ngrok-free.app',
      endPolicy: 'explicit_button_only',
      entityId,
      meetingStartedAtUtc: meetingStartedAt.toISOString(),
    } : null,
  });

  const state = {
    chunksSincePass: 0,
    incrementalCount: 0,
    incrementalRunning: false,
    incrementalQueued: false,
    incrementalPromise: Promise.resolve(),
  };

  const scheduleIncremental = (reason = 'threshold') => {
    if (closed) return;
    if (state.incrementalRunning) {
      state.incrementalQueued = true;
      emit('incremental_queued', { reason, chunksSincePass: state.chunksSincePass });
      return;
    }

    const pass = ++state.incrementalCount;
    const chunkSnapshot = state.chunksSincePass;
    state.chunksSincePass = 0;
    state.incrementalRunning = true;
    emit('incremental_started', { pass, reason, chunks: chunkSnapshot });

    state.incrementalPromise = (async () => {
      try {
        const draft = await carry.processIncremental(session.session_id);
        emit('incremental', { pass, draft });
      } catch (error) {
        emit('incremental', { pass, draft: null, note: 'incremental skipped' });
      } finally {
        state.incrementalRunning = false;
        if (!closed && (state.incrementalQueued || state.chunksSincePass >= minChunks)) {
          state.incrementalQueued = false;
          scheduleIncremental('queued_while_processing');
        }
      }
    })();
  };

  const waitForIncrementalIdle = async () => {
    while (state.incrementalRunning) await state.incrementalPromise.catch(() => {});
  };

  const ingestAndMaybeProcess = async (chunk) => {
    if (closed) return;
    const result = carry.ingestChunk({ sessionId: session.session_id, ...chunk });
    state.chunksSincePass++;
    emit('chunk', {
      chunkId: chunk.chunkId,
      speaker: chunk.speaker,
      incomingText: chunk.text,
      sanitizedText: result.sanitizedText,
      redactions: result.redactions,
      speakerId: result.speakerId,
      sourceMode,
    });

    if (state.chunksSincePass >= minChunks) scheduleIncremental('enough_context');
  };

  try {
    if (sourceMode === 'websocket') {
      const transcriptResult = await consumeRealTranscript({ sessionId: session.session_id, req, emit, ingestAndMaybeProcess, url, isClosed: () => closed, meetingStartCutoffMs, meetingStartedAt });
      if (closed) return;
      emit('websocket_complete', transcriptResult);
    } else {
      await streamChunks(getLawyerScenario(scenario), ingestAndMaybeProcess, { delayMs });
    }

    await waitForIncrementalIdle();
    if (closed) return;
    emit('final_started', {});
    const finalOutput = await carry.endSession(session.session_id, 'dashboard_live_completed');
    emit('final', { output: finalOutput });

    emit('notion_started', {});
    try {
      const writer = new ScalekitNotionWriter(carry.config);
      const page = await writer.createLawyerMatterPage({ sessionId: session.session_id, output: finalOutput });
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

async function consumeRealTranscript({ sessionId, req, emit, ingestAndMaybeProcess, url, isClosed, meetingStartCutoffMs, meetingStartedAt }) {
  const backendUrl = url.searchParams.get('backendUrl') || process.env.CARRY_BACKEND_WS_URL || 'https://aa22-42-104-224-81.ngrok-free.app';
  const consumer = new LiveTranscriptWsConsumer({ backendUrl });
  const controller = new AbortController();
  const seen = new Map();
  const speakerAliases = new Map();
  let chunks = 0;
  let skippedBeforeStart = 0;
  let skippedMissingTimestamp = 0;
  let done = false;
  let resolveDone;
  const donePromise = new Promise((resolve) => { resolveDone = resolve; });

  const finish = (reason) => {
    if (done) return;
    done = true;
    activeLiveSessions.delete(sessionId);
    controller.abort();
    resolveDone(reason);
  };

  activeLiveSessions.set(sessionId, { finish, startedAt: new Date().toISOString(), source: 'websocket' });
  req.on('close', () => finish('client_disconnected'));

  const run = consumer.consume({
    signal: controller.signal,
    onEvent: async (event) => {
      if (isClosed() || done) return;
      const eventType = event.type;
      if (eventType === 'live_transcript_connected') {
        emit('websocket_status', { status: 'connected', scope: event.scope || 'global' });
        return;
      }
      if (eventType === 'live_transcript_heartbeat') {
        emit('websocket_status', { status: 'heartbeat' });
        return;
      }
      if (eventType === 'conversation.started') {
        emit('websocket_status', { status: 'conversation_started', conversationId: event.conversation_id });
        return;
      }
      if (eventType === 'transcript.deleted') {
        emit('websocket_status', { status: 'transcript_deleted', segmentIds: event.segment_ids || [] });
        return;
      }
      if (eventType === 'translation.ready') {
        emit('websocket_status', { status: 'translation_ready' });
        return;
      }
      if (eventType !== 'transcript.updated') {
        emit('websocket_status', { status: 'event', eventType });
        return;
      }

      const segments = event.segments || [];
      const visibleSegments = [];
      let eventSkippedBeforeStart = 0;
      let eventSkippedMissingTimestamp = 0;

      for (const segment of segments) {
        const decision = shouldKeepSegmentAfterCutoff({ segment, event, cutoffMs: meetingStartCutoffMs });
        if (decision.keep) {
          visibleSegments.push({ segment, decision });
        } else if (decision.reason === 'missing_timestamp') {
          skippedMissingTimestamp++;
          eventSkippedMissingTimestamp++;
        } else {
          skippedBeforeStart++;
          eventSkippedBeforeStart++;
        }
      }

      emit('websocket_status', {
        status: 'transcript_updated',
        segmentCount: visibleSegments.length,
        rawSegmentCount: segments.length,
        skippedBeforeStart: eventSkippedBeforeStart,
        skippedMissingTimestamp: eventSkippedMissingTimestamp,
        totalSkippedBeforeStart: skippedBeforeStart,
        totalSkippedMissingTimestamp: skippedMissingTimestamp,
        meetingStartedAtUtc: meetingStartedAt.toISOString(),
        speakers: [...new Set(visibleSegments.map(({ segment }) => rawSpeakerLabel(segment)).filter(Boolean))],
      });

      for (const [index, { segment, decision }] of visibleSegments.entries()) {
        const text = String(segment?.text || '').trim();
        if (!text) continue;
        const segmentId = segment.id || segment.segment_id || segment.transcript_segment_id || `${event.id || 'event'}_${index}`;
        const key = String(segmentId);
        if (seen.get(key) === text) continue;
        seen.set(key, text);
        chunks++;
        const rawSpeaker = rawSpeakerLabel(segment);
        await ingestAndMaybeProcess({
          chunkId: `ws_${safeChunkId(key)}`,
          speaker: stableSpeakerLabel(rawSpeaker, speakerAliases),
          text,
          startMs: segment.start_ms ?? segment.startMs ?? segment.start_time_ms ?? null,
          endMs: segment.end_ms ?? segment.endMs ?? segment.end_time_ms ?? null,
          confidence: segment.confidence ?? null,
          isFinal: segment.is_final ?? segment.final ?? true,
          receivedAt: new Date(decision.timestampMs).toISOString(),
        });
      }
    },
  }).catch((error) => {
    if (!done) emit('websocket_status', { status: 'error', error: error.message || String(error) });
  });

  emit('websocket_status', { status: 'connecting', backendUrl, endPolicy: 'explicit_button_only', meetingStartedAtUtc: meetingStartedAt.toISOString() });
  const reason = await donePromise;
  await run.catch(() => {});
  return { reason, chunks, skippedBeforeStart, skippedMissingTimestamp, meetingStartedAtUtc: meetingStartedAt.toISOString() };
}

function rawSpeakerLabel(segment = {}) {
  if (segment.speaker) return String(segment.speaker);
  if (segment.speaker_id !== undefined && segment.speaker_id !== null) return `speaker_${segment.speaker_id}`;
  return 'speaker_unknown';
}

function stableSpeakerLabel(raw, aliases) {
  const key = String(raw || 'speaker_unknown');
  if (!aliases.has(key)) aliases.set(key, `Speaker ${aliases.size + 1}`);
  return aliases.get(key);
}

function endLiveSession(sessionId) {
  let targetSessionId = sessionId;
  let active = targetSessionId ? activeLiveSessions.get(targetSessionId) : null;

  if (!active && activeLiveSessions.size > 0) {
    [targetSessionId, active] = [...activeLiveSessions.entries()]
      .sort((a, b) => String(b[1].startedAt).localeCompare(String(a[1].startedAt)))[0];
  }

  if (!active) {
    return {
      ok: false,
      error: 'No active live session',
      activeSessionIds: [...activeLiveSessions.keys()],
    };
  }

  active.finish('ended_by_user');
  return { ok: true, sessionId: targetSessionId, reason: 'ended_by_user' };
}

function safeChunkId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || `seg_${Date.now()}`;
}

function runtimeMode() {
  const requested = process.env.CARRY_TRANSCRIPT_SOURCE || 'simulator';
  const transcriptSource = ['websocket', 'real', 'live'].includes(requested) ? 'websocket' : 'simulator';
  return {
    transcriptSource,
    backendUrl: process.env.CARRY_BACKEND_WS_URL || 'https://aa22-42-104-224-81.ngrok-free.app',
    endPolicy: transcriptSource === 'websocket' ? 'explicit_button_only' : 'simulator_auto_end',
    realEntityId,
  };
}

function listSessions() {
  const carry = new CarryBackend({ profession: 'lawyer' });
  const rows = carry.store.db.prepare(`
    SELECT s.*,
      (SELECT output_json FROM outputs o WHERE o.session_id = s.session_id AND o.pass_type = 'final' ORDER BY o.created_at DESC LIMIT 1) AS final_output_json,
      (SELECT COUNT(*) FROM transcript_chunks c WHERE c.session_id = s.session_id) AS chunk_count
    FROM sessions s
    WHERE s.profession = 'lawyer'
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
      summary: output.matter_memo?.summary?.draft || 'Meeting in progress',
    };
  });
}

function listContext(entityId) {
  const carry = new CarryBackend({ profession: 'lawyer' });
  const items = carry.store.listMemoryItems({
    profession: 'lawyer',
    entityType: 'matter',
    entityId,
    limit: 80,
  });
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
  const carry = new CarryBackend({ profession: 'lawyer' });
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
