// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Application state and interface wiring.
import { createGlobe } from './globe.js';
import { VARIABLES, GROUPS, EXAMPLES, PALETTES, TREND_COLORS, paletteFloats, POWER_FIRST_YEAR, GIBS_FIRST_YEAR, HORIZON_MAX, REGION_SIZE, SOURCES, CREDITS } from './config.js';
import { fetchPoint, fetchRegion, fetchGistemp, gibsUrls, lastCompleteYear } from './data.js';
import { seriesFromPower, parseGistempZonal, analyzeSeries, analyzeRegion, regionTexture, niceRange, BAND_EDGES } from './analysis.js';
import { mean } from './stats.js';
import { EBM, calibrate, project } from './ebm.js';
import { SIM_W, SIM_H } from './shaders.js';
import { latLonToVec3, formatLatLon, boxAround, clamp } from './geo.js';
import { renderChart } from './chart.js';
import { describeSeries, describeRegion, buildReport } from './report.js';
import { t, num, setLang, getLang, applyStatic } from './i18n.js';
import { hydrateTips, infoButton, toast, countUp, arrive } from './ui.js';

const $ = (id) => document.getElementById(id);
const LAST = lastCompleteYear();
const FIRST_GISTEMP = 1880;

const state = {
  scope: 'planet',            // planet | point | region
  variable: 'T2M',
  view: 'natural',            // natural | anomaly | temperature | satellite
  point: null,                // { lat, lon, name }
  example: null,              // index of the worked example that is loaded, if any
  period: [POWER_FIRST_YEAR, LAST],
  season: 'ANN',
  alpha: 0.05,
  factor: 1,                  // what-if multiplier on the rate of change (points and regions)
  scenario: 4.5,              // W/m2 reached in 2100 (planet model)
  ecs: EBM.ECS_BEST,          // equilibrium climate sensitivity, K (planet model)
  ocean: null,                // ocean fraction grids for the model
  model: null,                // calibrated energy balance model and its projection
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

// Forcing levels that name the standard scenarios (W/m2 in 2100)
const SCENARIOS = [{ name: 'SSP1-2.6', f: 2.6 }, { name: 'SSP2-4.5', f: 4.5 }, { name: 'SSP3-7.0', f: 7.0 }, { name: 'SSP5-8.5', f: 8.5 }];

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
  loadOcean().then((o) => { state.ocean = o; if (state.gistemp) recompute(); }).catch((e) => console.warn('Ocean mask unavailable; planet projections fall back to the trend', e));
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
  places.replaceChildren(...EXAMPLES.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p.label[getLang()];
    b.addEventListener('click', () => {
      state.variable = p.variable; state.season = p.season; state.sat = null;
      $('variable').value = p.variable; $('season').value = p.season;
      globe.set('uDivR', paletteFloats(variable().palette));
      selectPoint(p.lat, p.lon, p.place[getLang()], i);
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
  $('scenario').replaceChildren(...SCENARIOS.map((s) => new Option(t('scenarioOpt', { n: s.name, f: num(s.f, 1) }), s.f, false, s.f === state.scenario)));
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
    state.example = null;
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
    const badLat = !isFinite(lat) || Math.abs(lat) > 90, badLon = !isFinite(lon) || Math.abs(lon) > 180;
    coordError(badLat, badLon);
    if (badLat || badLon) { $(badLat ? 'lat' : 'lon').focus(); return; }
    selectPoint(lat, lon);
  });
  for (const id of ['lat', 'lon']) {
    $(id).addEventListener('input', () => coordError(false, false));
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('goPoint').click(); });
  }
  $('retry').addEventListener('click', () => retryAction?.());
  $('goRegion').addEventListener('click', loadRegion);
  $('goPlanet').addEventListener('click', () => {
    state.scope = 'planet';
    state.point = null;
    state.example = null;
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
  $('season').addEventListener('change', (e) => { state.season = e.target.value; state.example = null; recompute(); });
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

  $('rate').addEventListener('input', (e) => { state.factor = parseFloat(e.target.value); renderChartOnly(); });
  const onModel = () => {
    clearTimeout(onModel.timer);
    onModel.timer = setTimeout(() => { recomputeModel(); applyBands(); renderAll(); }, 120);
  };
  $('scenario').addEventListener('change', (e) => { state.scenario = parseFloat(e.target.value); onModel(); });
  $('ecs').addEventListener('input', (e) => { state.ecs = parseFloat(e.target.value); $('ecsOut').textContent = `${num(state.ecs, 1)} °C`; onModel(); });
  $('grid').addEventListener('change', (e) => globe.set('uGrid', e.target.checked ? 1 : 0));

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
    try { await navigator.clipboard.writeText(currentReport()); toast(t('copied')); }
    catch { toast(t('copyFail')); }
  });
}

