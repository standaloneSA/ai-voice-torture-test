import './env.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providers, providerList, isConfigured, keyNames } from './providers/index.js';
import { synthesize } from './synthesize.js';
import { generateText, suggestPronunciation } from './claude.js';
import { guardInfo, checkLive, checkPasscode } from './guard.js';
import { blindRun, recordVote, readVotes } from './blind.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 5178);
const MAX_CHARS = Number(process.env.MAX_TEXT_CHARS || 1500);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function readJson(req) {
  // Some hosts (Vercel) parse the body before it reaches the handler.
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Request body must be JSON.'), { status: 400 }); }
}

// Voice lists change rarely; cache them for 10 minutes.
const voiceCache = new Map();
async function voicesFor(p) {
  const key = p.envKey ? process.env[p.envKey] : null;
  if (p.staticVoices || !p.listVoices || !isConfigured(p)) return { voices: p.fallbackVoices, source: 'built-in' };
  const hit = voiceCache.get(p.id);
  if (hit && Date.now() - hit.at < 600_000) return hit.data;
  try {
    const voices = await p.listVoices(key);
    const data = { voices: voices.length ? voices : p.fallbackVoices, source: voices.length ? 'account' : 'built-in' };
    voiceCache.set(p.id, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { voices: p.fallbackVoices, source: 'built-in', error: e.message };
  }
}

const publicProvider = (p) => ({
  id: p.id, name: p.name, color: p.color, docs: p.docs, models: p.models, defaultModel: p.defaultModel,
  speed: p.speed, options: p.options, tips: p.tips, lexiconHow: p.lexiconHow,
  configured: isConfigured(p), envKey: keyNames(p).join(' + '),
});

const routes = {
  'GET /api/config': async () => ({
    providers: providerList.map(publicProvider),
    claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    maxChars: MAX_CHARS,
    ...guardInfo(),
  }),

  'GET /api/voices': async (req, url) => {
    const p = providers[url.searchParams.get('provider')];
    if (!p) throw Object.assign(new Error('Unknown provider.'), { status: 404 });
    return voicesFor(p);
  },

  // Preview what would be sent to each provider, without spending anything.
  'POST /api/compile': async (req) => {
    const { text = '', lexicon = [], targets = [] } = await readJson(req);
    return {
      results: targets.map((t) => {
        const p = providers[t.provider];
        if (!p) return { provider: t.provider, error: 'Unknown provider' };
        return { provider: p.id, model: t.model, ...p.compile(text, lexicon, { model: t.model, speed: Number(t.speed) || 1 }) };
      }),
    };
  },

  'POST /api/passcode': async (req) => {
    const bad = checkPasscode(req);
    if (bad) throw Object.assign(new Error(bad), { status: 403 });
    return { ok: true };
  },

  'POST /api/synthesize': async (req) => {
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (!text) throw Object.assign(new Error('Add some text first.'), { status: 400 });
    if (text.length > MAX_CHARS) throw Object.assign(new Error(`Text is ${text.length} characters; the limit is ${MAX_CHARS}.`), { status: 400 });
    const blocked = checkLive(req, text.length);
    if (blocked) throw Object.assign(new Error(blocked), { status: 403 });
    return synthesize(body);
  },

  // Blind test: the whole lineup in one request, so the browser never learns which take is whose.
  // Counts against the daily limits exactly like one Generate per take.
  'POST /api/blind-run': async (req) => {
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (!text) throw Object.assign(new Error('Add some text first.'), { status: 400 });
    if (text.length > MAX_CHARS) throw Object.assign(new Error(`Text is ${text.length} characters; the limit is ${MAX_CHARS}.`), { status: 400 });
    const n = Array.isArray(body.targets) ? body.targets.length : 0;
    if (n < 2) throw Object.assign(new Error('A blind test needs at least two voices turned on.'), { status: 400 });
    for (let i = 0; i < n; i++) {
      const blocked = checkLive(req, text.length);
      if (blocked) throw Object.assign(new Error(blocked), { status: 403 });
    }
    return blindRun({ ...body, text });
  },

  'POST /api/votes': async (req) => recordVote(await readJson(req)),

  'GET /api/results': async () => readVotes(),

  'POST /api/generate-text': async (req) => {
    const body = await readJson(req);
    const blocked = checkLive(req, 0);
    if (blocked) throw Object.assign(new Error(blocked), { status: 403 });
    return generateText(body);
  },

  'POST /api/suggest-pronunciation': async (req) => {
    const body = await readJson(req);
    const blocked = checkLive(req, 0);
    if (blocked) throw Object.assign(new Error(blocked), { status: 403 });
    return suggestPronunciation(body);
  },
};

async function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname === '/results' ? '/results.html' : pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

export const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    return send(res, 404, { error: 'Not found' });
  }
  try {
    send(res, 200, await route(req, url));
  } catch (e) {
    send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message || 'Something went wrong.' });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  http.createServer(handler).listen(PORT, () => {
    const configured = providerList.filter(isConfigured).map((p) => p.name);
    console.log(`\n  AI Voice Torture Test is running at http://localhost:${PORT}\n`);
    console.log(`  Providers with keys: ${configured.join(', ') || 'none yet (copy .env.example to .env)'}`);
    console.log(`  Claude text generation: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off (no ANTHROPIC_API_KEY)'}\n`);
  });
}
