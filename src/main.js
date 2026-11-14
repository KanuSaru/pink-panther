// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Application state and interface wiring.
import { createGlobe } from './globe.js';
import { VARIABLES, GROUPS, EXAMPLES, PALETTES, TREND_COLORS, paletteFloats, POWER_FIRST_YEAR, GIBS_FIRST_YEAR, HORIZON_MAX, REGION_SIZE, SOURCES, CREDITS } from './config.js';
import { fetchPoint, fetchRegion, fetchGistemp, gibsUrls, lastCompleteYear } from './data.js';
import { seriesFromPower, parseGistempZonal, analyzeSeries, analyzeRegion, regionTexture, niceRange, BAND_EDGES } from './analysis.js';
import { mean } from './stats.js';
import { latLonToVec3, formatLatLon, boxAround, clamp } from './geo.js';
import { renderChart } from './chart.js';
import { describeSeries, describeRegion, buildReport } from './report.js';
import { t, num, setLang, getLang, applyStatic } from './i18n.js';

const $ = (id) => document.getElementById(id);
const LAST = lastCompleteYear();
const FIRST_GISTEMP = 1880;

const state = {
  scope: 'planet',            // planet | point | region
  variable: 'T2M',
  view: 'natural',            // natural | anomaly | temperature | satellite
  point: null,                // { lat, lon, name }
  period: [POWER_FIRST_YEAR, LAST],
  season: 'ANN',
  alpha: 0.05,
  factor: 1,                  // what-if multiplier on the rate of change
  year: LAST,
  month: 7,
  scale: 2.75,
  gistemp: null, gistempMeta: null, gistempError: null,
  planet: null, bands: [], bandsRef: null,
  pointRaw: null, pointAnalysis: null, pointError: null,
  regionRaw: null, region: null, regionRange: 1,
  busy: null,
  sat: null,
  playing: false,
};

const variable = () => VARIABLES.find((v) => v.id === state.variable);
const unitOf = (v) => (getLang() === 'en' && v.unitEn) || v.unit;
let globe;

// ------------------------------------------------------------------ setup

function init() {
  const urlLang = new URLSearchParams(location.search).get('lang');
  // English by default; Spanish with the ES button or ?lang=es
  setLang(urlLang || 'en');

  try {
    globe = createGlobe($('globe'), { onPick: (ll) => selectPoint(ll.lat, ll.lon) });
  } catch (e) {
    showStatus(t('webglFail'));
    console.error(e);
    return;
  }

  globe.set('uDiv', paletteFloats('temp'));
  globe.set('uDivR', paletteFloats(variable().palette));
  Promise.allSettled([
    globe.setImage('uDay', './assets/earth_day.jpg', { repeatX: true }),
    globe.setImage('uClouds', './assets/earth_clouds.jpg', { repeatX: true }),
    globe.setImage('uNormal', './assets/earth_normal.jpg'),
    globe.setImage('uSpec', './assets/earth_specular.jpg'),
    globe.setImage('uTempBase', './assets/temp_base.png', { mipmaps: false }),
    globe.setImage('uPalette', './assets/temp_palette.png', { mipmaps: false }),
  ]).then((r) => { if (r.some((x) => x.status === 'rejected')) console.warn('Some textures failed to load', r); });

  buildControls();
  bind();
  renderAll();
  loadPlanet();
}

