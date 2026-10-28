import { presets } from './presets.js';

/* ---------------- State ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let cfg = null;
const voiceCache = {};
let lineup = store.get('sir.lineup', {});
let lexicon = store.get('sir.lexicon', []);
let currentAudio = null;
let samples = null;

const byId = (id) => cfg.providers.find((p) => p.id === id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const pass = $('#passcode')?.value || sessionStorage.getItem('sir.pass');
  if (pass) headers['x-passcode'] = pass;
  const res = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------- Formatting ---------------- */
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}<small>s</small>` : `${Math.round(ms)}<small>ms</small>`);
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtUsd = (v) => (v == null ? '—' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
function estimateCost(price, chars, seconds) {
  if (!price) return null;
  if (price.per1k != null) return (chars / 1000) * price.per1k;
  if (price.perMin != null && seconds != null) return (seconds / 60) * price.perMin;
  return null;
}

/* ---------------- Boot ---------------- */
async function init() {
  try {
    cfg = await api('/api/config');
  } catch (e) {
    showNotice(`Can’t reach the server: ${esc(e.message)}`);
    return;
  }
  const ready = cfg.providers.filter((p) => p.configured);
  if (!cfg.liveEnabled) {
    showNotice('<strong>Hosted demo:</strong> you’re hearing pre-recorded takes. To generate your own audio and try pronunciation fixes live, <a href="https://github.com/ghelmstetter/ai-voice-torture-test#quick-start" target="_blank" rel="noopener">run it locally</a> with your own keys.', 'info');
  } else if (!ready.length) {
    showNotice('No API keys found. Copy <code>.env.example</code> to <code>.env</code>, add at least one provider key, then restart the server.');
  }
  if (cfg.passcodeRequired) {
    // A shared link can carry the passcode (?code=…); remember it for this tab, then hide it from the address bar.
    const params = new URLSearchParams(location.search);
    if (params.get('code')) {
      sessionStorage.setItem('sir.pass', params.get('code'));
      params.delete('code');
      history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
    }
    const saved = sessionStorage.getItem('sir.pass') || '';
    $('#passcode-row').hidden = false;
    $('#passcode').value = saved;
    $('#passcode').addEventListener('input', (e) => { sessionStorage.setItem('sir.pass', e.target.value); $('#passcode-error').hidden = true; });
    if (cfg.liveEnabled && !saved) {
      showNotice('<strong>Hosted demo:</strong> Samples are open to everyone. Live generation needs a passcode; if you were given one, choose <strong>Live</strong> and enter it next to <strong>Generate</strong>.', 'info');
      setMode('samples');
    }
  }
  if (!cfg.liveEnabled) {
    $('#mode-live').disabled = true;
    $('#mode-live').title = 'Live generation runs on your own computer with your own API keys.';
    setMode('samples');
  }
  if (!cfg.claudeConfigured) {
    $('#gen-hint').textContent = 'Add ANTHROPIC_API_KEY to .env to turn this on.';
    $('#gen-btn').disabled = true;
    $('#suggest-btn').disabled = true;
    $('#suggest-btn').title = 'Add ANTHROPIC_API_KEY to .env to turn this on.';
  }

  for (const p of cfg.providers) {
    lineup[p.id] = {
      on: p.configured && (lineup[p.id]?.on ?? true),
      model: p.models.some((m) => m.id === lineup[p.id]?.model) ? lineup[p.id].model : p.defaultModel,
      voice: lineup[p.id]?.voice || null,
      options: lineup[p.id]?.options || {},
    };
  }
  renderProviders();
  renderPresets();
  renderLexicon();
  renderTipsTabs();
  bindScript();
  bindDrawers();

  const t = $('#text');
  t.value = store.get('sir.text', presets[0].text);
  onTextChange();
}

function showNotice(html, kind = '') {
  const n = $('#notice');
  n.className = `notice ${kind}`.trim();
  n.innerHTML = html;
  n.hidden = false;
}

/* ---------------- Mode ---------------- */
function setMode(mode) {
  $('#mode-live').setAttribute('aria-selected', mode === 'live');
  $('#mode-samples').setAttribute('aria-selected', mode === 'samples');
  $('#live-view').hidden = mode !== 'live';
  $('#samples-view').hidden = mode !== 'samples';
  if (mode === 'samples') loadSamples();
}
$('#mode-live').addEventListener('click', () => setMode('live'));
$('#mode-samples').addEventListener('click', () => setMode('samples'));

/* ---------------- Providers ---------------- */
function saveLineup() { store.set('sir.lineup', lineup); }

function renderProviders() {
  const list = $('#provider-list');
  list.innerHTML = '';
  for (const p of cfg.providers) {
    const st = lineup[p.id];
    const el = document.createElement('div');
    el.className = `prov${st.on ? ' on' : ''}`;
    el.style.setProperty('--c', p.color);
    el.innerHTML = `
      <div class="prov-top">
        <label class="toggle" title="${p.configured ? 'Include in the next run' : `Add ${esc(p.envKey)} to .env`}">
          <input type="checkbox" ${st.on ? 'checked' : ''} ${p.configured ? '' : 'disabled'} aria-label="Use ${esc(p.name)}" />
          <span></span>
        </label>
        <span class="prov-name">${esc(p.name)}</span>
        <span class="prov-status ${p.configured ? '' : 'missing'}">${p.configured ? '' : `Needs ${esc(p.envKey)}`}</span>
      </div>
      <div class="prov-fields">
        <label>Model <select data-f="model">${p.models.map((m) => `<option value="${esc(m.id)}" ${m.id === st.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <label>Voice <select data-f="voice"><option>Loading…</option></select></label>
        <div class="opts full"></div>
        <p class="prov-note"></p>
      </div>`;
    const toggle = $('input[type=checkbox]', el);
    toggle.addEventListener('change', () => {
      st.on = toggle.checked;
      el.classList.toggle('on', st.on);
      saveLineup();
      updateRunButton();
      refreshLexiconMethods();
    });
    $('[data-f=model]', el).addEventListener('change', (e) => {
      st.model = e.target.value;
      saveLineup();
      fillVoices(p, el);
      renderOptions(p, el);
      updateRunButton();
      refreshLexiconMethods();
    });
    $('[data-f=voice]', el).addEventListener('change', (e) => { st.voice = e.target.value; saveLineup(); });
    list.append(el);
    renderOptions(p, el);
    loadVoices(p).then(() => fillVoices(p, el));
  }
  updateRunButton();
}

