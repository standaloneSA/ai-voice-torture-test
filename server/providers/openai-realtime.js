import { compileLexicon, cleanIpa, pcmToWav, ProviderError } from './util.js';

// OpenAI's Realtime API (WebSocket) used as a text-to-speech engine. gpt-realtime-2.1-mini is the
// named replacement for tts-1 / tts-1-hd / gpt-4o-mini-tts (shut down 2027-01-06) and the only
// place the "alloy" voice continues. It is a conversational model told to read the script, not a
// TTS endpoint: one session per take, closed afterwards.
const WS_URL = 'wss://api.openai.com/v1/realtime';
const RATE = 24000; // PCM16 mono, the format every Realtime model emits natively
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const READ_ALOUD = 'Read the following text aloud exactly as written. Do not add, remove, rephrase or summarise anything. Do not greet, comment or ask questions.';
const IDLE_TIMEOUT_MS = 60_000; // no server event for this long = dead socket, fail the take
const HARD_TIMEOUT_MS = 300_000; // never let a take hang longer than this, whatever the server sends

// $ per 1M tokens, developers.openai.com/api/docs/pricing (2026-10-28). The per-minute figures in
// `models` are only the pre-run estimate (measured 2026-10-28: output audio is 20 tokens per second,
// so $20/1M = $0.024 per minute and $64/1M = $0.077); each take's cost is computed from the usage
// block the API reports in response.done, so a price change here affects both.
const PRICES = {
  'gpt-realtime-2.1-mini': { audioOut: 20, textOut: 2.4, textIn: 0.6, cachedIn: 0.06 },
  'gpt-realtime-2.1': { audioOut: 64, textOut: 24, textIn: 4, cachedIn: 0.4 },
};