function buildControls() {
  const sel = $('variable');
  sel.replaceChildren();
  for (const [gid, gname] of Object.entries(GROUPS)) {
    const og = document.createElement('optgroup');
    og.label = gname[getLang()];
    for (const v of VARIABLES.filter((x) => x.group === gid)) og.append(new Option(v.name[getLang()], v.id, false, v.id === state.variable));
    if (og.children.length) sel.append(og);
  }
  const places = $('places');
  places.replaceChildren(...EXAMPLES.map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p.label[getLang()];
    b.addEventListener('click', () => {
      state.variable = p.variable; state.season = p.season; state.sat = null;
      $('variable').value = p.variable; $('season').value = p.season;
      globe.set('uDivR', paletteFloats(variable().palette));
      selectPoint(p.lat, p.lon, p.place[getLang()]);
      if (state.view === 'satellite') loadSat();
    });
    return b;
  }));
  $('season').replaceChildren(...['ANN', 'DJF', 'MAM', 'JJA', 'SON'].map((s) => new Option(t('s_' + s), s, false, s === state.season)));
  const fmt = new Intl.DateTimeFormat(getLang(), { month: 'long' });
  $('month').replaceChildren(...Array.from({ length: 12 }, (_, i) => new Option(fmt.format(new Date(2020, i, 15)), i + 1, false, i + 1 === state.month)));
  $('credits').replaceChildren(...CREDITS.map((c) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.name;
    li.append(a, ` ${c.note[getLang()]}`);
    return li;
  }));
  $('scale').replaceChildren(...[2.75, 5.5].map((r) => new Option(`± ${num(r, 2)} °C`, r, false, r === state.scale)));
  $('from').value = state.period[0];
  $('to').value = state.period[1];
  $('to').max = LAST;
  $('year').max = HORIZON_MAX;
  $('year').value = state.year;
  buildTrackMarks();
}

function buildTrackMarks() {
  const pct = (y) => ((y - FIRST_GISTEMP) / (HORIZON_MAX - FIRST_GISTEMP)) * 100;
  $('track').style.setProperty('--split-n', pct(LAST) / 100);
  $('trackMarks').replaceChildren(...[1880, 1920, 1960, 2000, LAST, 2060, 2100].map((y) => {
    const s = document.createElement('span');
    s.style.left = pct(y) + '%';
    s.textContent = y;
    if (y === LAST) { s.className = 'split'; const e = document.createElement('em'); e.textContent = ` ${t('observed')} | ${t('projected')}`; s.append(e); }
    return s;
  }));
}

function bind() {
  $('lang').addEventListener('click', (e) => {
    const l = e.target.closest('[data-lang]')?.dataset.lang;
    if (!l || l === getLang()) return;
    setLang(l);
    buildControls();
    renderAll();
  });
  $('aboutBtn').addEventListener('click', () => $('about').showModal());

  $('variable').addEventListener('change', (e) => {
    state.variable = e.target.value;
    globe.set('uDivR', paletteFloats(variable().palette));
    state.sat = null;
    if (state.scope === 'planet') { renderAll(); if (state.view === 'satellite') loadSat(); return; }
    const wasRegion = state.scope === 'region';
    clearRegion();
    loadPoint().then(() => { if (wasRegion) loadRegion(); });
    if (state.view === 'satellite') loadSat();
  });

  $('goPoint').addEventListener('click', () => {
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    if (isFinite(lat) && isFinite(lon)) selectPoint(clamp(lat, -90, 90), clamp(lon, -180, 180));
  });
  $('goRegion').addEventListener('click', loadRegion);
  $('goPlanet').addEventListener('click', () => {
    state.scope = 'planet';
    state.point = null;
    clearRegion();
    globe.set('uMarkerOn', 0);
    globe.zoomOut();
    renderAll();
  });

  const onPeriod = () => {
    const min = state.scope === 'planet' ? FIRST_GISTEMP : POWER_FIRST_YEAR;
    let a = clamp(parseInt($('from').value, 10) || min, min, LAST - 8);
    let b = clamp(parseInt($('to').value, 10) || LAST, a + 8, LAST);
    state.period = [a, b];
    $('from').value = a; $('to').value = b;
    recompute();
  };
  $('from').addEventListener('change', onPeriod);
  $('to').addEventListener('change', onPeriod);
  $('season').addEventListener('change', (e) => { state.season = e.target.value; recompute(); });
  $('alpha').addEventListener('change', (e) => { state.alpha = parseFloat(e.target.value); recompute(); });

  $('view').addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]')?.dataset.view;
    if (v && !e.target.closest('button').disabled) setView(v);
  });
  $('scale').addEventListener('change', (e) => { state.scale = parseFloat(e.target.value); applyBands(); renderLegend(); });
  $('month').addEventListener('change', (e) => { state.month = parseInt(e.target.value, 10); loadSat(); });
  $('exag').addEventListener('input', (e) => { globe.set('uExag', parseFloat(e.target.value)); $('exagOut').textContent = '×' + e.target.value; renderLegend(); });
  $('opacity').addEventListener('input', (e) => globe.set('uOverlay', parseFloat(e.target.value)));
  $('stepped').addEventListener('change', (e) => { globe.set('uStepped', e.target.checked ? 1 : 0); renderLegend(); });

  $('rate').addEventListener('input', (e) => { state.factor = parseFloat(e.target.value); applyBands(); renderChartOnly(); });

  $('year').addEventListener('input', (e) => { stopPlay(); setYear(parseInt(e.target.value, 10), true); });
  $('play').addEventListener('click', () => (state.playing ? stopPlay() : startPlay()));

  $('download').addEventListener('click', () => {
    const blob = new Blob([currentReport()], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${state.scope}-${state.variable}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentReport()); $('copy').textContent = t('copied'); }
    catch { /* clipboard unavailable: the download button still works */ }
    setTimeout(() => { $('copy').textContent = t('copy'); }, 1800);
  });
}