function renderOptions(p, el) {
  const st = lineup[p.id];
  const wrap = $('.opts', el);
  wrap.innerHTML = '';
  for (const o of p.options || []) {
    if (o.models && !o.models.includes(st.model)) continue;
    const val = st.options[o.key] ?? o.default ?? '';
    const lab = document.createElement('label');
    lab.innerHTML = `${esc(o.label)} ${o.type === 'select'
      ? `<select>${o.choices.map((c) => `<option value="${esc(c)}" ${c === val ? 'selected' : ''}>${c ? esc(c) : 'Default'}</option>`).join('')}</select>`
      : `<input type="text" value="${esc(val)}" placeholder="${esc(o.placeholder || '')}" />`}`;
    $('select, input', lab).addEventListener('input', (e) => { st.options[o.key] = e.target.value; saveLineup(); });
    wrap.append(lab);
  }
  const model = p.models.find((m) => m.id === st.model);
  $('.prov-note', el).textContent = model?.notes || '';
}

async function loadVoices(p) {
  if (voiceCache[p.id]) return voiceCache[p.id];
  try {
    voiceCache[p.id] = await api(`/api/voices?provider=${p.id}`);
  } catch {
    voiceCache[p.id] = { voices: [], source: 'error' };
  }
  return voiceCache[p.id];
}