export default {
  id: 'openai-realtime',
  name: 'OpenAI Realtime',
  color: '#C9A0F5',
  envKey: 'OPENAI_API_KEY',
  docs: [
    { label: 'Realtime conversations guide', url: 'https://developers.openai.com/api/docs/guides/realtime-conversations' },
    { label: 'gpt-realtime-2.1-mini', url: 'https://developers.openai.com/docs/models/gpt-realtime-2.1-mini' },
    { label: 'Pricing', url: 'https://developers.openai.com/api/docs/pricing' },
  ],
  models: [
    { id: 'gpt-realtime-2.1-mini', label: 'gpt-realtime-2.1-mini', price: { perMin: 0.024 }, notes: 'Named replacement for tts-1 / tts-1-hd / gpt-4o-mini-tts (shut down 2027-01-06). A chat model reading text, not a TTS endpoint. $20 per 1M audio-output tokens (≈ $0.024 per audio minute at the measured 20 tokens/s); each take shows its real cost from the usage the API reports.' },
    { id: 'gpt-realtime-2.1', label: 'gpt-realtime-2.1', price: { perMin: 0.077 }, notes: 'The full-size Realtime model. A chat model reading text, not a TTS endpoint. $64 per 1M audio-output tokens (≈ $0.077 per audio minute at the measured 20 tokens/s); each take shows its real cost from the usage the API reports.' },
  ],
  defaultModel: 'gpt-realtime-2.1-mini',
  fallbackVoices: VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1), tags: v === 'marin' || v === 'cedar' ? 'best quality' : '' })),
  staticVoices: true,
  speed: { min: 0.25, max: 1.5, step: 0.05 },
  options: [
    { key: 'instructions', label: 'Instructions', type: 'text', default: '', placeholder: 'e.g. Speak as though you are a meteorologist on television.' },
  ],

  lexiconHow: 'No phoneme support. The sounds-like spelling is swapped into the text; IPA-only entries become a line in the instructions.',

  compile(text, lexicon) {
    const hints = [];
    const result = compileLexicon(text, lexicon, (e, matched) => {
      if (e.soundsLike?.trim()) return { replacement: e.soundsLike.trim(), method: 'respelling' };
      const ipa = cleanIpa(e.ipa);
      if (ipa) {
        hints.push(`Pronounce "${matched}" as /${ipa}/.`);
        return { replacement: matched, method: 'instructions hint' };
      }
      return { skip: 'No IPA or sounds-like spelling.' };
    });
    return { ...result, extraInstructions: [...new Set(hints)].join(' '), warnings: [] };
  },

  async synthesize({ key, text, model, voice, speed, options = {}, compiled }) {
    if (typeof WebSocket === 'undefined') {
      throw Object.assign(new Error(`The OpenAI Realtime provider needs Node 22 or newer (this is ${process.version}, which has no built-in WebSocket).`), { status: 501 });
    }
    const steer = [options.instructions, compiled?.extraInstructions].filter((s) => s && s.trim()).join(' ').trim();
    const session = {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: steer ? `${steer}\n\n${READ_ALOUD}` : READ_ALOUD,
      audio: { output: { voice: VOICES.includes(voice) ? voice : 'alloy', format: { type: 'audio/pcm', rate: RATE } } },
    };
    if (speed && speed !== 1) session.audio.output.speed = speed;
    const item = { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };

    const run = await readAloud({ key, model, session, item });
    const warnings = [];
    if (!VOICES.includes(voice)) warnings.push(`The Realtime API doesn’t have the “${voice}” voice, so Alloy was used.`);
    if (run.status !== 'completed') warnings.push(`The response ended with status “${run.status}”${run.statusDetail ? `: ${run.statusDetail}` : '.'}`);
    if (!run.transcript) warnings.push('The API sent no transcript for this take.');

    const cost = costFromUsage(model, run.usage);
    const providerReport = {
      status: run.status,
      ...(run.usage ? { usage: describeUsage(run.usage) } : {}),
      ...(cost ? { cost: cost.note } : {}),
      connect: `${run.openMs} ms to socket open, ${run.sessionMs ?? '?'} ms to session.updated`,
      ...(run.responseId ? { 'response id': run.responseId } : {}),
    };
    return {
      buffer: pcmToWav(run.pcm, { rate: RATE }),
      contentType: 'audio/wav',
      timing: { ttfaMs: run.ttfaMs, totalMs: run.totalMs, bytes: run.pcm.length + 44 },
      sent: { model, text, session },
      warnings,
      providerReport,
      transcript: run.transcript,
      cost,
    };
  },

  tips: [
    { title: 'Not a TTS endpoint', body: 'This is a conversational model told to read your text. The take’s transcript (what the model actually said) is shown under each take: compare it with the script, because a chat model can paraphrase, skip or add words.' },
    { title: 'Steer with instructions', body: 'The Instructions box is sent as the session’s system prompt, ahead of a fixed “read this exactly as written” line. Use it for tone, pace, accent and pronunciation hints.', example: 'Speak as though you are a meteorologist on television. Say "Saucony" as "SOCK-uh-nee".' },
    { title: 'No SSML or phonemes', body: 'Tags like <break> or <phoneme> are read as text or ignored. Respell tricky words in the script instead.', example: 'Siobhan → shi-VAWN' },
    { title: 'Pick marin or cedar', body: 'OpenAI recommends these two voices for best quality. Alloy, ash, ballad, coral, echo, sage, shimmer and verse are the rest; fable, nova and onyx don’t exist on the Realtime API.' },
    { title: 'Cost is per audio token', body: 'Audio output is billed per token, not per character: 20 tokens per second of speech, so about $0.024 (mini) or $0.077 (2.1) per audio minute. That is what the Est. cost before a run assumes; the cost on a finished take is computed from the usage block the API returns, and the Provider report shows the arithmetic.' },
    { title: 'One session per take', body: 'A Realtime session can’t change voice once it has spoken, so the app opens a fresh WebSocket for every take and closes it afterwards. First audio includes the connection and session setup.' },
    { title: 'Needs Node 22+', body: 'The Realtime API is WebSocket-only. This provider uses Node’s built-in WebSocket (Node 22 or newer) so the app stays dependency-free.' },
    { title: 'Disclosure', body: 'OpenAI’s usage policy requires telling listeners the voice is AI-generated.' },
  ],
};

/**
 * One Realtime session: connect, configure, send the script as a user message, ask for a response,
 * collect audio + transcript until response.done, close. Resolves with PCM and timings; rejects with
 * a ProviderError on an `error` event, a close before response.done, or a stalled socket.
 */