// ------------------------------------------------------------------ data

async function loadPlanet() {
  state.busy = 'loadingGistemp';
  renderFindings();
  try {
    const g = await fetchGistemp();
    state.gistemp = parseGistempZonal(g.csv);
    state.gistempMeta = g;
    state.gistempError = null;
  } catch (e) {
    state.gistempError = e.message || String(e);
  }
  state.busy = null;
  recompute();
}

function selectPoint(lat, lon, name) {
  state.point = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, name: name || null };
  state.scope = 'point';
  clearRegion();
  $('lat').value = state.point.lat;
  $('lon').value = state.point.lon;
  globe.set('uMarkerDir', latLonToVec3(state.point.lat, state.point.lon));
  globe.set('uMarkerOn', 1);
  globe.flyTo(state.point.lat, state.point.lon);
  // the planet period may start before POWER does
  if (state.period[0] < POWER_FIRST_YEAR) { state.period[0] = POWER_FIRST_YEAR; $('from').value = POWER_FIRST_YEAR; }
  return loadPoint();
}

let pointToken = 0;
async function loadPoint() {
  if (!state.point) return;
  const token = ++pointToken;
  state.busy = 'loadingPower';
  state.pointRaw = null; state.pointAnalysis = null; state.pointError = null;
  renderAll();
  try {
    const raw = await fetchPoint({ lat: state.point.lat, lon: state.point.lon, parameter: state.variable, start: POWER_FIRST_YEAR });
    if (token !== pointToken) return;
    state.pointRaw = raw;
  } catch (e) {
    if (token !== pointToken) return;
    state.pointError = t('errPower', { m: e.message || e });
  }
  state.busy = null;
  recompute();
}

let regionToken = 0;
async function loadRegion() {
  if (!state.point) return;
  const token = ++regionToken;
  const box = boxAround(state.point.lat, state.point.lon, REGION_SIZE);
  state.busy = 'loadingRegion';
  state.scope = 'region';
  renderFindings();
  try {
    const raw = await fetchRegion({
      box, parameter: state.variable, start: POWER_FIRST_YEAR,
      onProgress: (a, b) => { if (token === regionToken) showStatus(t('sampling', { a, b })); },
    });
    if (token !== regionToken) return;
    state.regionRaw = raw;
    state.busy = null;
    recompute();
    if (state.region) globe.flyTo((box.latMin + box.latMax) / 2, (box.lonMin + box.lonMax) / 2, 1.9);
  } catch (e) {
    if (token !== regionToken) return;
    state.busy = null;
    state.scope = 'point';
    renderAll();
    showStatus(t('errPower', { m: e.message || e }));
  }
}

function clearRegion() {
  regionToken++;
  state.regionRaw = null; state.region = null;
  globe.set('uRegionOn', 0);
  if (state.scope === 'region') state.scope = 'point';
}