// ------------------------------------------------------------------ data

// Ocean fraction per model cell, averaged from the ocean mask texture (white = water).
function loadOcean() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const SW = 512, SH = 256;
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, SW, SH);
      const px = ctx.getImageData(0, 0, SW, SH).data;
      const grid = (W, H) => {
        const bx = SW / W, by = SH / H, out = new Float64Array(W * H);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          let s = 0;
          for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) s += px[((j * by + y) * SW + i * bx + x) * 4];
          out[(H - 1 - j) * W + i] = s / (bx * by * 255); // image rows run north to south, model rows south to north
        }
        return out;
      };
      const gpu = grid(SIM_W, SIM_H);
      const gpuBytes = new Uint8Array(SIM_W * SIM_H * 4);
      // the GPU reads the mask as bytes, so the CPU copy is quantised the same way
      gpu.forEach((v, k) => { gpuBytes[k * 4] = Math.round(v * 255); gpuBytes[k * 4 + 3] = 255; gpu[k] = gpuBytes[k * 4] / 255; });
      resolve({ cpu: grid(32, 16), gpu, gpuBytes });
    };
    img.onerror = () => reject(new Error('ocean mask failed to load'));
    img.src = './assets/earth_specular.jpg';
  });
}

// Calibrate the energy balance model on the observed record and project it.
function recomputeModel() {
  const g = state.gistemp;
  if (!g || !state.ocean || state.bands.length !== 8 || !state.bands.every(Boolean)) { state.model = null; return; }
  // nothing the model depends on has changed: keep the current run
  const key = [state.period, state.scenario, state.ecs, g.years.length].join('|');
  if (state.model && state.model.key === key) return;
  state.model = null;
  try {
    const last = g.years.at(-1);
    const obs = {
      years: g.years, bands: g.bands,
      present: state.bands.map((b) => b.fit.predict(last) + b.base),
      rate: state.bands.map((b) => b.fit.slope),
    };
    const run = (ecs) => {
      const cal = calibrate({ obs, ocean: state.ocean.cpu, W: 32, H: 16, ecs });
      return { cal, proj: cal.ok ? project(cal, state.ocean.cpu, state.scenario) : null };
    };
    const mid = run(state.ecs);
    if (!mid.proj || !mid.proj.global.every(Number.isFinite)) return;
    const lo = run(EBM.ECS_LIKELY[0]), hi = run(EBM.ECS_LIKELY[1]);
    state.model = { key, cal: mid.cal, proj: mid.proj, lo: lo.proj, hi: hi.proj, gpu: false };
    if (globe.sim.supported) {
      const cal = calibrate({ obs, ocean: state.ocean.gpu, W: SIM_W, H: SIM_H, ecs: state.ecs });
      if (cal.ok) {
        globe.sim.configure({
          t0: cal.t0, F0: cal.F0, f2100: state.scenario, dt: cal.dt,
          lam: Float32Array.from(cal.lam), T0: Float32Array.from(cal.T0), Td0: Float32Array.from(cal.Td0), pi: Float32Array.from(cal.piRows),
          oceanBytes: state.ocean.gpuBytes,
        });
        state.model.gpu = true;
      }
    }
  } catch (e) {
    console.warn('Energy balance model failed; planet projections fall back to the trend', e);
    state.model = null;
  }
}

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

