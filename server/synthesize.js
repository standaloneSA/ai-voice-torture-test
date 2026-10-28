import { providers, isConfigured, keyNames } from './providers/index.js';

/** Run one take: apply the lexicon, call the provider, return audio + metrics. */
export async function synthesize({ provider, model, voice, text, lexicon = [], speed = 1, options = {} }) {
  const p = providers[provider];
  if (!p) throw Object.assign(new Error(`Unknown provider “${provider}”.`), { status: 400 });
  if (!isConfigured(p)) throw Object.assign(new Error(`Add ${keyNames(p).join(' and ')} to .env to use ${p.name}.`), { status: 400 });
  const key = p.envKey ? process.env[p.envKey] : 'none';

  const m = model || p.defaultModel;
  const compiled = p.compile(text, lexicon, { model: m, speed: Number(speed) || 1 });
  const r = await p.synthesize({ key, text: compiled.text, model: m, voice, speed: Number(speed) || 1, options, compiled });

  const modelInfo = p.models.find((x) => x.id === m);
  return {
    provider: p.id,
    model: m,
    voice,
    audio: r.buffer.toString('base64'),
    contentType: r.contentType,
    metrics: {
      ...r.timing,
      inputChars: text.length,
      sentChars: compiled.text.length,
    },
    price: modelInfo?.price || null,
    sentText: compiled.text,
    sent: redact(r.sent),
    applied: compiled.applied,
    warnings: [...(compiled.warnings || []), ...(r.warnings || [])],
    providerReport: r.providerReport || null,
    // Set by providers that hear the words back (OpenAI Realtime): what the model actually said, and
    // the take's real cost from the usage the API reported (the UI falls back to the list-price estimate).
    transcript: r.transcript || null,
    cost: r.cost || null,
  };
}

// Never echo anything key-like back to the browser.
const redact = (obj) => JSON.parse(JSON.stringify(obj || {}, (k, v) => (/key|token|authorization/i.test(k) ? '•••' : v)));
