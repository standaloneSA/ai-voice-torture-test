// A fake provider for testing the UI without API keys. Enabled with MOCK_PROVIDER=1.
// It "speaks" by generating a tone pattern whose length follows the text. Each voice has
// its own pitch and timbre, and three copies of the provider are registered so a blind
// test has something to shuffle without a single key.

import { compileLexicon } from './util.js';

// Pitch in Hz, harmonic mix (timbre) and vibrato depth per voice, so they're told apart by ear.
const VOICES = {
  hum: { name: 'Hum', tags: 'low, smooth', base: 180, harmonics: [1], vibrato: 0 },
  buzz: { name: 'Buzz', tags: 'low, rough', base: 120, harmonics: [1, 0.5, 0.33, 0.25], vibrato: 0 },
  chirp: { name: 'Chirp', tags: 'high, wobbly', base: 320, harmonics: [1, 0.3], vibrato: 8 },
};

function toneWav(text, voice) {
  const v = VOICES[voice] || VOICES.hum;
  const gain = 0.4 / v.harmonics.reduce((a, b) => a + b, 0);
  const rate = 16000;
  const seconds = Math.min(20, Math.max(1, text.length / 15));
  const n = Math.floor(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = Math.abs(Math.sin(Math.PI * t * 4.2)) ** 0.6; // speech-like envelope
    const pause = Math.sin(Math.PI * t * 0.7) > -0.85 ? 1 : 0.05;
    const f = v.base + 40 * Math.sin(t * 3) + v.vibrato * Math.sin(2 * Math.PI * 5 * t);
    let s = 0;
    v.harmonics.forEach((amp, k) => { s += amp * Math.sin(2 * Math.PI * f * (k + 1) * t); });
    data.writeInt16LE(Math.round(s * gain * syllable * pause * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Every tone provider offers every voice; the list is rotated so each one defaults to a different voice.
const voiceList = (first) => {
  const ids = Object.keys(VOICES);
  const i = ids.indexOf(first);
  return [...ids.slice(i), ...ids.slice(0, i)].map((id) => ({ id, name: VOICES[id].name, tags: VOICES[id].tags }));
};

const tone = (id, name, color, firstVoice) => ({
  id,
  name,
  color,
  envKey: null,
  docs: [],
  models: [{ id: 'tone-1', label: 'Tone v1', price: { per1k: 0.01 } }],
  defaultModel: 'tone-1',
  fallbackVoices: voiceList(firstVoice),
  staticVoices: true,
  speed: null,
  options: [],
  lexiconHow: 'Swaps in the sounds-like spelling, so you can see the lexicon working without a key.',
  compile(text, lexicon) {
    return { ...compileLexicon(text, lexicon, (e) => (e.soundsLike ? { replacement: e.soundsLike, method: 'respelling' } : { skip: 'No sounds-like spelling.' })), warnings: [] };
  },
  async synthesize({ text, voice }) {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
    const ttfa = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 150 + text.length));
    const buffer = toneWav(text, voice);
    return { buffer, contentType: 'audio/wav', timing: { ttfaMs: Math.round(ttfa), totalMs: Math.round(performance.now() - t0), bytes: buffer.length }, sent: { text, voice } };
  },
  tips: [{ title: 'Testing only', body: 'This provider plays a tone instead of speech. Turn it off by removing MOCK_PROVIDER from .env.' }],
});

const mock = tone('mock', 'Test tone', '#C9C2D8', 'hum');
export default mock;

/** Three tone "providers", each defaulting to a different voice: enough takes for a blind test with no keys at all. */
export const mocks = [mock, tone('mock-b', 'Test tone B', '#B9CCD6', 'buzz'), tone('mock-c', 'Test tone C', '#D6CBB9', 'chirp')];