// Recompute every analysis from the data already downloaded
function recompute() {
  const g = state.gistemp;
  if (g) {
    const period = [clamp(state.period[0], g.years[0], g.years.at(-1) - 8), clamp(state.period[1], g.years[0] + 8, g.years.at(-1))];
    const opts = { period, baseline: [1951, 1980], alpha: state.alpha };
    state.planet = analyzeSeries(g.years, g.global, opts);
    state.bands = g.bands.map((b) => analyzeSeries(g.years, b, opts));
    state.bandsRef = g.bands.map((b) => mean(b.slice(-10)));
  }
  if (state.pointRaw) {
    const s = seriesFromPower(state.pointRaw.dict, state.season, state.pointRaw.fill);
    const period = [Math.max(state.period[0], POWER_FIRST_YEAR), state.period[1]];
    state.pointAnalysis = s.years.length ? analyzeSeries(s.years, s.values, { period, baseline: [1991, 2020], alpha: state.alpha }) : null;
    state.pointError = state.pointAnalysis ? null : t(s.years.length ? 'errShort' : 'errOcean');
  }
  if (state.regionRaw) {
    const period = [Math.max(state.period[0], POWER_FIRST_YEAR), state.period[1]];
    state.region = analyzeRegion(state.regionRaw.features, state.variable, { season: state.season, period, alpha: state.alpha, fill: state.regionRaw.fill });
    if (state.region) {
      const r = state.region, b = r.bounds;
      state.regionRange = niceRange(r.maxAbs);
      globe.setData('uRegion', r.w, r.h, regionTexture(r, state.regionRange));
      globe.set('uRegionBox', [b.lonMin, b.latMin, b.lonMax, b.latMax]);
      globe.set('uRegionOn', 1);
    } else {
      globe.set('uRegionOn', 0);
    }
  }
  applyBands();
  renderAll();
}

// Zonal anomalies for the selected year: observed up to the last record,
// trend extrapolation (times the what-if factor) after it.
function applyBands() {
  const g = state.gistemp;
  if (!g || !state.bands.length) return;
  const last = g.years.at(-1);
  const vals = new Float32Array(8);
  for (let k = 0; k < 8; k++) {
    if (state.year <= last) vals[k] = g.bands[k][clamp(state.year - g.years[0], 0, g.years.length - 1)];
    else vals[k] = state.bands[k] ? state.bands[k].project(state.year, state.factor).value + state.bands[k].base : g.bands[k].at(-1);
  }
  globe.set('uBands', vals);
  globe.set('uBandsRef', new Float32Array(state.bandsRef));
  globe.set('uRange', state.scale);
}

// ------------------------------------------------------------------ view and time

function setView(v) {
  state.view = v;
  globe.set('uMode', { natural: 0, anomaly: 1, temperature: 2, satellite: 3 }[v]);
  globe.set('uAtmo', v === 'natural' ? 1 : 0);
  if (v === 'satellite') loadSat();
  renderViewControls();
  renderLegend();
}

function setYear(y, fromUser = false) {
  state.year = clamp(y, FIRST_GISTEMP, HORIZON_MAX);
  if (!fromUser) $('year').value = state.year;
  // the first time the timeline is used, switch to a view that responds to it
  if (state.view === 'natural' && state.gistemp) setView('anomaly');
  applyBands();
  renderYear();
  renderChartOnly();
  if (state.view === 'anomaly' || state.view === 'temperature') renderLegend();
  if (state.view === 'satellite') { clearTimeout(setYear.timer); setYear.timer = setTimeout(loadSat, 280); }
}

let playTimer = null;
function startPlay() {
  if (state.year >= HORIZON_MAX) setYear(FIRST_GISTEMP);
  state.playing = true;
  renderYear();
  playTimer = setInterval(() => {
    if (state.year >= HORIZON_MAX) return stopPlay();
    setYear(state.year + 1);
  }, state.view === 'satellite' ? 900 : 110);
}
function stopPlay() {
  if (!state.playing) return;
  state.playing = false;
  clearInterval(playTimer);
  renderYear();
}

