// Sums blind-test votes. Shared by the results page and anything that scripts over results/votes.jsonl
// (node -e "import('./public/tally.js')…" works, since this file touches no DOM).

const optionsText = (o) => Object.entries(o || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(', ');

/** A take's identity at a grouping level. The voice level includes the options (instructions, emotion, style) it was run with. */
export function identityKey(t, level = 'voice') {
  const parts = [t.provider];
  if (level !== 'provider') parts.push(t.model);
  if (level === 'voice') parts.push(t.voice, optionsText(t.options));
  return parts.join('\u001f');
}

export function identityLabel(t, level = 'voice') {
  const parts = [t.providerName || t.provider];
  if (level !== 'provider') parts.push(t.modelLabel || t.model);
  if (level === 'voice') parts.push(t.voiceName || t.voice);
  return parts.join(' · ');
}

/** Where a take came in a vote: 1 for the pick, its place in the ranking if the voter ranked it, else null. */
export const rankOf = (vote, letter) => (vote.ranking ? vote.ranking.indexOf(letter) + 1 || null : letter === vote.pick ? 1 : null);

/** One row per identity: appearances, wins, win rate, how often its numbers were heard wrong, mean rank where ranked. */
export function tally(votes, level = 'voice') {
  const rows = new Map();
  for (const v of votes) {
    for (const t of v.takes || []) {
      const key = identityKey(t, level);
      let r = rows.get(key);
      if (!r) {
        r = { key, label: identityLabel(t, level), provider: t.provider, options: level === 'voice' ? optionsText(t.options) : '', appearances: 0, wins: 0, numbersWrong: 0, rankSum: 0, ranked: 0 };
        rows.set(key, r);
      }
      r.appearances++;
      if (t.letter === v.pick) r.wins++;
      if (t.numbersWrong) r.numbersWrong++;
      const rank = rankOf(v, t.letter);
      if (rank) { r.rankSum += rank; r.ranked++; }
    }
  }
  return [...rows.values()]
    .map(({ rankSum, ...r }) => ({ ...r, winRate: r.wins / r.appearances, meanRank: r.ranked ? rankSum / r.ranked : null }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.appearances - a.appearances || a.label.localeCompare(b.label));
}

/** Runs where both identities were heard: who was picked, and who was ranked above whom when both were ranked. */
export function headToHead(votes, a, b, level = 'voice') {
  const out = { runs: 0, aWins: 0, bWins: 0, neither: 0, bothRanked: 0, aAbove: 0, bAbove: 0 };
  if (!a || !b || a === b) return out;
  for (const v of votes) {
    const ta = (v.takes || []).find((t) => identityKey(t, level) === a);
    const tb = (v.takes || []).find((t) => identityKey(t, level) === b);
    if (!ta || !tb) continue;
    out.runs++;
    if (v.pick === ta.letter) out.aWins++;
    else if (v.pick === tb.letter) out.bWins++;
    else out.neither++;
    const ra = rankOf(v, ta.letter);
    const rb = rankOf(v, tb.letter);
    if (ra && rb) { out.bothRanked++; if (ra < rb) out.aAbove++; else out.bAbove++; }
  }
  return out;
}

/** Every identity heard in these votes, for pickers. */
export function identities(votes, level = 'voice') {
  const seen = new Map();
  for (const v of votes) for (const t of v.takes || []) { const k = identityKey(t, level); if (!seen.has(k)) seen.set(k, identityLabel(t, level)); }
  return [...seen].map(([key, label]) => ({ key, label })).sort((x, y) => x.label.localeCompare(y.label));
}
