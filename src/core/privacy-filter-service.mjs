// MVP privacy filter service.
// Interface is designed for openai/privacy-filter. The current implementation uses a lightweight
// local fallback recognizer so the pipeline can run while the HF model integration is added.

export class PrivacyFilterService {
  constructor(config) {
    this.config = config;
    this.enabled = Boolean(config.app.privacy?.enabled);
  }

  filterChunk({ sessionId, chunkId, text }) {
    if (!this.enabled) {
      return { sanitizedText: text, redactions: [], privacyEnabled: false };
    }

    const redactions = detectBasicPrivateSpans(text);
    const counters = {};
    let sanitizedText = text;

    for (const r of redactions) {
      counters[r.label] = (counters[r.label] || 0) + 1;
      r.placeholder = `[${r.label.toUpperCase()}_${counters[r.label]}]`;
    }

    // Replace from end to start so indexes remain valid.
    for (const r of [...redactions].sort((a, b) => b.start - a.start)) {
      sanitizedText = sanitizedText.slice(0, r.start) + r.placeholder + sanitizedText.slice(r.end);
    }

    return {
      sessionId,
      chunkId,
      sanitizedText,
      redactions,
      privacyEnabled: true,
      provider: this.config.app.privacy?.provider || 'openai_privacy_filter',
      runtime: 'local_fallback_until_hf_model_wired',
    };
  }
}

function detectBasicPrivateSpans(text) {
  const spans = [];
  addRegex(spans, text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'private_email', 0.99);
  addRegex(spans, text, /(?:\+?\d[\d\s().-]{7,}\d)/g, 'private_phone', 0.85);
  addRegex(spans, text, /\b(?:https?:\/\/|www\.)\S+/gi, 'private_url', 0.95);
  addRegex(spans, text, /\b(?:DOB|date of birth)\s*(?:is|:)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi, 'private_date', 0.9, 1);
  addRegex(spans, text, /\b(?:[Mm]y name is|[Ii] am|[Ii]'m|[Tt]his is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g, 'private_person', 0.75, 1);
  return mergeOverlaps(spans);
}

function addRegex(spans, text, regex, label, confidence, captureGroup = 0) {
  for (const match of text.matchAll(regex)) {
    const value = captureGroup ? match[captureGroup] : match[0];
    if (!value) continue;
    const start = match.index + (captureGroup ? match[0].indexOf(value) : 0);
    spans.push({ label, value, start, end: start + value.length, confidence });
  }
}

function mergeOverlaps(spans) {
  return spans
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((span, idx, arr) => !arr.slice(0, idx).some((prev) => span.start < prev.end && span.end > prev.start));
}