function fillVoices(p, el) {
  const st = lineup[p.id];
  const sel = $('[data-f=voice]', el);
  const all = voiceCache[p.id]?.voices || [];
  const voices = all.filter((v) => !v.model || v.model === st.model);
  sel.innerHTML = voices.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.tags ? ` · ${esc(v.tags)}` : ''}</option>`).join('');
  if (!voices.some((v) => v.id === st.voice)) st.voice = voices[0]?.id || null;
  sel.value = st.voice || '';
  saveLineup();
}

const targets = () => cfg.providers.filter((p) => p.configured && lineup[p.id].on).map((p) => ({ p, ...lineup[p.id] }));

function updateRunButton() {
  const n = targets().length;
  const chars = $('#text').value.trim().length;
  const btn = $('#run-btn');
  btn.disabled = !n || !chars;
  const cost = targets().reduce((sum, t) => {
    const price = t.p.models.find((m) => m.id === t.model)?.price;
    // perMin pricing: assume ~15 characters per second of speech for the estimate
    return sum + (estimateCost(price, chars, chars / 15) || 0);
  }, 0);
  btn.textContent = n ? `Generate ${n} take${n > 1 ? 's' : ''} · ~${fmtUsd(cost)}` : 'Turn on a voice';
}

/* ---------------- Script ---------------- */
function bindScript() {
  $$('.script .tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.script .tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    $$('.src-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.src; });
  }));
  $('#text').addEventListener('input', onTextChange);
  $('#speed').addEventListener('input', (e) => { $('#speed-out').textContent = `${Number(e.target.value).toFixed(2)}×`; });
  $('#run-btn').addEventListener('click', run);
  $('#preview-btn').addEventListener('click', preview);
  $('#gen-btn').addEventListener('click', generateWithClaude);

  const input = $('#file-input');
  const dz = $('#dropzone');
  input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });
}

async function loadFile(file) {
  const text = (await file.text()).slice(0, cfg.maxChars);
  setText(text);
}

function setText(text) {
  $('#text').value = text;
  onTextChange();
  $('#text').focus();
}

function onTextChange() {
  const text = $('#text').value;
  store.set('sir.text', text);
  const n = text.trim().length;
  const over = n > cfg.maxChars;
  $('#char-count').textContent = `${n.toLocaleString()} characters${over ? ` · limit is ${cfg.maxChars.toLocaleString()}` : ''}`;
  $('#char-count').style.color = over ? 'var(--danger)' : '';
  const found = lexicon.filter((e) => wordRegex(e).test(text));
  $('#found-words').innerHTML = found.length ? `Pronunciation fixes in use: ${found.map((e) => `<span>${esc(e.word)}</span>`).join('')}` : '';
  $$('.preset[data-id]', $('#preset-list')).forEach((b) => b.setAttribute('aria-pressed', presets.find((p) => p.id === b.dataset.id)?.text === text));
  updateRunButton();
  $('#preview').hidden = true;
}

const wordRegex = (e) => new RegExp(`(?<![\\p{L}\\p{N}])${e.word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, e.caseSensitive ? 'u' : 'iu');

function renderPresets() {
  const list = $('#preset-list');
  list.innerHTML = presets.map((p) => `<button class="preset" data-id="${p.id}" aria-pressed="false"><strong>${esc(p.title)}</strong><span>${esc(p.checks)}</span></button>`).join('');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (b) setText(presets.find((p) => p.id === b.dataset.id).text);
  });
}