function selectPoint(lat, lon, name, example = null) {
  state.point = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, name: name || null };
  state.example = example;
  state.scope = 'point';
  coordError(false, false);
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
      onProgress: (a, b) => { if (token === regionToken) showStatus(t('sampling', { a, b }), { busy: true, progress: a / b }); },
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
    showStatus(t('errPower', { m: e.message || e }), { retry: loadRegion });
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
  recomputeModel();
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
    else if (state.model) vals[k] = state.model.proj.bands[clamp(state.year - state.model.cal.t0, 0, state.model.proj.bands.length - 1)][k];
    else vals[k] = state.bands[k] ? state.bands[k].project(state.year, 1).value + state.bands[k].base : g.bands[k].at(-1);
  }
  // after the last observed year the globe shows the model's 2D field when the GPU solver runs
  const modelled = !!state.model && state.model.gpu && state.year > last;
  if (modelled) globe.sim.setTarget(state.year);
  globe.set('uSimOn', modelled ? 1 : 0);
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
  const planet = state.scope === 'planet';
  $('modelControls').hidden = !planet;
  $('trendControls').hidden = planet;
  $('ecsOut').textContent = `${num(state.ecs, 1)} °C`;
  $('projNote').textContent = !planet ? t('projNote', { y: LAST })
    : state.model ? `${t('modelNote', { y: state.model.cal.t0, f: num(state.model.cal.F0, 2), n: num(state.model.cal.N0, 2) })}${state.model.gpu ? '' : ` ${t('modelCpu')}`}`
      : t('projNote', { y: LAST });
  $('goRegion').disabled = !state.point;
  $('goPlanet').hidden = state.scope === 'planet';
  $('exagOut').textContent = '×' + $('exag').value;
  $('places').querySelectorAll('.chip').forEach((b, i) => b.setAttribute('aria-pressed', i === state.example));
  if (!$('coordError').hidden) $('coordError').textContent = t('errCoords');
  hydrateTips();
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
  // the natural view has no options of its own
  $('viewSection').hidden = state.view === 'natural' && !state.region;
  $('viewHint').textContent = t('vh_' + state.view);
  $('scaleRow').hidden = state.view !== 'anomaly';
  $('monthRow').hidden = state.view !== 'satellite';
  $('exagRow').hidden = state.view !== 'temperature';
  $('opacityRow').hidden = state.view === 'natural';
  $('steppedRow').hidden = state.view !== 'anomaly' && !state.region;
  $('gridRow').hidden = state.view === 'natural';
}

function renderYear() {
  $('yearOut').textContent = state.year;
  $('yearKind').textContent = t(state.year > LAST ? 'projected' : 'observed');
  $('play').classList.toggle('playing', state.playing);
  $('play').title = t(state.playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', $('play').title);
}

// One status line for waiting and for failures. `busy` shows a progress bar
// (determinate when `progress` is a 0-1 fraction); `retry` offers the action again.
let retryAction = null;
function showStatus(msg, { busy = false, progress = null, retry = null } = {}) {
  $('statusText').textContent = msg;
  $('status').hidden = !msg;
  $('progress').hidden = !busy;
  $('progress').classList.toggle('determinate', progress != null);
  $('progress').style.setProperty('--p', progress ?? 0);
  retryAction = retry;
  $('retry').hidden = !retry;
  $('findings').setAttribute('aria-busy', String(busy));
}

function coordError(badLat, badLon) {
  $('lat').setAttribute('aria-invalid', String(badLat));
  $('lon').setAttribute('aria-invalid', String(badLon));
  $('coordError').hidden = !(badLat || badLon);
  $('coordError').textContent = badLat || badLon ? t('errCoords') : '';
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

// `tips` maps a row label to the [explanation key, label key] of its info button
function fillDl(dl, rows, tips = {}) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v;
    if (tips[k]) { dt.className = 'with-info'; dt.append(infoButton(...tips[k])); }
    return [dt, dd];
  }));
  hydrateTips(dl);
}

let shownVerdict = null;

