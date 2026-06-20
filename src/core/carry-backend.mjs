import { loadConfig } from '../config/config-loader.mjs';
import { FastrouterClient } from '../llm/fastrouter-client.mjs';
import { SQLiteStore } from './sqlite-store.mjs';
import { PrivacyFilterService } from './privacy-filter-service.mjs';
import { DoctorBrain } from '../professions/doctor/doctor-brain.mjs';
import { LawyerBrain } from '../professions/lawyer/lawyer-brain.mjs';

export class CarryBackend {
  constructor({ profession = 'doctor' } = {}) {
    this.profession = profession;
    this.config = loadConfig({ profession });
    this.store = new SQLiteStore(this.config);
    this.privacy = new PrivacyFilterService(this.config);
    this.llm = new FastrouterClient(this.config);
    if (profession === 'lawyer') {
      this.brain = new LawyerBrain({ config: this.config, llm: this.llm, store: this.store });
    } else {
      this.brain = new DoctorBrain({ config: this.config, llm: this.llm, store: this.store });
    }
    this.doctorBrain = this.brain;
    this.speakerMap = new Map();
  }

  createSession({ profession = 'doctor', entityType = 'patient', entityId, source = 'api', metadata = {} }) {
    const session = this.store.createSession({ profession, entityType, entityId, source, metadata });
    this.store.audit({ sessionId: session.session_id, eventType: 'session_created', payload: { profession, entityType, entityId, source } });
    return session;
  }

  ingestChunk({ sessionId, chunkId, speaker, text, startMs, endMs, confidence, isFinal = true, receivedAt }) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const speakerId = this.normalizeSpeaker(sessionId, speaker);
    const filtered = this.privacy.filterChunk({ sessionId, chunkId, text });

    const retainRaw = this.config.app.privacy?.raw_retention_policy === 'retain_raw_encrypted' ||
      this.config.app.privacy?.raw_retention_policy === 'retain_raw_for_debug_local_only';

    this.store.upsertChunk({
      sessionId,
      chunkId,
      speakerId,
      sourceSpeakerLabel: speaker,
      rawText: retainRaw ? text : null,
      sanitizedText: filtered.sanitizedText,
      redactions: filtered.redactions,
      startMs,
      endMs,
      confidence,
      isFinal,
      receivedAt,
    });

    this.store.audit({
      sessionId,
      chunkId,
      eventType: 'privacy_filter_completed',
      payload: {
        privacyEnabled: filtered.privacyEnabled,
        provider: filtered.provider,
        labelsDetected: [...new Set((filtered.redactions || []).map((r) => r.label))],
        redactionCount: filtered.redactions?.length || 0,
        rawRetained: retainRaw,
      },
    });

    return { sessionId, chunkId, speakerId, sanitizedText: filtered.sanitizedText, redactions: filtered.redactions };
  }

  async processIncremental(sessionId) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return this.brain.incrementalPass(sessionId);
  }

  async endSession(sessionId, reason = 'completed') {
    this.store.endSession(sessionId, reason);
    return this.brain.finalPass(sessionId);
  }

  normalizeSpeaker(sessionId, sourceLabel) {
    const key = `${sessionId}:${sourceLabel}`;
    if (!this.speakerMap.has(key)) {
      const count = [...this.speakerMap.keys()].filter((k) => k.startsWith(`${sessionId}:`)).length + 1;
      this.speakerMap.set(key, `speaker_${count}`);
    }
    return this.speakerMap.get(key);
  }
}