async function generateWithClaude() {
  const btn = $('#gen-btn');
  const hint = $('#gen-hint');
  btn.disabled = true;
  hint.className = 'hint';
  hint.textContent = 'Claude is writing…';
  try {
    const r = await api('/api/generate-text', { kind: $('#gen-kind').value, topic: $('#gen-topic').value, words: lexicon.map((e) => e.word) });
    setText(r.text);
    hint.textContent = `Written by ${r.model} in ${(r.ms / 1000).toFixed(1)}s (${r.usage?.output_tokens ?? '?'} tokens).`;
  } catch (e) {
    hint.className = 'hint error';
    hint.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function preview() {
  const box = $('#preview');
  const ts = targets();
  if (!ts.length) return;
  const speed = Number($('#speed').value);
  const r = await api('/api/compile', { text: $('#text').value, lexicon, targets: ts.map((t) => ({ provider: t.p.id, model: t.model, speed: t.p.speed ? Math.min(t.p.speed.max, Math.max(t.p.speed.min, speed)) : 1 })) });
  box.innerHTML = r.results.map((x) => {
    const p = byId(x.provider);
    return `<div style="--c:${p.color}"><h3><span class="swatch"></span>${esc(p.name)} <span class="pmodel">${esc(x.model)}</span></h3>${sentDetails(x)}</div>`;
  }).join('');
  box.hidden = false;
}

function sentDetails(x) {
  const applied = (x.applied || []).map((a) => `<li><b>${esc(a.word)}</b> → ${esc(a.method)}${a.count > 1 ? ` ×${a.count}` : ''}${a.note ? ` (${esc(a.note)})` : ''}</li>`).join('');
  const warn = (x.warnings || []).map((w) => `<p class="warn">${esc(w)}</p>`).join('');
  return `<pre class="sent-text">${esc(x.sentText ?? x.text)}</pre>${applied ? `<ul class="applied">${applied}</ul>` : ''}${warn}`;
}

/* ---------------- Running takes ---------------- */
async function run() {
  const text = $('#text').value.trim();
  const ts = targets();
  if (!text || !ts.length) return;
  if (cfg.passcodeRequired) {
    const err = $('#passcode-error');
    try {
      await api('/api/passcode', {});
      err.hidden = true;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      $('#passcode').focus();
      return;
    }
  }
  const speed = Number($('#speed').value);
  const runs = $('#runs');
  $('.empty', runs)?.remove();

  const block = document.createElement('section');
  block.className = 'run';
  block.innerHTML = `<div class="run-head"><p class="run-text"></p><span class="run-meta num">${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${speed.toFixed(2)}× speed</span></div><div class="take-grid"></div>`;
  $('.run-text', block).textContent = text;
  runs.prepend(block);
  block.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  const btn = $('#run-btn');
  btn.disabled = true;
  const cards = ts.map((t) => {
    const card = makeTakeCard(t.p, t.model, voiceName(t.p.id, t.voice));
    card.classList.add('loading');
    $('.take-grid', block).append(card);
    return { t, card };
  });

  const results = await Promise.all(cards.map(async ({ t, card }) => {
    const sp = t.p.speed ? Math.min(t.p.speed.max, Math.max(t.p.speed.min, speed)) : 1;
    try {
      const r = await api('/api/synthesize', { provider: t.p.id, model: t.model, voice: t.voice, text, lexicon, speed: sp, options: t.options });
      const audio = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
      return await fillTake(card, t.p, { ...r, blob: new Blob([audio], { type: r.contentType }) });
    } catch (e) {
      card.classList.remove('loading');
      card.classList.add('failed');
      $('.stats', card).outerHTML = `<p class="error">${esc(e.message)}</p>`;
      return null;
    }
  }));
  markBest(results.filter(Boolean));
  updateRunButton();
}

const voiceName = (pid, vid) => voiceCache[pid]?.voices?.find((v) => v.id === vid)?.name || vid;

function makeTakeCard(p, model, voice) {
  const card = $('#take-tpl').content.firstElementChild.cloneNode(true);
  card.style.setProperty('--c', p.color);
  $('.pname', card).textContent = p.name;
  $('.pmodel', card).textContent = p.models.find((m) => m.id === model)?.label || model;
  $('.pvoice', card).textContent = voice || '';
  $('.stats', card).innerHTML = ['First audio', 'Total time', 'Audio length', 'Real-time factor', 'Characters', 'Est. cost'].map((l) => `<div><dt>${l}</dt><dd>—</dd></div>`).join('');
  return card;
}

async function fillTake(card, p, r) {
  const url = URL.createObjectURL(r.blob);
  const audio = new Audio(url);
  let peaks = [];
  let duration = null;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await r.blob.arrayBuffer());
    duration = buf.duration;
    peaks = computePeaks(buf, 600);
    ctx.close();
  } catch {
    await new Promise((res) => { audio.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 1500); });
    duration = Number.isFinite(audio.duration) ? audio.duration : null;
  }
  card.classList.remove('loading');

  const m = r.metrics;
  // A provider that reports usage (OpenAI Realtime) gives the take's real cost; otherwise estimate from list price.
  const metered = r.cost?.usd != null;
  const cost = metered ? r.cost.usd : estimateCost(r.price, m.sentChars, duration);
  const rtf = duration ? m.totalMs / 1000 / duration : null;
  const stats = [
    ['First audio', fmtMs(m.ttfaMs), 'ttfa'],
    ['Total time', fmtMs(m.totalMs)],
    ['Audio length', duration ? `${duration.toFixed(1)}<small>s</small>` : '—'],
    ['Real-time factor', rtf ? `${rtf.toFixed(2)}<small>×</small>` : '—', 'rtf'],
    ['Characters', `${m.sentChars.toLocaleString()}${m.sentChars !== m.inputChars ? `<small>of ${m.inputChars} typed</small>` : ''}`],
    [metered ? 'Cost (metered)' : 'Est. cost', fmtUsd(cost), 'cost'],
  ];
  $('.stats', card).innerHTML = stats.map(([l, v, k]) => `<div ${k ? `data-k="${k}"` : ''}><dt>${l}</dt><dd>${v}</dd></div>`).join('');
  $('.time', card).textContent = duration ? fmtSec(duration) : '';
  // What the model said, for providers that return a transcript (OpenAI Realtime): a paraphrase should be readable, not just audible.
  if (r.transcript) $('.sent', card).insertAdjacentHTML('beforebegin', `<p class="transcript"><b>Transcript</b> ${esc(r.transcript)}</p>`);

  const report = r.providerReport ? `<h4>Provider report</h4><pre class="sent-text">${esc(Object.entries(r.providerReport).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre>` : '';
  const { text: _t, transcript: _tr, input: _i, ...params } = r.sent || {};
  const ext = r.contentType.includes('wav') ? 'wav' : 'mp3';
  $('.sent-body', card).innerHTML = `<h4>Text</h4>${sentDetails(r)}${report}${Object.keys(params).length ? `<h4>Request settings</h4><pre class="sent-text">${esc(JSON.stringify(params, null, 2))}</pre>` : ''}
    <div class="take-actions"><a href="${url}" download="${p.id}-${r.model}.${ext}">Download audio</a></div>`;

  wireWaveform(card, audio, peaks, p.color);
  return { card, ttfa: m.ttfaMs, rtf, cost };
}