function renderFindings() {
  const scopeText = { planet: t('scopePlanet'), point: t('scopePoint'), region: t('scopeRegion') }[state.scope];
  $('scope').textContent = state.scope === 'planet' ? scopeText : `${scopeText}: ${wherePhrase().label}`;

  const analysis = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  const error = state.scope === 'planet' ? (state.gistempError && t('errGistemp', { m: state.gistempError })) : state.pointError;
  const regionReady = state.scope === 'region' && state.region;

  // a failed request can be repeated; too few years or no data at the point cannot
  const retry = state.scope === 'planet' ? (!state.gistemp && loadPlanet) : (!state.pointRaw && loadPoint);
  if (state.busy) { showStatus(t(state.busy), { busy: true }); }
  else if (error && !regionReady) { showStatus(error, { retry: retry || null }); }
  else showStatus('');
  $('result').hidden = !(analysis || regionReady) || (!!state.busy && !analysis);
  $('skeleton').hidden = !(state.busy && $('result').hidden);
  if ($('result').hidden) { shownVerdict = null; return; }

  const ctx = seriesContext();
  const d = regionReady ? describeRegion(state.region, ctx) : describeSeries(analysis, ctx);
  const verdict2 = d.verdict2 + (regionReady && state.regionRaw.sampled ? ` ${t('sampledNote', { n: state.regionRaw.features.length })}` : '');
  if (d.verdict !== shownVerdict) {
    // a new answer: count its figure up, let the panel settle in, and tell screen readers once
    shownVerdict = d.verdict;
    countUp($('verdict'), d.verdict, d.verdictNumber);
    arrive($('result'));
    $('announce').textContent = `${d.verdict} ${verdict2}`;
  }
  $('verdict2').textContent = verdict2;
  $('verdict2').hidden = !verdict2;
  const next = modelOutlook();
  fillDl($('facts'), next && !regionReady ? [...d.facts, [t('qNext'), next]] : d.facts, { [t('qSig')]: ['tipSig', 'qSig'] });

  $('chartWrap').hidden = !analysis;
  $('detailsWrap').hidden = !analysis;
  if (analysis) {
    $('chartTitle').textContent = `${ctx.name}, ${ctx.whereLabel}. ${t('chartAnom', { a: analysis.baselineUsed[0], b: analysis.baselineUsed[1] })} (${ctx.unit})`;
    renderChartOnly();
    const key = [['obs', t('chartObs')], ['trend', t('chartTrend')], ['proj', modelProjection(analysis) ? t('chartModel', { e: num(state.ecs, 1) }) : t('chartProj')]];
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

// The model's global-mean curve in the chart's units, with the band for the likely sensitivity range
function modelProjection(analysis) {
  if (state.scope !== 'planet' || !state.model) return null;
  const m = state.model, rel = (arr) => arr.map((v) => v - analysis.base);
  const a = rel(m.lo.global), b = rel(m.hi.global);
  return { years: m.proj.years, value: rel(m.proj.global), lo: a.map((v, i) => Math.min(v, b[i])), hi: a.map((v, i) => Math.max(v, b[i])) };
}

// One sentence on where the planet is heading under the chosen forcing
function modelOutlook() {
  if (state.scope !== 'planet' || !state.model) return null;
  const m = state.model, r = [m.lo.warmingSincePI, m.hi.warmingSincePI].sort((x, y) => x - y);
  return t('nextLine', { v: num(m.proj.warmingSincePI, 1, { sign: true }), a: num(r[0], 1, { sign: true }), b: num(r[1], 1, { sign: true }), f: num(state.scenario, 1) });
}

function renderChartOnly() {
  const analysis = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  if (!analysis || $('result').hidden) return;
  const ctx = seriesContext();
  renderChart($('chart'), {
    analysis, unit: ctx.unit, decimals: ctx.decimals, color: trendColor(analysis, ctx.palette), factor: state.factor,
    endYear: Math.max(2050, state.year), cursorYear: state.year, modelProj: modelProjection(analysis),
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
  const how = state.year <= LAST ? '' : state.model ? ` (${t('legendModel', { f: num(state.scenario, 1), e: num(state.ecs, 1) })})` : ` (${t('projected')})`;
  if (state.view === 'anomaly') row(`${t('legendAnom')}, ${state.year}${how}`, legendBlocks('temp', state.scale, '°C', 2));
  if (state.view === 'temperature') {
    const img = document.createElement('img'); img.src = './assets/temp_palette.png'; img.alt = ''; img.className = 'ramp';
    const ticks = document.createElement('div'); ticks.className = 'ticks';
    for (const k of [192, 224, 256, 288, 320]) { const s = document.createElement('span'); s.textContent = `${k} K`; ticks.append(s); }
    const box = document.createElement('div'); box.append(img, ticks);
    row(`${t('legendTemp')}, ${state.year}${how}`, box, `${t('tempNote')} ${t('legendExag', { n: $('exag').value })}`);
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
    const outlook = modelOutlook();
    sections.push({ heading: `${state.scope === 'planet' ? t('scopePlanet') : t('scopePoint')}: ${ctx.name}, ${ctx.whereLabel}`, described: describeSeries(analysis, ctx), analysis, ctx, source: src, projectionText: outlook && `**${t('qNext')}:** ${outlook}` });
  }
  return buildReport({ sections, projectionYear: Math.max(state.year, 2050), factor: state.factor });
}

init();
