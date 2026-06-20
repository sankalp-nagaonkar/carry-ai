import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const DEFAULT_BACKEND_URL = 'https://aa22-42-104-224-81.ngrok-free.app';
const DEFAULT_LAST_ID_FILE = '.last_live_transcript_global_event_id';

export function normalizeWsUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (clean.startsWith('https://')) return `wss://${clean.slice('https://'.length)}`;
  if (clean.startsWith('http://')) return `ws://${clean.slice('http://'.length)}`;
  return clean;
}

export function getLastEventId(filePath = DEFAULT_LAST_ID_FILE) {
  try {
    if (fs.existsSync(filePath)) {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    }
  } catch {}
  return '0-0';
}

export function saveLastEventId(eventId, filePath = DEFAULT_LAST_ID_FILE) {
  if (!eventId) return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, String(eventId), 'utf8');
}

export class LiveTranscriptWsConsumer {
  constructor({ backendUrl = process.env.CARRY_BACKEND_WS_URL || DEFAULT_BACKEND_URL, lastIdFile = process.env.CARRY_LAST_TRANSCRIPT_ID_FILE || DEFAULT_LAST_ID_FILE, reconnectMs = 3000, logger = console } = {}) {
    this.backendUrl = backendUrl;
    this.lastIdFile = lastIdFile;
    this.reconnectMs = reconnectMs;
    this.logger = logger;
  }

  url() {
    const lastEventId = encodeURIComponent(getLastEventId(this.lastIdFile));
    return `${normalizeWsUrl(this.backendUrl)}/v4/live/transcripts?last_event_id=${lastEventId}`;
  }

  async consume({ signal, onEvent }) {
    while (!signal?.aborted) {
      const url = this.url();
      this.logger?.log?.(`Connecting Carry transcript WebSocket: ${url}`);
      try {
        await this.connectOnce({ url, signal, onEvent });
      } catch (error) {
        if (signal?.aborted) return;
        this.logger?.warn?.(`Carry transcript WebSocket error: ${error.message || error}`);
      }
      if (!signal?.aborted) await sleep(this.reconnectMs, signal).catch(() => {});
    }
  }

  connectOnce({ url, signal, onEvent }) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        handshakeTimeout: 20000,
      });

      let settled = false;
      let chain = Promise.resolve();
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch {}
        fn(value);
      };
      const abort = () => done(resolve);
      signal?.addEventListener('abort', abort, { once: true });

      ws.on('message', (data) => {
        chain = chain.then(async () => {
          const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
          const event = JSON.parse(raw);
          if (event.id) saveLastEventId(event.id, this.lastIdFile);
          await onEvent(event);
        }).catch((error) => {
          this.logger?.warn?.(`Carry transcript event handling error: ${error.message || error}`);
        });
      });

      ws.on('close', () => {
        signal?.removeEventListener('abort', abort);
        chain.finally(() => done(resolve));
      });
      ws.on('error', (error) => {
        signal?.removeEventListener('abort', abort);
        done(reject, error);
      });
    });
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