function markBest(results) {
  if (results.length < 2) return;
  const best = (key, label) => {
    const vals = results.filter((x) => x[key] != null);
    if (vals.length < 2) return;
    const min = vals.reduce((a, b) => (b[key] < a[key] ? b : a));
    $(`[data-k="${key}"] dd`, min.card)?.insertAdjacentHTML('beforeend', `<span class="badge">${label}</span>`);
  };
  best('ttfa', 'fastest');
  best('cost', 'cheapest');
}

/* ---------------- Waveform ---------------- */
function computePeaks(buf, n) {
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / n));
  const peaks = [];
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * step;
    for (let j = start; j < start + step && j < data.length; j += 4) max = Math.max(max, Math.abs(data[j]));
    peaks.push(max);
  }
  const top = Math.max(...peaks, 0.01);
  return peaks.map((v) => v / top);
}

function wireWaveform(card, audio, peaks, color) {
  const canvas = $('.wave', card);
  const btn = $('.play', card);
  const time = $('.time', card);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const bars = Math.floor(w / 4);
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    for (let i = 0; i < bars; i++) {
      const v = peaks.length ? peaks[Math.floor((i / bars) * peaks.length)] : 0.15;
      const bh = Math.max(2, v * (h - 6));
      g.fillStyle = i / bars < progress ? color : 'rgba(238,234,246,0.2)';
      g.beginPath();
      g.roundRect(i * 4, (h - bh) / 2, 2.2, bh, 1.1);
      g.fill();
    }
  };
  draw();
  new ResizeObserver(draw).observe(canvas);

  let raf = 0;
  const tick = () => { draw(); time.textContent = fmtSec(audio.currentTime); if (!audio.paused) raf = requestAnimationFrame(tick); };
  audio.addEventListener('play', () => { card.classList.add('playing'); btn.setAttribute('aria-label', 'Pause'); tick(); });
  audio.addEventListener('pause', () => { card.classList.remove('playing'); btn.setAttribute('aria-label', 'Play'); cancelAnimationFrame(raf); draw(); });
  audio.addEventListener('ended', () => { audio.currentTime = 0; draw(); time.textContent = fmtSec(audio.duration || 0); });

  const play = () => {
    if (currentAudio && currentAudio !== audio) currentAudio.pause();
    currentAudio = audio;
    audio.paused ? audio.play() : audio.pause();
  };
  btn.addEventListener('click', play);
  canvas.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    if (audio.paused) play(); else draw();
  });
}

