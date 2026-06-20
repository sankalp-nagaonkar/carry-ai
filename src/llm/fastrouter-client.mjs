import OpenAI from 'openai';
import { resolveLlmConfig } from '../config/config-loader.mjs';

export class FastrouterClient {
  constructor(config) {
    this.config = resolveLlmConfig(config);
    this.client = new OpenAI({
      baseURL: this.config.baseUrl,
      apiKey: process.env.FASTROUTER_API_KEY,
    });
  }

  async completeJson({ system, user, model, temperature, maxTokens }) {
    const completion = await this.client.chat.completions.create({
      model: model || this.config.model,
      temperature: temperature ?? this.config.temperature,
      max_tokens: maxTokens || this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nReturn only a single valid JSON object. No prose, no markdown fences.` },
        { role: 'user', content: user },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || '';
    return parseJsonContent(content);
  }
}

export function parseJsonContent(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      const repaired = repairJson(slice);
      if (repaired) return repaired;
    }
  }

  // Last resort: try to close a truncated object.
  if (first !== -1) {
    const repaired = repairJson(trimmed.slice(first));
    if (repaired) return repaired;
  }

  throw new Error(`LLM did not return parseable JSON: ${content.slice(0, 500)}`);
}

// Best-effort repair for truncated or lightly malformed JSON.
// Forward scan that remembers the last position where the document was in a
// structurally clean state (just after a complete value or a separator), then
// closes any still-open brackets. This recovers deeply nested truncations.
function repairJson(text) {
  const cleaned = text.replace(/,\s*([}\]])/g, '$1');
  // First, the cheap path.
  try { return JSON.parse(cleaned); } catch {}
  try { return JSON.parse(closeOpen(cleaned)); } catch {}

  const stack = [];       // '{' or '['
  let inString = false;
  let escaped = false;
  let expectValue = false; // true right after ':' , '[' , '{' , ',' (in array)
  let safeLen = 0;         // length of input known to be cleanly truncatable
  let safeStack = '';      // snapshot of stack at safeLen

  const snapshot = (i) => { safeLen = i + 1; safeStack = stack.join(''); };

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        // A string that closed a value (not a key) is a safe boundary.
        if (!expectValue && stack[stack.length - 1] === '[') snapshot(i);
        else if (!expectValueKey()) snapshot(i);
      }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); expectValue = ch === '['; continue; }
    if (ch === '}' || ch === ']') { stack.pop(); expectValue = false; snapshot(i); continue; }
    if (ch === ':') { expectValue = true; continue; }
    if (ch === ',') { expectValue = stack[stack.length - 1] === '['; snapshot(i - 1); continue; }
    if (/[0-9tfn]/.test(ch) && expectValue) {
      // scan to end of literal
      let j = i;
      while (j < cleaned.length && /[0-9a-zA-Z.+\-]/.test(cleaned[j])) j++;
      if (j < cleaned.length) { snapshot(j - 1); }
      i = j - 1; expectValue = false; continue;
    }
  }

  function expectValueKey() { return false; }

  if (safeLen > 0) {
    let prefix = cleaned.slice(0, safeLen).replace(/,\s*$/, '');
    const closer = closeStack(safeStack);
    try { return JSON.parse(prefix + closer); } catch {}
  }
  return null;
}

function closeStack(stackStr) {
  let out = '';
  for (let i = stackStr.length - 1; i >= 0; i--) out += stackStr[i] === '{' ? '}' : ']';
  return out;
}

function closeOpen(text) {
  let s = text;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack.length) s += stack.pop() === '{' ? '}' : ']';
  return s;
}
