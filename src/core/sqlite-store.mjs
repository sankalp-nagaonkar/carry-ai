import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

function safeJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

export class SQLiteStore {
  constructor(config) {
    const dbPath = config.app.storage?.sqlite_path || 'data/carry.sqlite';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        profession TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS transcript_chunks (
        session_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        source_speaker_label TEXT NOT NULL,
        raw_text TEXT,
        sanitized_text TEXT NOT NULL,
        redactions_json TEXT,
        start_ms INTEGER,
        end_ms INTEGER,
        confidence REAL,
        is_final INTEGER,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, chunk_id)
      );
      CREATE TABLE IF NOT EXISTS outputs (
        output_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        pass_type TEXT NOT NULL,
        output_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_items (
        memory_id TEXT PRIMARY KEY,
        profession TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        session_id TEXT NOT NULL,
        type TEXT,
        value_json TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        audit_id TEXT PRIMARY KEY,
        session_id TEXT,
        chunk_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  createSession({ profession, entityType, entityId, source, metadata = {} }) {
    const now = new Date().toISOString();
    const sessionId = uuidv4();
    this.db.prepare(`INSERT INTO sessions (session_id, profession, entity_type, entity_id, source, status, metadata_json, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sessionId, profession, entityType || null, entityId || null, source, 'active', JSON.stringify(metadata), now);
    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    return this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  }

  endSession(sessionId, reason = 'completed') {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE session_id = ?').run('completed', now, sessionId);
    this.audit({ sessionId, eventType: 'session_ended', payload: { reason } });
    return this.getSession(sessionId);
  }

  upsertChunk(chunk) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT chunk_id FROM transcript_chunks WHERE session_id = ? AND chunk_id = ?').get(chunk.sessionId, chunk.chunkId);
    this.db.prepare(`INSERT INTO transcript_chunks (
        session_id, chunk_id, speaker_id, source_speaker_label, raw_text, sanitized_text, redactions_json,
        start_ms, end_ms, confidence, is_final, received_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, chunk_id) DO UPDATE SET
        speaker_id=excluded.speaker_id,
        source_speaker_label=excluded.source_speaker_label,
        raw_text=excluded.raw_text,
        sanitized_text=excluded.sanitized_text,
        redactions_json=excluded.redactions_json,
        start_ms=excluded.start_ms,
        end_ms=excluded.end_ms,
        confidence=excluded.confidence,
        is_final=excluded.is_final,
        updated_at=excluded.updated_at`)
      .run(
        chunk.sessionId, chunk.chunkId, chunk.speakerId, chunk.sourceSpeakerLabel,
        chunk.rawText ?? null, chunk.sanitizedText, JSON.stringify(chunk.redactions || []),
        chunk.startMs ?? null, chunk.endMs ?? null, chunk.confidence ?? null, chunk.isFinal ? 1 : 0,
        chunk.receivedAt || now, now
      );
    this.audit({ sessionId: chunk.sessionId, chunkId: chunk.chunkId, eventType: existing ? 'chunk_updated' : 'chunk_inserted', payload: { redactionCount: chunk.redactions?.length || 0 } });
  }

  listChunks(sessionId) {
    return this.db.prepare('SELECT * FROM transcript_chunks WHERE session_id = ? ORDER BY COALESCE(start_ms, 999999999), received_at, chunk_id').all(sessionId);
  }

  saveOutput({ sessionId, passType, output }) {
    const outputId = uuidv4();
    this.db.prepare('INSERT INTO outputs (output_id, session_id, pass_type, output_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(outputId, sessionId, passType, JSON.stringify(output), new Date().toISOString());
    return outputId;
  }

  saveMemoryItems({ session, items = [] }) {
    const stmt = this.db.prepare(`INSERT INTO memory_items (memory_id, profession, entity_type, entity_id, session_id, type, value_json, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    for (const item of items.filter((x) => x?.store !== false)) {
      stmt.run(uuidv4(), session.profession, session.entity_type, session.entity_id, session.session_id, item.type || null, JSON.stringify(item.value ?? item), item.confidence ?? null, now);
    }
  }

  listMemoryItems({ profession, entityType, entityId, limit = 20 }) {
    if (!entityId) return [];
    return this.db.prepare(`SELECT * FROM memory_items
      WHERE profession = ? AND entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC LIMIT ?`).all(profession, entityType, entityId, limit)
      .map((row) => ({
        ...row,
        value: safeJson(row.value_json),
      }));
  }

  audit({ sessionId = null, chunkId = null, eventType, payload = {} }) {
    this.db.prepare('INSERT INTO audit_events (audit_id, session_id, chunk_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), sessionId, chunkId, eventType, JSON.stringify(payload), new Date().toISOString());
  }
}