/* ---------------- Samples mode ---------------- */
async function loadSamples() {
  const runs = $('#sample-runs');
  if (!samples) {
    try {
      const res = await fetch('demo/manifest.json', { cache: 'no-store' });
      samples = res.ok ? await res.json() : { takes: [] };
    } catch {
      samples = { takes: [] };
    }
  }
  const have = presets.filter((p) => samples.takes.some((t) => t.presetId === p.id));
  const list = $('#sample-presets');
  if (!have.length) {
    list.innerHTML = '';
    runs.innerHTML = '<p class="empty">No samples recorded yet. Add your API keys to .env, then run <code>npm run build-demo</code> to record every test preset with every provider.</p>';
    return;
  }
  list.innerHTML = have.map((p) => `<button class="preset" data-id="${p.id}" aria-pressed="false"><strong>${esc(p.title)}</strong><span>${esc(p.checks)}</span></button>`).join('');
  list.onclick = (e) => { const b = e.target.closest('.preset'); if (b) showSample(b.dataset.id); };
  showSample(have[0].id);
}

async function showSample(presetId) {
  $$('#sample-presets .preset').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === presetId));
  const preset = presets.find((p) => p.id === presetId);
  const runs = $('#sample-runs');
  runs.innerHTML = `<section class="run"><div class="run-head"><p class="run-text"></p><span class="run-meta">Recorded ${samples.updatedAt ? new Date(samples.updatedAt).toLocaleDateString() : ''}</span></div><div class="take-grid"></div></section>`;
  $('.run-text', runs).textContent = preset.text;
  const grid = $('.take-grid', runs);
  const takes = samples.takes.filter((t) => t.presetId === presetId);
  const results = await Promise.all(takes.map(async (t) => {
    const p = byId(t.provider) || { id: t.provider, name: t.provider, color: '#aaa', models: [] };
    const card = makeTakeCard(p, t.model, t.voiceName || voiceName(t.provider, t.voice));
    card.classList.add('loading');
    grid.append(card);
    const blob = await (await fetch(`demo/${t.file}`)).blob();
    return fillTake(card, p, { ...t, blob });
  }));
  markBest(results);
}

