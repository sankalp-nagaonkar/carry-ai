const SEGMENT_TIMESTAMP_KEYS = [
  'timestamp',
  'timestamp_utc',
  'utc_timestamp',
  'created_at',
  'createdAt',
  'start_at',
  'startAt',
  'started_at',
  'startedAt',
  'start_time',
  'startTime',
  'start_time_utc',
  'startTimeUtc',
  'time',
];

const EVENT_TIMESTAMP_KEYS = [
  'timestamp',
  'timestamp_utc',
  'utc_timestamp',
  'created_at',
  'createdAt',
  'event_time',
  'eventTime',
  'received_at',
  'receivedAt',
];

export function parseUtcTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return normalizeEpochNumber(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return normalizeEpochNumber(Number(text));
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function extractSegmentUtcTimestampMs(segment = {}, event = {}) {
  for (const key of SEGMENT_TIMESTAMP_KEYS) {
    const parsed = parseUtcTimestampMs(segment?.[key]);
    if (parsed !== null) return { ms: parsed, source: `segment.${key}` };
  }
  for (const key of EVENT_TIMESTAMP_KEYS) {
    const parsed = parseUtcTimestampMs(event?.[key]);
    if (parsed !== null) return { ms: parsed, source: `event.${key}` };
  }
  return { ms: null, source: null };
}

export function shouldKeepSegmentAfterCutoff({ segment, event, cutoffMs }) {
  const { ms, source } = extractSegmentUtcTimestampMs(segment, event);
  if (ms === null) return { keep: false, reason: 'missing_timestamp', timestampMs: null, timestampSource: null };
  if (ms <= cutoffMs) return { keep: false, reason: 'before_visit_start', timestampMs: ms, timestampSource: source };
  return { keep: true, reason: 'after_visit_start', timestampMs: ms, timestampSource: source };
}

function normalizeEpochNumber(value) {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  // Nanoseconds are usually 19 digits, microseconds 16, milliseconds 13,
  // seconds 10. Convert all common epoch encodings to milliseconds.
  if (abs >= 1e18) return Math.round(value / 1e6);
  if (abs >= 1e15) return Math.round(value / 1e3);
  if (abs >= 1e12) return Math.round(value);
  if (abs >= 1e9) return Math.round(value * 1000);
  return Math.round(value);
}