let satToken = 0;
async function loadSat() {
  const v = variable();
  if (!v.gibs) { satToken++; state.sat = { status: 'none' }; globe.set('uSatOn', 0); renderLegend(); return; }
  const y = clamp(state.year, GIBS_FIRST_YEAR, LAST), m = state.month;
  const key = `${v.gibs}|${y}|${m}`;
  if (state.sat?.key === key && state.sat.status !== 'fail') return;
  const token = ++satToken;
  state.sat = { key, status: 'loading', layer: v.gibs, y, m };
  renderLegend();
  for (const url of gibsUrls(v.gibs, y, m)) {
    try {
      await globe.setImage('uSat', url, { mipmaps: false, accept: () => token === satToken });
      if (token !== satToken) return;
      state.sat.status = 'ok';
      globe.set('uSatOn', 1);
      renderLegend();
      return;
    } catch { /* try the proxy next */ }
  }
  if (token === satToken) { state.sat.status = 'fail'; globe.set('uSatOn', 0); renderLegend(); }
}

// ------------------------------------------------------------------ rendering

function renderAll() {
  applyStatic();
  document.title = t('title');
  $('lang').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === getLang()));
  $('varAbout').textContent = variable().about[getLang()];
  $('regionNote').textContent = t('regionNote', { s: REGION_SIZE });
  $('projNote').textContent = t('projNote', { y: LAST });
  $('goRegion').disabled = !state.point;
  $('goPlanet').hidden = state.scope === 'planet';
  $('exagOut').textContent = '×' + $('exag').value;
  renderViewControls();
  renderYear();
  renderFindings();
  renderLegend();
}

function renderViewControls() {
  $('view').querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === state.view);
    b.disabled = !state.gistemp && (b.dataset.view === 'anomaly' || b.dataset.view === 'temperature');
  });
  $('viewHint').textContent = t('vh_' + state.view);
  $('scaleRow').hidden = state.view !== 'anomaly';
  $('monthRow').hidden = state.view !== 'satellite';
  $('exagRow').hidden = state.view !== 'temperature';
  $('opacityRow').hidden = state.view === 'natural';
  $('steppedRow').hidden = state.view !== 'anomaly' && !state.region;
}

function renderYear() {
  $('yearOut').textContent = state.year;
  $('yearKind').textContent = t(state.year > LAST ? 'projected' : 'observed');
  $('play').classList.toggle('playing', state.playing);
  $('play').title = t(state.playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', $('play').title);
}

function showStatus(msg) {
  $('status').textContent = msg;
  $('status').hidden = !msg;
}

function wherePhrase() {
  if (state.scope === 'planet') return { phrase: t('pPlanet'), label: `${t('scopePlanet')} (${t('globalMean')})` };
  const p = state.point;
  const coords = formatLatLon(p.lat, p.lon, getLang());
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return p.name ? { phrase: t('pIn', { x: p.name }), label: `${cap(p.name)} (${coords})` } : { phrase: t('pAt', { x: coords }), label: coords };
}

function seriesContext() {
  if (state.scope === 'planet') {
    const w = wherePhrase();
    return { name: t('tempAnom'), unit: '°C', decimals: 2, wherePhrase: w.phrase, whereLabel: w.label, seasonLabel: null, palette: 'temp' };
  }
  const v = variable(), w = wherePhrase();
  return {
    name: v.name[getLang()], unit: unitOf(v), decimals: v.decimals, wherePhrase: w.phrase, whereLabel: w.label,
    seasonLabel: state.season === 'ANN' ? null : t('s_' + state.season), palette: v.palette,
  };
}

function trendColor(a, palette) {
  if (!a.significant) return '#9aa3ad';
  return TREND_COLORS[palette][a.direction > 0 ? 'up' : 'down'];
}

function fillDl(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v;
    return [dt, dd];
  }));
}