/* ---------------- Pronunciations ---------------- */
function saveLexicon() {
  store.set('sir.lexicon', lexicon);
  renderLexicon();
  onTextChange();
}

function renderLexicon() {
  $('#lex-count').textContent = lexicon.length;
  const list = $('#lex-list');
  if (!lexicon.length) {
    list.innerHTML = '<p class="lex-empty">No words yet. Add a name or brand that voices get wrong, with a sounds-like spelling, an IPA spelling, or both.</p>';
    return;
  }
  list.innerHTML = lexicon.map((e) => `
    <div class="lex-item" data-id="${e.id}">
      <div class="lex-item-top">
        <span class="lex-word">${esc(e.word)}</span>
        <span class="lex-say">${esc(e.soundsLike || '')}</span>
        <div class="lex-btns">
          <button data-act="test" title="Put a test sentence in the script">Test</button>
          <button data-act="edit">Edit</button>
          <button data-act="del" aria-label="Delete ${esc(e.word)}">Delete</button>
        </div>
      </div>
      ${e.ipa ? `<span class="lex-ipa">/${esc(e.ipa)}/</span>` : ''}
      <div class="lex-methods"></div>
    </div>`).join('');
  refreshLexiconMethods();
}

// Show how each turned-on provider will apply each word.
async function refreshLexiconMethods() {
  if (!lexicon.length || !cfg) return;
  const ts = cfg.providers.map((p) => ({ provider: p.id, model: lineup[p.id].model }));
  try {
    const r = await api('/api/compile', { text: lexicon.map((e) => e.word).join(' . '), lexicon, targets: ts });
    for (const e of lexicon) {
      const box = $(`.lex-item[data-id="${e.id}"] .lex-methods`);
      if (!box) continue;
      box.innerHTML = r.results.map((x) => {
        const p = byId(x.provider);
        const a = x.applied.find((y) => y.word === e.word);
        const ok = a && a.method !== 'not applied';
        return `<span style="--c:${p.color}" class="${ok ? '' : 'none'}" title="${esc(a?.note || '')}"><b>${esc(p.name)}</b> ${esc(ok ? a.method : 'no fix')}</span>`;
      }).join('');
    }
  } catch { /* preview is best-effort */ }
}