function readAloud({ key, model, session, item }) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const url = `${WS_URL}?model=${encodeURIComponent(model)}`;
    let ws;
    try {
      // undici's WebSocket (Node 22+) takes a non-standard options object with headers.
      ws = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      // A WebSocket that only accepts subprotocols: OpenAI reads the key from this one.
      ws = new WebSocket(url, ['realtime', `openai-insecure-api-key.${key}`]);
    }

    const chunks = [];
    const transcriptParts = [];
    let transcriptDone = null;
    let ttfaMs = null;
    let openMs = null;
    let sessionMs = null;
    let settled = false;
    let idleTimer = null;
    let hardTimer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'done'); } catch { /* already closing */ }
      fn(value);
    };
    const fail = (status, detail) => finish(reject, new ProviderError('OpenAI Realtime', status, detail));
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail(504, `No event from the Realtime API for ${IDLE_TIMEOUT_MS / 1000} s (socket stalled).`), IDLE_TIMEOUT_MS);
    };
    hardTimer = setTimeout(() => fail(504, `The take did not finish within ${HARD_TIMEOUT_MS / 1000} s.`), HARD_TIMEOUT_MS);
    touch();

    ws.addEventListener('open', () => {
      openMs = Math.round(performance.now() - t0);
      ws.send(JSON.stringify({ type: 'session.update', session }));
      ws.send(JSON.stringify({ type: 'conversation.item.create', item }));
      ws.send(JSON.stringify({ type: 'response.create' }));
    });

    ws.addEventListener('message', (ev) => {
      touch();
      let e;
      try { e = JSON.parse(ev.data); } catch { return; } // the API only sends text frames
      switch (e.type) {
        case 'session.updated':
          sessionMs ??= Math.round(performance.now() - t0);
          break;
        case 'response.output_audio.delta':
          if (ttfaMs === null) ttfaMs = Math.round(performance.now() - t0);
          if (e.delta) chunks.push(Buffer.from(e.delta, 'base64'));
          break;
        case 'response.output_audio_transcript.delta':
          if (e.delta) transcriptParts.push(e.delta);
          break;
        case 'response.output_audio_transcript.done':
          transcriptDone = e.transcript ?? transcriptDone;
          break;
        case 'response.done': {
          const r = e.response || {};
          const totalMs = Math.round(performance.now() - t0);
          const statusDetail = r.status_details?.error?.message || r.status_details?.reason || r.status_details?.type || '';
          if (r.status === 'failed' || r.status === 'cancelled') return fail(502, `The response ${r.status}${statusDetail ? `: ${statusDetail}` : '.'}`);
          const pcm = Buffer.concat(chunks);
          const transcript = (transcriptDone ?? transcriptParts.join('')).trim() || transcriptFromOutput(r.output);
          if (!pcm.length) return fail(502, `The model produced no audio${transcript ? ` (it said: ${transcript.slice(0, 200)})` : ''}.`);
          return finish(resolve, {
            pcm, transcript, usage: r.usage || null, status: r.status || 'completed', statusDetail, responseId: r.id || null,
            ttfaMs: ttfaMs ?? totalMs, totalMs, openMs, sessionMs,
          });
        }
        case 'error':
          return fail(errorStatus(e.error), JSON.stringify(e.error || e));
        default:
          break; // session.created, conversation.item.*, response.created, response.output_item.*, rate_limits.updated, …
      }
    });

    ws.addEventListener('error', (ev) => {
      // undici reports a refused upgrade (401, 404, network) here with a generic message.
      fail(502, ev.message || ev.error?.message || 'WebSocket connection failed.');
    });

    ws.addEventListener('close', (ev) => {
      if (!settled) fail(502, `The socket closed before response.done (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
    });
  });
}

// Map a Realtime `error` event onto the HTTP status the REST providers would have returned.
function errorStatus(err) {
  const code = err?.code || '';
  if (/api_key|auth/i.test(code)) return 401;
  if (/rate_limit|insufficient_quota/i.test(code)) return 429;
  if (/not_found|model/i.test(code)) return 404;
  return err?.type === 'invalid_request_error' ? 400 : 502;
}

// The response.done payload also carries the transcript on its output content parts.
function transcriptFromOutput(output) {
  for (const o of output || []) for (const c of o.content || []) if (c.transcript) return c.transcript;
  return '';
}

/** Real cost of a take from the usage block in response.done (audio-output tokens × list price, plus the text tokens). */
function costFromUsage(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const inD = usage.input_token_details || {};
  const outD = usage.output_token_details || {};
  const cached = inD.cached_tokens || 0;
  const textIn = Math.max(0, (inD.text_tokens ?? usage.input_tokens ?? 0) - cached);
  const audioOut = outD.audio_tokens ?? 0;
  const textOut = outD.text_tokens ?? 0;
  const usd = (audioOut * p.audioOut + textOut * p.textOut + textIn * p.textIn + cached * p.cachedIn) / 1e6;
  const parts = [`${audioOut.toLocaleString()} audio-out × $${p.audioOut}/1M`];
  if (textOut) parts.push(`${textOut.toLocaleString()} text-out × $${p.textOut}/1M`);
  if (textIn) parts.push(`${textIn.toLocaleString()} text-in × $${p.textIn}/1M`);
  if (cached) parts.push(`${cached.toLocaleString()} cached-in × $${p.cachedIn}/1M`);
  return {
    usd,
    basis: 'usage',
    audioOutTokens: audioOut,
    note: `$${usd.toFixed(5)} from response.done usage: ${parts.join(' + ')}`,
  };
}

function describeUsage(u) {
  const inD = u.input_token_details || {};
  const outD = u.output_token_details || {};
  return `${(outD.audio_tokens ?? 0).toLocaleString()} audio-out tokens, ${(outD.text_tokens ?? 0).toLocaleString()} text-out, ${(inD.text_tokens ?? u.input_tokens ?? 0).toLocaleString()} text-in (${(inD.cached_tokens ?? 0).toLocaleString()} cached)`;
}