function renderFindings() {
  const scopeText = { planet: t('scopePlanet'), point: t('scopePoint'), region: t('scopeRegion') }[state.scope];
  $('scope').textContent = state.scope === 'planet' ? scopeText : `${scopeText}: ${wherePhrase().label}`;

  const analysis = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  const error = state.scope === 'planet' ? (state.gistempError && t('errGistemp', { m: state.gistempError })) : state.pointError;
  const regionReady = state.scope === 'region' && state.region;

  if (state.busy) { showStatus(t(state.busy)); }
  else if (error && !regionReady) { showStatus(error); }
  else showStatus('');
  $('result').hidden = !(analysis || regionReady) || (!!state.busy && !analysis);
  if ($('result').hidden) return;

  const ctx = seriesContext();
  const d = regionReady ? describeRegion(state.region, ctx) : describeSeries(analysis, ctx);
  $('verdict').textContent = d.verdict;
  $('verdict2').textContent = d.verdict2 + (regionReady && state.regionRaw.sampled ? ` ${t('sampledNote', { n: state.regionRaw.features.length })}` : '');
  $('verdict2').hidden = !$('verdict2').textContent;
  fillDl($('facts'), d.facts);

  $('chartWrap').hidden = !analysis;
  $('detailsWrap').hidden = !analysis;
  if (analysis) {
    $('chartTitle').textContent = `${ctx.name}, ${ctx.whereLabel}. ${t('chartAnom', { a: analysis.baselineUsed[0], b: analysis.baselineUsed[1] })} (${ctx.unit})`;
    renderChartOnly();
    const key = [['obs', t('chartObs')], ['trend', t('chartTrend')], ['proj', t('chartProj')]];
    if (analysis.unusual.length) key.push(['unusual', t('chartUnusual')]);
    $('chartKey').replaceChildren(...key.map(([cls, label]) => {
      const li = document.createElement('li');
      li.className = 'k-' + cls;
      li.style.setProperty('--c', trendColor(analysis, ctx.palette));
      li.textContent = label;
      return li;
    }));
    fillDl($('details'), describeSeries(analysis, ctx).details);
  }

  $('bandsWrap').hidden = state.scope !== 'planet' || !state.bands.length;
  if (!$('bandsWrap').hidden) renderBands();

  const src = state.scope === 'planet' ? state.gistempMeta && { ...SOURCES.gistemp, meta: state.gistempMeta }
    : regionReady ? { ...SOURCES.power, meta: state.regionRaw } : state.pointRaw && { ...SOURCES.power, meta: state.pointRaw };
  const line = $('sourceLine');
  line.replaceChildren();
  if (src) {
    const a = document.createElement('a');
    a.href = src.meta.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = src.name;
    const when = src.meta.fetchedAt.toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' });
    line.append(`${t('source')}: `, a, `, ${t('fetched', { d: when })}${src.meta.snapshot ? ` (${t('snapshot')})` : ''}.`);
  }
}

function renderChartOnly() {
  const analysis = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  if (!analysis || $('result').hidden) return;
  const ctx = seriesContext();
  renderChart($('chart'), {
    analysis, unit: ctx.unit, decimals: ctx.decimals, color: trendColor(analysis, ctx.palette), factor: state.factor,
    endYear: Math.max(2050, state.year), cursorYear: state.year,
    baselineLabel: t('chartBase', { a: analysis.baselineUsed[0], b: analysis.baselineUsed[1] }),
    ariaLabel: $('chartTitle').textContent,
  });
}

function bandLabel(k) {
  const f = (v) => (v === 0 ? '0°' : `${Math.abs(v)}° ${v > 0 ? 'N' : 'S'}`);
  return `${f(BAND_EDGES[k])} – ${f(BAND_EDGES[k + 1])}`;
}

function renderBands() {
  const max = Math.max(...state.bands.map((b) => Math.abs(b.perDecade)));
  const rows = state.bands.map((b, k) => ({ b, k })).reverse(); // north at the top, like the map
  $('bands').replaceChildren(...rows.map(({ b, k }) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.scope = 'row'; th.textContent = bandLabel(k);
    const bar = document.createElement('td'); bar.className = 'bar-cell';
    const i = document.createElement('i');
    i.style.width = (Math.abs(b.perDecade) / max) * 100 + '%';
    i.style.background = TREND_COLORS.temp[b.perDecade > 0 ? 'up' : 'down'];
    if (!b.significant) i.className = 'ns';
    bar.append(i);
    const val = document.createElement('td'); val.className = 'n'; val.textContent = `${num(b.perDecade, 2, { sign: true })} °C`;
    const sig = document.createElement('td'); sig.className = 'sig'; sig.textContent = b.significant ? t('sigYes') : t('sigNo');
    tr.append(th, bar, val, sig);
    return tr;
  }));
}

