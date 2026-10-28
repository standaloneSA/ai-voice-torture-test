// Shared helpers for provider adapters.

export class ProviderError extends Error {
  constructor(provider, status, body) {
    let detail = body;
    try {
      const j = JSON.parse(body);
      detail = j?.detail?.message || j?.detail || j?.error?.message || j?.message || j?.err_msg || body;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch { /* not JSON */ }
    super(`${provider} returned ${status}: ${String(detail).slice(0, 400)}`);
    this.status = status;
  }
}

/**
 * fetch() that reads the streamed response body and records when the first
 * audio byte arrived. Timings are measured from this server to the provider.
 */
export async function timedFetch(provider, url, options) {
  const t0 = performance.now();
  const res = await fetch(url, options);
  if (!res.ok) throw new ProviderError(provider, res.status, await res.text());

  const reader = res.body.getReader();
  const chunks = [];
  let firstByteAt = null;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteAt === null && value?.length) firstByteAt = performance.now();
    chunks.push(value);
    bytes += value.length;
  }
  const end = performance.now();
  return {
    buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    headers: res.headers,
    timing: {
      ttfaMs: Math.round((firstByteAt ?? end) - t0),
      totalMs: Math.round(end - t0),
      bytes,
    },
  };
}

/**
 * Wrap raw PCM (16-bit signed little-endian, as streamed by the OpenAI Realtime API) in a 44-byte
 * WAV header so the browser's decodeAudioData / <audio> can play it.
 */
export function pcmToWav(pcm, { rate = 24000, channels = 1, bits = 16 } = {}) {
  const blockAlign = (channels * bits) / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace whole-word occurrences of `word` in `text`.
 * Uses Unicode-aware boundaries so "Hermès" and "U" match correctly.
 * Returns { text, count }.
 */
export function replaceWord(text, word, replacer, caseSensitive = false) {
  if (!word?.trim()) return { text, count: 0 };
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word.trim())}(?![\\p{L}\\p{N}])`, caseSensitive ? 'gu' : 'giu');
  let count = 0;
  const out = text.replace(re, (m) => {
    count++;
    return typeof replacer === 'function' ? replacer(m) : replacer;
  });
  return { text: out, count };
}

/** Strip slashes/brackets users often paste around IPA: /ˈsɑkəni/ → ˈsɑkəni */
export const cleanIpa = (ipa) => (ipa || '').trim().replace(/^[\/\[]+|[\/\]]+$/g, '').trim();

/**
 * Generic lexicon compiler. `strategy(entry, matchedText)` returns
 * { replacement, method } or null to skip. Collects an "applied" report.
 */
export function compileLexicon(text, lexicon, strategy) {
  const applied = [];
  const slots = []; // replacements are parked in placeholders so later entries can't match inside them
  let out = text;
  // Longest words first so "Saucony Ride" wins over "Saucony".
  const entries = [...(lexicon || [])].filter((e) => e?.word?.trim()).sort((a, b) => b.word.length - a.word.length);
  for (const entry of entries) {
    let method = null;
    let skippedReason = null;
    const r = replaceWord(out, entry.word, (m) => {
      const s = strategy(entry, m);
      if (!s) return m;
      if (s.skip) { skippedReason = s.skip; return m; }
      method = s.method;
      slots.push(s.replacement);
      return `${slots.length - 1}`;
    }, entry.caseSensitive);
    if (r.count > 0) {
      out = r.text;
      applied.push({ word: entry.word, count: r.count, method: method || 'not applied', note: skippedReason });
    }
  }
  out = out.replace(/(\d+)/g, (_, i) => slots[Number(i)]);
  return { text: out, applied };
}
