import { parseUtcTimestampMs, shouldKeepSegmentAfterCutoff } from '../src/transcripts/transcript-timestamp-filter.mjs';

const cutoff = Date.parse('2026-06-20T17:45:00.000Z');
const cases = [
  {
    name: 'skips history before start',
    segment: { text: 'old text', timestamp: '2026-06-20T17:44:59.999Z' },
    expectedKeep: false,
    expectedReason: 'before_visit_start',
  },
  {
    name: 'skips exact start boundary',
    segment: { text: 'boundary text', created_at: '2026-06-20T17:45:00.000Z' },
    expectedKeep: false,
    expectedReason: 'before_visit_start',
  },
  {
    name: 'keeps text after start',
    segment: { text: 'new text', start_time_utc: '2026-06-20T17:45:00.001Z' },
    expectedKeep: true,
    expectedReason: 'after_visit_start',
  },
  {
    name: 'keeps epoch seconds after start',
    segment: { text: 'new epoch seconds', timestamp: cutoff / 1000 + 1 },
    expectedKeep: true,
    expectedReason: 'after_visit_start',
  },
  {
    name: 'keeps epoch milliseconds after start',
    segment: { text: 'new epoch ms', timestamp: cutoff + 1 },
    expectedKeep: true,
    expectedReason: 'after_visit_start',
  },
  {
    name: 'uses event timestamp fallback',
    segment: { text: 'event timed text' },
    event: { created_at: '2026-06-20T17:45:01.000Z' },
    expectedKeep: true,
    expectedReason: 'after_visit_start',
  },
  {
    name: 'skips missing timestamp',
    segment: { text: 'unknown time' },
    expectedKeep: false,
    expectedReason: 'missing_timestamp',
  },
];

const results = cases.map((test) => {
  const decision = shouldKeepSegmentAfterCutoff({ segment: test.segment, event: test.event || {}, cutoffMs: cutoff });
  return { name: test.name, decision, pass: decision.keep === test.expectedKeep && decision.reason === test.expectedReason };
});

console.log(JSON.stringify({ cutoffUtc: new Date(cutoff).toISOString(), parsedCutoff: parseUtcTimestampMs('2026-06-20T17:45:00.000Z'), results }, null, 2));
const failed = results.filter((r) => !r.pass);
if (failed.length) throw new Error(`timestamp cutoff smoke failed: ${failed.map((f) => f.name).join(', ')}`);