function legendBlocks(palette, range, unit, decimals) {
  const wrap = document.createElement('div');
  wrap.className = 'blocks' + ($('stepped').checked ? '' : ' smooth');
  PALETTES[palette].forEach((c) => { const s = document.createElement('span'); s.style.background = c; wrap.append(s); });
  const ticks = document.createElement('div');
  ticks.className = 'ticks';
  for (const v of [-range, -range / 2, 0, range / 2, range]) {
    const s = document.createElement('span'); s.textContent = num(v, decimals, { sign: true }); ticks.append(s);
  }
  const u = document.createElement('span'); u.className = 'unit'; u.textContent = unit;
  const box = document.createElement('div'); box.append(wrap, ticks);
  return box;
}

function renderLegend() {
  const el = $('legend');
  const rows = [];
  const row = (title, body, note) => {
    const d = document.createElement('div'); d.className = 'legend-row';
    const h = document.createElement('p'); h.className = 'legend-title'; h.textContent = title; d.append(h);
    if (body) d.append(body);
    if (note) { const n = document.createElement('p'); n.className = 'legend-note'; n.textContent = note; d.append(n); }
    rows.push(d);
  };
  if (state.view === 'anomaly') row(`${t('legendAnom')}, ${state.year}${state.year > LAST ? ` (${t('projected')})` : ''}`, legendBlocks('temp', state.scale, '°C', 2));
  if (state.view === 'temperature') {
    const img = document.createElement('img'); img.src = './assets/temp_palette.png'; img.alt = ''; img.className = 'ramp';
    const ticks = document.createElement('div'); ticks.className = 'ticks';
    for (const k of [192, 224, 256, 288, 320]) { const s = document.createElement('span'); s.textContent = `${k} K`; ticks.append(s); }
    const box = document.createElement('div'); box.append(img, ticks);
    row(`${t('legendTemp')}, ${state.year}${state.year > LAST ? ` (${t('projected')})` : ''}`, box, `${t('tempNote')} ${t('legendExag', { n: $('exag').value })}`);
  }
  if (state.view === 'satellite') {
    const s = state.sat;
    const when = s?.y ? `${new Intl.DateTimeFormat(getLang(), { month: 'long', year: 'numeric' }).format(new Date(s.y, s.m - 1, 15))}` : '';
    if (!s || s.status === 'none') row(t('legendSat'), null, t('noSat'));
    else if (s.status === 'loading') row(`${t('legendSat')}: ${s.layer}`, null, t('satLoading'));
    else if (s.status === 'fail') row(`${t('legendSat')}: ${s.layer}`, null, t('satFail', { d: when }));
    else {
      const img = document.createElement('img');
      img.src = `https://gibs.earthdata.nasa.gov/legends/${s.layer}_H.svg`; img.alt = ''; img.className = 'gibs-legend';
      img.addEventListener('error', () => img.remove());
      row(`${t('legendSat')}: ${s.layer.replaceAll('_', ' ')}, ${when}`, img);
    }
  }
  if (state.region) {
    const v = variable();
    row(t('legendRegion', { u: unitOf(v) }), legendBlocks(v.palette, state.regionRange, '', Math.max(v.decimals, 2)), t('legendHatch'));
  }
  el.replaceChildren(...rows);
  el.hidden = rows.length === 0;
}

// ------------------------------------------------------------------ report

function currentReport() {
  const sections = [];
  const ctx = seriesContext();
  if (state.scope === 'region' && state.region) {
    sections.push({ heading: `${t('scopeRegion')}: ${ctx.name}`, described: describeRegion(state.region, ctx), ctx, source: { name: SOURCES.power.name, url: state.regionRaw.url } });
  }
  const analysis = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  if (analysis) {
    const src = state.scope === 'planet' ? { name: SOURCES.gistemp.name, url: state.gistempMeta.url } : { name: SOURCES.power.name, url: state.pointRaw.url };
    sections.push({ heading: `${state.scope === 'planet' ? t('scopePlanet') : t('scopePoint')}: ${ctx.name}, ${ctx.whereLabel}`, described: describeSeries(analysis, ctx), analysis, ctx, source: src });
  }
  return buildReport({ sections, projectionYear: Math.max(state.year, 2050), factor: state.factor });
}

init();
