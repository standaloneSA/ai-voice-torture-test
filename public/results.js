import { tally, headToHead, identities, identityLabel } from './tally.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let votes = [];
let colors = {};

async function init() {
  try {
    const [r, cfg] = await Promise.all([fetch('/api/results').then(okJson), fetch('/api/config').then(okJson)]);
    votes = r.votes;
    colors = Object.fromEntries(cfg.providers.map((p) => [p.id, p.color]));
    $('#file').textContent = r.file;
    if (r.skipped) notice(`${plural(r.skipped, 'line')} in ${esc(r.file)} could not be read as JSON and were skipped.`);
  } catch (e) {
    notice(`Can’t load the results: ${esc(e.message)}`);
    return;
  }
  if (!votes.length) {
    notice('No votes yet. On the main page turn on <strong>Blind test</strong>, generate, listen, and submit a vote.', 'info');
  }

  const voters = [...new Set(votes.map((v) => v.voter))].sort((a, b) => a.localeCompare(b));
  $('#f-voter').insertAdjacentHTML('beforeend', voters.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
  const scripts = new Map();
  for (const v of votes) if (!scripts.has(v.textHash)) scripts.set(v.textHash, { text: v.text, n: 0 });
  for (const v of votes) scripts.get(v.textHash).n++;
  $('#f-script').insertAdjacentHTML('beforeend', [...scripts].map(([h, s]) => `<option value="${esc(h)}">${esc(snippet(s.text, 60))} (${s.n})</option>`).join(''));

  for (const id of ['#f-voter', '#f-script', '#f-level']) $(id).addEventListener('change', render);
  $('#h2h-a').addEventListener('change', renderHeadToHead);
  $('#h2h-b').addEventListener('change', renderHeadToHead);
  render();
}

async function okJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function notice(html, kind = '') {
  const n = $('#notice');
  n.className = `notice ${kind}`.trim();
  n.innerHTML = html;
  n.hidden = false;
}

const snippet = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function filtered() {
  const voter = $('#f-voter').value;
  const script = $('#f-script').value;
  return votes.filter((v) => (!voter || v.voter === voter) && (!script || v.textHash === script));
}

function render() {
  const vs = filtered();
  const level = $('#f-level').value;
  $('#summary').textContent = `${plural(vs.length, 'vote')} · ${plural(new Set(vs.map((v) => v.voter)).size, 'voter')} · ${plural(new Set(vs.map((v) => v.textHash)).size, 'script')}`;

  const rows = tally(vs, level);
  $('#tally').innerHTML = rows.length
    ? `<thead><tr><th>${esc(levelName(level))}</th><th class="num">Appearances</th><th class="num">Wins</th><th class="num">Win rate</th><th class="num">Numbers wrong</th><th class="num">Mean rank</th></tr></thead>
       <tbody>${rows.map((r) => `<tr>
         <td class="lead"><span class="sw" style="--c:${esc(colors[r.provider] || '')}"></span>${esc(r.label)}${r.options ? ` <span class="opts">${esc(r.options)}</span>` : ''}</td>
         <td class="num">${r.appearances}</td><td class="num">${r.wins}</td><td class="num">${pct(r.winRate)}</td>
         <td class="num">${r.numbersWrong}${r.numbersWrong ? ` <span class="dim">of ${r.appearances}</span>` : ''}</td>
         <td class="num">${r.meanRank == null ? '—' : `${r.meanRank.toFixed(2)} <span class="dim">of ${r.ranked}</span>`}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="dim">Nothing to tally for this filter.</td></tr></tbody>';

  // Keep the head-to-head picks across re-renders when the identities still exist at this level.
  const ids = identities(vs, level);
  for (const [sel, i] of [['#h2h-a', 0], ['#h2h-b', 1]]) {
    const el = $(sel);
    const prev = el.value;
    el.innerHTML = ids.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('');
    el.value = ids.some((x) => x.key === prev) ? prev : ids[Math.min(i, ids.length - 1)]?.key || '';
  }
  renderHeadToHead();
  renderRecent(vs);
}

const levelName = (level) => ({ voice: 'Voice', model: 'Model', provider: 'Provider' }[level]);

function renderHeadToHead() {
  const level = $('#f-level').value;
  const a = $('#h2h-a');
  const b = $('#h2h-b');
  const out = $('#h2h-out');
  if (!a.value || !b.value) { out.innerHTML = '<div><dd class="dim">Vote on a run with two or more voices first.</dd></div>'; return; }
  if (a.value === b.value) { out.innerHTML = '<div><dd class="dim">Pick two different voices.</dd></div>'; return; }
  const h = headToHead(filtered(), a.value, b.value, level);
  const nameA = a.selectedOptions[0].textContent;
  const nameB = b.selectedOptions[0].textContent;
  if (!h.runs) { out.innerHTML = '<div><dd class="dim">Never heard in the same run.</dd></div>'; return; }
  out.innerHTML = `
    <div><dt>Runs with both</dt><dd>${h.runs}</dd></div>
    <div><dt>${esc(nameA)} picked</dt><dd>${h.aWins}<small>${pct(h.aWins / h.runs)}</small></dd></div>
    <div><dt>${esc(nameB)} picked</dt><dd>${h.bWins}<small>${pct(h.bWins / h.runs)}</small></dd></div>
    <div><dt>Another take picked</dt><dd>${h.neither}</dd></div>
    ${h.bothRanked ? `<div><dt>Ranked above the other</dt><dd>${h.aAbove}<small>vs ${h.bAbove} of ${h.bothRanked} ranked</small></dd></div>` : ''}`;
}

function renderRecent(vs) {
  const recent = [...vs].reverse().slice(0, 50);
  const pickOf = (v) => v.takes.find((t) => t.letter === v.pick);
  $('#recent').innerHTML = recent.length
    ? `<thead><tr><th>When</th><th>Voter</th><th>Script</th><th>Picked</th><th>Numbers wrong</th><th>Note</th></tr></thead>
       <tbody>${recent.map((v) => `<tr>
         <td class="dim">${esc(new Date(v.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</td>
         <td>${esc(v.voter)}</td>
         <td class="script" title="${esc(v.text)}">${esc(v.text)}</td>
         <td><span class="letter">${esc(v.pick)}</span> ${esc(pickOf(v) ? identityLabel(pickOf(v)) : '')}${v.ranking ? ` <span class="dim">then ${esc(v.ranking.slice(1).join(', '))}</span>` : ''}</td>
         <td>${v.numbersWrong.length ? v.takes.filter((t) => t.numbersWrong).map((t) => `${esc(t.letter)} ${esc(identityLabel(t))}`).join('<br>') : '<span class="dim">—</span>'}</td>
         <td>${esc(v.note || '')}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="dim">No votes match this filter.</td></tr></tbody>';
}

init();
