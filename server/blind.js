// Blind test: run a whole lineup, shuffle the takes and keep who made each one on the
// server until a vote is recorded. The browser is sent letters and audio, nothing else,
// so nothing on the page can give a take away. Pending runs live in memory (a restart
// forgets them; the audio is already in the browser). Votes are appended, one JSON
// object per line, to results/votes.jsonl, so they survive restarts.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providers } from './providers/index.js';
import { synthesize } from './synthesize.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = path.join(ROOT, 'results');
const VOTES_FILE = path.join(RESULTS_DIR, 'votes.jsonl');
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS = 200;

const runs = new Map(); // id → { id, createdAt, text, textHash, speed, takes, failed, votedAt }

const fail = (message, status) => Object.assign(new Error(message), { status });
const letterFor = (i) => String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);

/** sha256 of the script with whitespace collapsed, so the same script pasted with different line breaks groups with itself. */
export const textHash = (text) => createHash('sha256').update(String(text).trim().replace(/\s+/g, ' ')).digest('hex');

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function prune() {
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.createdAt > RUN_TTL_MS) runs.delete(id);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
}

/**
 * Synthesize every target, shuffle the ones that worked and letter them A, B, C…
 * Returns only what the listener may see: the run id, letters and audio.
 */
export async function blindRun({ text, lexicon = [], speed = 1, targets = [] }) {
  const list = Array.isArray(targets) ? targets : [];
  if (list.length < 2) throw fail('A blind test needs at least two voices turned on.', 400);
  for (const t of list) if (!providers[t?.provider]) throw fail(`Unknown provider “${t?.provider}”.`, 400);

  const settled = await Promise.all(list.map(async (t) => {
    const p = providers[t.provider];
    try {
      const r = await synthesize({ provider: t.provider, model: t.model, voice: t.voice, text, lexicon, speed: t.speed, options: t.options || {} });
      const { audio, ...take } = r;
      return {
        ok: true,
        audio,
        contentType: r.contentType,
        take: {
          ...take,
          providerName: p.name,
          modelLabel: p.models.find((m) => m.id === r.model)?.label || r.model,
          voiceName: String(t.voiceName || t.voice || ''),
          options: t.options || {},
          speed: Number(t.speed) || 1,
        },
      };
    } catch (e) {
      return { ok: false, provider: p.name, error: e.message };
    }
  }));

  const ok = shuffle(settled.filter((s) => s.ok));
  const failed = settled.filter((s) => !s.ok).map((s) => ({ provider: s.provider, error: s.error }));
  if (ok.length < 2) {
    throw fail(`Only ${ok.length} of ${list.length} takes came back, and a blind test needs two. ${failed.map((f) => f.error).join(' ')}`, 502);
  }

  const id = randomBytes(9).toString('base64url');
  prune();
  runs.set(id, {
    id, createdAt: Date.now(), text, textHash: textHash(text), speed: Number(speed) || 1,
    takes: ok.map((s, i) => ({ letter: letterFor(i), ...s.take })),
    failed,
    votedAt: null,
  });
  return { id, takes: ok.map((s, i) => ({ letter: letterFor(i), audio: s.audio, contentType: s.contentType })), failed: failed.length };
}

/** Record one vote for a pending run, then reveal who made each take. A run takes exactly one vote. */
export async function recordVote(body = {}) {
  const run = runs.get(String(body.run || ''));
  if (!run) throw fail('That blind run has expired, or the server restarted since it was generated. Generate it again to vote.', 404);
  if (run.votedAt) throw fail('This run has already been voted on.', 409);
  const letters = run.takes.map((t) => t.letter);

  const voter = String(body.voter || '').trim().slice(0, 80);
  if (!voter) throw fail('Add your name so the results page can tell voters apart.', 400);
  const pick = String(body.pick || '');
  if (!letters.includes(pick)) throw fail('Choose the best take first.', 400);
  const ranking = Array.isArray(body.ranking) && body.ranking.length ? body.ranking.map(String) : null;
  if (ranking && (ranking[0] !== pick || new Set(ranking).size !== ranking.length || !ranking.every((l) => letters.includes(l)))) {
    throw fail('The ranking must start with your pick and name each take at most once.', 400);
  }
  const numbersWrong = Array.isArray(body.numbersWrong) ? [...new Set(body.numbersWrong.map(String))].filter((l) => letters.includes(l)) : [];
  const note = String(body.note || '').trim().slice(0, 2000);

  const vote = {
    at: new Date().toISOString(),
    voter,
    run: run.id,
    text: run.text,
    textHash: run.textHash,
    speed: run.speed,
    takes: run.takes.map((t) => ({
      letter: t.letter,
      provider: t.provider, providerName: t.providerName,
      model: t.model, modelLabel: t.modelLabel,
      voice: t.voice, voiceName: t.voiceName,
      options: t.options, speed: t.speed,
      metrics: t.metrics, price: t.price,
      sentText: t.sentText, warnings: t.warnings,
      numbersWrong: numbersWrong.includes(t.letter),
    })),
    pick,
    ranking,
    numbersWrong,
    note,
    failed: run.failed,
  };
  try {
    await mkdir(RESULTS_DIR, { recursive: true });
    await appendFile(VOTES_FILE, `${JSON.stringify(vote)}\n`);
  } catch (e) {
    throw fail(`Couldn’t save the vote to ${path.relative(ROOT, VOTES_FILE)}: ${e.message}`, 500);
  }
  run.votedAt = vote.at;
  return { ok: true, vote, reveal: { takes: run.takes, failed: run.failed } };
}

/** Every vote on disk, oldest first. A line that isn't JSON is skipped and counted, never fatal. */
export async function readVotes() {
  let raw = '';
  try {
    raw = await readFile(VOTES_FILE, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const votes = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { votes.push(JSON.parse(line)); } catch { skipped++; }
  }
  return { votes, skipped, file: path.relative(ROOT, VOTES_FILE) };
}