function bindLexicon() {
  const form = $('#lex-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const entry = {
      id: f.get('id') || crypto.randomUUID(),
      word: f.get('word').trim(),
      soundsLike: f.get('soundsLike').trim(),
      ipa: f.get('ipa').trim().replace(/^\/|\/$/g, ''),
      caseSensitive: f.get('caseSensitive') === 'on',
    };
    if (!entry.word) return;
    if (!entry.soundsLike && !entry.ipa) {
      $('#lex-hint').className = 'hint error';
      $('#lex-hint').textContent = 'Add a sounds-like spelling or IPA so the voices know what to say.';
      return;
    }
    const i = lexicon.findIndex((x) => x.id === entry.id);
    if (i >= 0) lexicon[i] = entry; else lexicon.push(entry);
    form.reset();
    form.elements.id.value = '';
    $('#lex-save').textContent = 'Add word';
    $('#lex-hint').textContent = '';
    saveLexicon();
  });

  $('#lex-list').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('.lex-item').dataset.id;
    const e = lexicon.find((x) => x.id === id);
    if (b.dataset.act === 'del') { lexicon = lexicon.filter((x) => x.id !== id); saveLexicon(); }
    if (b.dataset.act === 'edit') {
      for (const k of ['id', 'word', 'soundsLike', 'ipa']) form.elements[k].value = e[k] || '';
      form.elements.caseSensitive.checked = !!e.caseSensitive;
      $('#lex-save').textContent = 'Save changes';
      form.elements.word.focus();
    }
    if (b.dataset.act === 'test') {
      closeDrawers();
      setMode('live');
      setText(`${e.word}. Welcome to ${e.word}, where the team at ${e.word} says hello. Have you heard of ${e.word}?`);
    }
  });

  $('#suggest-btn').addEventListener('click', async () => {
    const hint = $('#lex-hint');
    const word = form.elements.word.value.trim();
    if (!word) { hint.className = 'hint error'; hint.textContent = 'Type the word first.'; form.elements.word.focus(); return; }
    hint.className = 'hint';
    hint.textContent = 'Asking Claude…';
    try {
      const r = await api('/api/suggest-pronunciation', { word, soundsLike: form.elements.soundsLike.value });
      form.elements.ipa.value = r.ipa;
      if (!form.elements.soundsLike.value) form.elements.soundsLike.value = r.soundsLike;
      hint.textContent = 'Suggested. Check it by ear with Test after saving.';
    } catch (e) {
      hint.className = 'hint error';
      hint.textContent = e.message;
    }
  });

  $('#lex-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ entries: lexicon }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'pronunciations.json' });
    a.click();
  });
  $('#lex-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const incoming = (j.entries || j).filter((e) => e.word);
      for (const e of incoming) {
        e.id ||= crypto.randomUUID();
        const i = lexicon.findIndex((x) => x.word.toLowerCase() === e.word.toLowerCase());
        if (i >= 0) lexicon[i] = e; else lexicon.push(e);
      }
      saveLexicon();
    } catch {
      $('#lex-hint').className = 'hint error';
      $('#lex-hint').textContent = 'That file isn’t a pronunciations export.';
    }
    ev.target.value = '';
  });
}

/* ---------------- Tips ---------------- */
function renderTipsTabs() {
  const tabs = $('#tips-tabs');
  tabs.innerHTML = cfg.providers.map((p, i) => `<button role="tab" data-id="${p.id}" aria-selected="${i === 0}">${esc(p.name)}</button>`).join('');
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTips(b.dataset.id); });
  showTips(cfg.providers[0].id);
}

function showTips(id) {
  $$('#tips-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.id === id));
  const p = byId(id);
  const body = $('#tips-body');
  body.style.setProperty('--c', p.color);
  const price = (pr) => (pr?.per1k != null ? `$${pr.per1k.toFixed(3)} / 1K chars` : pr?.perMin != null ? `~$${pr.perMin.toFixed(3)} / min` : '—');
  body.innerHTML = `
    <div class="tips-how"><strong>How this app applies your fixes:</strong> ${esc(p.lexiconHow)}</div>
    <table class="models-table"><thead><tr><th>Model</th><th>List price</th><th>Notes</th></tr></thead><tbody>
      ${p.models.map((m) => `<tr><td>${esc(m.label)}</td><td>${price(m.price)}</td><td>${esc(m.notes || '')}</td></tr>`).join('')}
    </tbody></table>
    ${p.tips.map((t) => `<div class="tip"><h3>${esc(t.title)}</h3><p>${esc(t.body)}</p>${t.example ? `<code>${esc(t.example)}</code>` : ''}</div>`).join('')}
    <div class="tips-docs">${p.docs.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a>`).join('')}</div>`;
}

/* ---------------- Drawers ---------------- */
function openDrawer(id) {
  closeDrawers();
  $(id).hidden = false;
  $('#scrim').hidden = false;
  $(`${id} input, ${id} button`)?.focus();
}
function closeDrawers() {
  $$('.drawer').forEach((d) => { d.hidden = true; });
  $('#scrim').hidden = true;
}
function bindDrawers() {
  $('#open-lexicon').addEventListener('click', () => openDrawer('#lexicon-drawer'));
  $('#open-tips').addEventListener('click', () => openDrawer('#tips-drawer'));
  $('#scrim').addEventListener('click', closeDrawers);
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeDrawers));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
  bindLexicon();
}

init();
