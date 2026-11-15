// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Application state and interface wiring.
import { createGlobe } from './globe.js';
import { VARIABLES, GROUPS, EXAMPLES, PALETTES, TREND_COLORS, paletteFloats, POWER_FIRST_YEAR, GIBS_FIRST_YEAR, HORIZON_MAX, TEMP_BASE_PERIOD, REGION_SIZE, SOURCES, CREDITS } from './config.js';
import { fetchPoint, fetchPointAll, fetchRegion, fetchGistemp, gibsUrls, lastCompleteYear } from './data.js';
import { seriesFromPower, parseGistempZonal, analyzeSeries, analyzeRegion, regionTexture, niceRange, BAND_EDGES, zonalBlend, screenVariables, seasonBreakdown, comparePlaces } from './analysis.js';
import { mean } from './stats.js';
import { EBM, calibrate, project } from './ebm.js';
import { SIM_W, SIM_H } from './shaders.js';
import { latLonToVec3, formatLatLon, boxAround, clamp } from './geo.js';
import { renderChart } from './chart.js';
import { describeSeries, describeRegion, buildReport } from './report.js';
import { t, num, pText, setLang, getLang, applyStatic } from './i18n.js';
import { hydrateTips, infoButton, toast, countUp, arrive } from './ui.js';
import { createTour } from './tour.js';

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
  bandNow: null,              // band anomalies for the year on the timeline
  tempBase: null,             // pixels of the base temperature field: { w, h, px }
  pointRaw: null, pointAnalysis: null, pointError: null,
  allRaw: null,               // every variable at the point: { dicts, fill, key }
  screen: null, seasons: null, // which variables change here, and in which months
  pin: null, pinAnalysis: null, // a second place kept for comparison
  regionRaw: null, region: null, regionRange: 1,
  busy: null,
  sat: null,
  playing: false,
};

// Forcing levels that name the standard scenarios (W/m2 in 2100)
const SCENARIOS = [{ name: 'SSP1-2.6', f: 2.6 }, { name: 'SSP2-4.5', f: 4.5 }, { name: 'SSP3-7.0', f: 7.0 }, { name: 'SSP5-8.5', f: 8.5 }];

const variable = () => VARIABLES.find((v) => v.id === state.variable);
const unitOf = (v) => (getLang() === 'en' && v.unitEn) || v.unit;
let globe, tour;

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
    globe.setImage('uNight', './assets/earth_night.jpg', { repeatX: true }),
    globe.setImage('uNormal', './assets/earth_normal.jpg'),
    globe.setImage('uSpec', './assets/earth_specular.jpg'),
    globe.setImage('uTempBase', './assets/temp_base.png', { mipmaps: false }),
    globe.setImage('uPalette', './assets/temp_palette.png', { mipmaps: false }),
  ]).then((r) => { if (r.some((x) => x.status === 'rejected')) console.warn('Some textures failed to load', r); });

  const shared = readLink();
  buildControls();
  bind();
  tour = createTour(tourSteps());
  $('tourBtn').addEventListener('click', () => tour.start($('tourBtn')));
  renderAll();
  loadPlanet();
  if (shared) selectPoint(shared.lat, shared.lon);
  loadTempBase().then((b) => { state.tempBase = b; renderLegend(); }).catch((e) => console.warn('Base temperature field unavailable; no kelvin read-out', e));
  bindProbe();
  loadOcean().then((o) => { state.ocean = o; if (state.gistemp) recompute(); }).catch((e) => console.warn('Ocean mask unavailable; planet projections fall back to the trend', e));
}

// A link carries the question being asked: variable, place, months and period.
function readLink() {
  const q = new URLSearchParams(location.search);
  const v = q.get('v'), s = q.get('s');
  if (VARIABLES.some((x) => x.id === v)) state.variable = v;
  if (['ANN', 'DJF', 'MAM', 'JJA', 'SON'].includes(s)) state.season = s;
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  const point = isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  const min = point ? POWER_FIRST_YEAR : FIRST_GISTEMP;
  const a = parseInt(q.get('from'), 10), b = parseInt(q.get('to'), 10);
  if (isFinite(a) && isFinite(b)) {
    const from = clamp(a, min, LAST - 8);
    state.period = [from, clamp(b, from + 8, LAST)];
  }
  return point;
}

function linkFor() {
  const q = new URLSearchParams();
  if (getLang() !== 'en') q.set('lang', getLang());
  q.set('v', state.variable);
  if (state.season !== 'ANN') q.set('s', state.season);
  if (state.point) { q.set('lat', state.point.lat); q.set('lon', state.point.lon); }
  q.set('from', state.period[0]); q.set('to', state.period[1]);
  return `${location.origin}${location.pathname}?${q}`;
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
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) { toast(t('locateFail')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => selectPoint(pos.coords.latitude, pos.coords.longitude),
      () => toast(t('locateFail')),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
  $('pin').addEventListener('click', () => {
    if (!state.point || !state.pointRaw) return;
    state.pin = { point: { ...state.point }, dicts: state.allRaw?.dicts || { [state.variable]: state.pointRaw.dict }, fill: state.pointRaw.fill };
    recompute();
    toast(t('pinned', { x: placeLabel(state.pin.point) }));
  });
  $('unpin').addEventListener('click', () => { state.pin = null; recompute(); });
  $('screen').addEventListener('click', (e) => {
    const id = e.target.closest('button[data-var]')?.dataset.var;
    if (!id || id === state.variable) return;
    $('variable').value = id;
    $('variable').dispatchEvent(new Event('change'));
    $('findings').scrollTop = 0;
  });
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
  $('csv').addEventListener('click', () => {
    const blob = new Blob([currentCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `series-${state.scope === 'planet' ? 'planet' : state.variable}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkFor()); toast(t('linkCopied')); }
    catch { toast(t('copyFail')); }
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentReport()); toast(t('copied')); }
    catch { toast(t('copyFail')); }
  });
}

// ------------------------------------------------------------------ guided tour

const TOUR_EXAMPLE = 2; // Sahel rains
const TOUR_OTHER = { lat: -2, lon: 22, name: { es: 'la cuenca del Congo', en: 'the Congo basin' } };

// Each step drives the real interface, so what the tour shows is what the tool computes.
function tourSteps() {
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toPlanet = () => { stopPlay(); if (state.scope !== 'planet') $('goPlanet').click(); };
  const settled = (alive) => new Promise((resolve) => {
    const tick = () => (!alive() ? resolve(false) : !state.busy && (state.pointAnalysis || state.pointError) ? resolve(!!state.pointAnalysis) : setTimeout(tick, 250));
    tick();
  });
  // the worked example over the whole record, whatever was on screen before
  const toExample = async (alive) => {
    stopPlay();
    const full = state.period[0] === POWER_FIRST_YEAR && state.period[1] === LAST;
    if (state.scope !== 'planet' && state.example === TOUR_EXAMPLE && full && !state.pin) return settled(alive);
    state.pin = null;
    state.period = [POWER_FIRST_YEAR, LAST];
    $('from').value = POWER_FIRST_YEAR; $('to').value = LAST;
    $('places').children[TOUR_EXAMPLE].click();
    return settled(alive);
  };
  return [
    { key: 'tour3', focus: 'facts', run: ({ alive }) => toExample(alive) },
    { key: 'tour4', focus: 'screenWrap', run: ({ alive }) => toExample(alive) },
    { key: 'tour5', focus: 'chartWrap', run: async ({ alive }) => {
      if (!(await toExample(alive)) || !alive()) return;
      $('pin').click();
      await selectPoint(TOUR_OTHER.lat, TOUR_OTHER.lon, TOUR_OTHER.name[getLang()]);
    } },
    { key: 'tour1', focus: 'bandsWrap', run: () => { toPlanet(); if (state.gistemp) setView('anomaly'); setYear(LAST); } },
    { key: 'tour2', focus: 'chartWrap', run: () => { toPlanet(); if (calm()) { setYear(HORIZON_MAX); return; } setYear(LAST); startPlay(); } },
    { key: 'tour6', focus: 'actions', run: () => stopPlay() },
  ];
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

// The base field of the Temperature view, kept as pixels so a value can be read at any place
function loadTempBase() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      resolve({ w: c.width, h: c.height, px: ctx.getImageData(0, 0, c.width, c.height).data });
    };
    img.onerror = () => reject(new Error('temperature field failed to load'));
    img.src = './assets/temp_base.png';
  });
}

// What the data views show at one place, as numbers. The same arithmetic as the shader,
// without the visual exaggeration: the NASA POWER climatology (0..1 = 192..320 K) plus the
// change of the latitude band since the years of that climatology.
function estimateAt(lat, lon) {
  if (!state.bandNow || !state.bandsRef) return null;
  const anomaly = zonalBlend(lat, state.bandNow);
  let kelvin = null;
  const b = state.tempBase;
  if (b) {
    const x = clamp(Math.floor(((lon + 180) / 360) * b.w), 0, b.w - 1);
    const y = clamp(Math.floor(((90 - lat) / 180) * b.h), 0, b.h - 1);
    kelvin = 192 + (b.px[(y * b.w + x) * 4] / 255) * 128 + (anomaly - zonalBlend(lat, state.bandsRef));
  }
  return { anomaly, kelvin };
}

// The estimate in words for the current view, or null when the view has no value to read
function estimateText(lat, lon) {
  if (state.view !== 'temperature' && state.view !== 'anomaly') return null;
  const e = estimateAt(lat, lon);
  if (!e) return null;
  if (state.view === 'anomaly') return t('probeAnom', { x: num(e.anomaly, 2, { sign: true }) });
  return e.kelvin == null ? null : t('probeTemp', { k: num(e.kelvin, 0), c: num(e.kelvin - 273.15, 0) });
}

// A label that follows the mouse over the globe. Nothing is requested: the value is computed here.
function bindProbe() {
  const canvas = $('globe'), probe = $('probe');
  let pending = null, queued = false;
  const hide = () => { pending = null; probe.hidden = true; };
  const show = () => {
    queued = false;
    if (!pending) return;
    const { x, y } = pending;
    const ll = globe.pick(x, y);
    const text = ll && estimateText(ll.lat, ll.lon);
    if (!text) { probe.hidden = true; return; }
    probe.textContent = `${formatLatLon(ll.lat, ll.lon, getLang())} · ${text}`;
    probe.hidden = false;
    const w = probe.offsetWidth, h = probe.offsetHeight;
    probe.style.left = `${clamp(x + 14, 8, innerWidth - w - 8)}px`;
    probe.style.top = `${y + 18 + h > innerHeight - 8 ? y - h - 12 : y + 18}px`;
  };
  canvas.addEventListener('pointermove', (e) => {
    // a finger has no hover, and a pressed button means the globe is being turned
    if (e.pointerType !== 'mouse' || e.buttons) { hide(); return; }
    pending = { x: e.clientX, y: e.clientY };
    if (!queued) { queued = true; requestAnimationFrame(show); }
  });
  canvas.addEventListener('pointerleave', hide);
  canvas.addEventListener('pointerdown', hide);
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
  const use = (g) => { state.gistemp = parseGistempZonal(g.csv); state.gistempMeta = g; state.gistempError = null; };
  try {
    // a newer table from NASA replaces the saved copy when it arrives
    use(await fetchGistemp((fresh) => { use(fresh); recompute(); }));
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
  const key = `${state.point.lat},${state.point.lon}`;
  state.pointRaw = null; state.pointAnalysis = null; state.pointError = null;
  state.screen = null; state.seasons = null;
  if (state.allRaw?.key !== key) state.allRaw = null;
  // the other variables of this place are already here: no request needed
  if (state.allRaw?.dicts[state.variable]) {
    state.pointRaw = { ...state.allRaw, dict: state.allRaw.dicts[state.variable] };
    state.busy = null;
    recompute();
    return;
  }
  state.busy = 'loadingPower';
  renderAll();
  const where = { lat: state.point.lat, lon: state.point.lon, start: POWER_FIRST_YEAR };
  try {
    let raw;
    try {
      // one request brings every variable, which is what lets the tool say which ones are changing here
      const all = await fetchPointAll({ ...where, parameters: VARIABLES.map((v) => v.id) });
      if (token !== pointToken) return;
      if (!all.dicts[state.variable]) throw new Error('missing variable');
      state.allRaw = { ...all, key };
      raw = { ...all, dict: all.dicts[state.variable] };
    } catch (e) {
      if (token !== pointToken) return;
      raw = await fetchPoint({ ...where, parameter: state.variable });
      if (token !== pointToken) return;
    }
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
    if (state.region) globe.flyTo((box.latMin + box.latMax) / 2, (box.lonMin + box.lonMax) / 2, 1.5);
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
    // the base field of the Temperature view is the mean of these years, so changes are counted from them
    const inBase = g.years.map((y) => y >= TEMP_BASE_PERIOD[0] && y <= TEMP_BASE_PERIOD[1]);
    state.bandsRef = g.bands.map((b) => mean(b.filter((_, i) => inBase[i])));
  }
  if (state.pointRaw) {
    const s = seriesFromPower(state.pointRaw.dict, state.season, state.pointRaw.fill);
    const period = [Math.max(state.period[0], POWER_FIRST_YEAR), state.period[1]];
    const opts = { period, baseline: [1991, 2020], alpha: state.alpha, fill: state.pointRaw.fill };
    state.pointAnalysis = s.years.length ? analyzeSeries(s.years, s.values, opts) : null;
    state.pointError = state.pointAnalysis ? null : t(s.years.length ? 'errShort' : 'errOcean');
    state.seasons = seasonBreakdown(state.pointRaw.dict, opts);
    state.screen = state.allRaw ? screenVariables(state.allRaw.dicts, VARIABLES.map((v) => v.id), { ...opts, season: state.season }) : null;
  }
  state.pinAnalysis = null;
  if (state.pin?.dicts[state.variable]) {
    const s = seriesFromPower(state.pin.dicts[state.variable], state.season, state.pin.fill);
    const period = [Math.max(state.period[0], POWER_FIRST_YEAR), state.period[1]];
    state.pinAnalysis = s.years.length ? analyzeSeries(s.years, s.values, { period, baseline: [1991, 2020], alpha: state.alpha }) : null;
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
  state.bandNow = vals;
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
  // a change of variable or example clears state.sat while an image is still on its way
  const sat = state.sat = { key, status: 'loading', layer: v.gibs, y, m };
  const current = () => token === satToken && state.sat === sat;
  renderLegend();
  for (const url of gibsUrls(v.gibs, y, m)) {
    try {
      await globe.setImage('uSat', url, { mipmaps: false, accept: current });
      if (!current()) return;
      sat.status = 'ok';
      globe.set('uSatOn', 1);
      renderLegend();
      return;
    } catch { /* try the proxy next */ }
  }
  if (current()) { sat.status = 'fail'; globe.set('uSatOn', 0); renderLegend(); }
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
  $('pin').disabled = !(state.scope !== 'planet' && state.pointAnalysis);
  $('pinRow').hidden = !state.pin;
  if (state.pin) $('pinNote').textContent = t(state.pin.dicts[state.variable] ? 'pinNote' : 'pinNoVar', { x: placeLabel(state.pin.point) });
  history.replaceState(null, '', linkFor());
  $('goPlanet').hidden = state.scope === 'planet';
  $('exagOut').textContent = '×' + $('exag').value;
  $('places').querySelectorAll('.chip').forEach((b, i) => b.setAttribute('aria-pressed', i === state.example));
  if (!$('coordError').hidden) $('coordError').textContent = t('errCoords');
  hydrateTips();
  tour?.render();
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

function placeLabel(p) {
  return p.name || formatLatLon(p.lat, p.lon, getLang());
}

// The pinned place next to the current one, when they are different places with the same variable
function comparison() {
  const a = state.pointAnalysis, b = state.pinAnalysis, p = state.pin?.point;
  if (state.scope === 'planet' || !a || !b || !p || (p.lat === state.point.lat && p.lon === state.point.lon)) return null;
  const v = variable();
  const f = (x) => `${num(x, v.decimals, { sign: true })}\u00a0${unitOf(v)}`;
  const c = comparePlaces(a, b);
  const text = `${t('cmpLine', { x: placeLabel(p), a: f(c.perDecadeB), s: t(b.significant ? 'sigYes' : 'sigNo'), b: f(c.perDecadeA) })} ${t(c.opposite ? 'cmpOpp' : c.differ ? 'cmpDiffYes' : 'cmpDiffNo', { p: pText(c.pDiff) })}`;
  return { ...c, text, name: placeLabel(p), analysis: b };
}

function seriesContext() {
  if (state.scope === 'planet') {
    const w = wherePhrase();
    return { name: t('tempAnom'), unit: '°C', decimals: 2, wherePhrase: w.phrase, whereLabel: w.label, seasonLabel: null, palette: 'temp' };
  }
  const v = variable(), w = wherePhrase();
  return {
    name: v.name[getLang()], unit: unitOf(v), decimals: v.decimals, wherePhrase: w.phrase, whereLabel: w.label,
    seasonLabel: state.season === 'ANN' ? null : t('s_' + state.season), palette: v.palette, relative: !!v.relative,
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
  const cmp = regionReady ? null : comparison();
  const verdict2 = d.verdict2 + (regionReady && state.regionRaw.sampled ? ` ${t('sampledNote', { n: state.regionRaw.features.length })}` : '')
    + (cmp?.opposite ? ` ${t('vCmpOpp', { x: cmp.name })}` : '');
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
  const facts = [...d.facts];
  if (next && !regionReady) facts.push([t('qNext'), next]);
  if (cmp) facts.push([t('qCompare'), cmp.text]);
  fillDl($('facts'), facts, { [t('qSig')]: ['tipSig', 'qSig'] });

  $('chartWrap').hidden = !analysis;
  $('detailsWrap').hidden = !analysis;
  if (analysis) {
    $('chartTitle').textContent = `${ctx.name}, ${ctx.whereLabel}. ${t('chartAnom', { a: analysis.baselineUsed[0], b: analysis.baselineUsed[1] })} (${ctx.unit})`;
    renderChartOnly();
    const key = [['obs', t('chartObs')], ['trend', t('chartTrend')], ['proj', modelProjection(analysis) ? t('chartModel', { e: num(state.ecs, 1) }) : t('chartProj')]];
    if (analysis.unusual.length) key.push(['unusual', t('chartUnusual')]);
    if (comparison()) key.push(['cmp', comparison().name]);
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
  const here = state.scope !== 'planet' && !!analysis;
  $('seasonsWrap').hidden = !(here && state.seasons?.some(Boolean));
  if (!$('seasonsWrap').hidden) renderSeasons();
  $('screenWrap').hidden = !(here && state.screen?.length > 1);
  if (!$('screenWrap').hidden) renderScreen();

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
    compare: comparison()?.analysis || null,
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

// A row of the small trend tables: label, bar, value and significance in words
function trendRow(head, { share, color, significant, value }) {
  const tr = document.createElement('tr');
  const th = document.createElement('th'); th.scope = 'row'; th.append(head);
  const bar = document.createElement('td'); bar.className = 'bar-cell';
  const i = document.createElement('i');
  i.style.width = share * 100 + '%';
  i.style.background = color;
  if (!significant) i.className = 'ns';
  bar.append(i);
  const val = document.createElement('td'); val.className = 'n'; val.textContent = value;
  const sig = document.createElement('td'); sig.className = 'sig'; sig.textContent = significant ? t('sigYes') : t('sigNo');
  tr.append(th, bar, val, sig);
  return tr;
}

// When in the year the selected variable changes
function renderSeasons() {
  const v = variable();
  const rows = state.seasons.filter(Boolean);
  const max = Math.max(...rows.map((r) => Math.abs(r.perDecade))) || 1;
  $('seasons').replaceChildren(...rows.map((r) => trendRow(t('sh_' + r.season), {
    share: Math.abs(r.perDecade) / max, color: TREND_COLORS[v.palette][r.perDecade > 0 ? 'up' : 'down'], significant: r.significant,
    value: `${num(r.perDecade, v.decimals, { sign: true })}\u00a0${unitOf(v)}`,
  })));
}

// Every variable at this place, strongest change first; a row switches to that variable
function renderScreen() {
  const max = Math.max(...state.screen.map((r) => r.snr)) || 1;
  $('screen').replaceChildren(...state.screen.map((r) => {
    const v = VARIABLES.find((x) => x.id === r.id);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'quiet'; b.dataset.var = r.id; b.textContent = v.name[getLang()];
    if (r.id === state.variable) b.setAttribute('aria-current', 'true');
    return trendRow(b, {
      share: r.snr / max, color: TREND_COLORS[v.palette][r.perDecade > 0 ? 'up' : 'down'], significant: r.significant,
      value: `${num(r.perDecade, v.decimals, { sign: true })}\u00a0${unitOf(v)}`,
    });
  }));
  const k = state.screen.filter((r) => r.significant).length;
  $('screenNote').textContent = `${t('screenNote', { k, n: state.screen.length, s: getLang() === 'es' ? t('s_' + state.season).toLowerCase() : t('s_' + state.season) })} ${t('regionFdr', { k: state.screen.filter((r) => r.fdr).length })}`;
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
    // with a region on the globe the legend stays short, so it does not cover the box
    row(`${t('legendTemp')}, ${state.year}${how}`, box, state.region ? null : `${t('tempNote')} ${t('legendExag', { n: $('exag').value })}`);
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
  if (state.point && !state.region) {
    const text = estimateText(state.point.lat, state.point.lon);
    // the map is a coarse climatology; where NASA POWER has the series of this point, give its mean over the same years first
    const ts = state.view === 'temperature' && state.allRaw?.key === `${state.point.lat},${state.point.lon}` && state.allRaw.dicts.TS;
    let measured = '';
    if (ts) {
      const s = seriesFromPower(ts, 'ANN', state.allRaw.fill);
      const ref = s.values.filter((_, i) => s.years[i] >= TEMP_BASE_PERIOD[0] && s.years[i] <= TEMP_BASE_PERIOD[1]);
      if (ref.length >= 10) measured = `${t('probePower', { k: num(mean(ref) + 273.15, 0), c: num(mean(ref), 0), a: TEMP_BASE_PERIOD[0], b: TEMP_BASE_PERIOD[1] })} `;
    }
    if (text) row(`${t('legendPoint', { x: placeLabel(state.point) })}: ${measured}${measured ? t('probeMap', { x: text }) : text}`);
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
    const described = describeSeries(analysis, ctx);
    const cmp = comparison();
    if (cmp) described.facts.push([t('qCompare'), cmp.text]);
    const extra = [];
    if (state.scope !== 'planet') {
      const v = variable();
      const f = (r, x) => `${num(r.perDecade, x.decimals, { sign: true })} ${unitOf(x)}`;
      const sig = (r) => t(r.significant ? 'sigYes' : 'sigNo');
      if (state.seasons?.some(Boolean)) {
        extra.push(`### ${t('seasonsTitle')}`, '', ...state.seasons.filter(Boolean).map((r) => `- ${t('s_' + r.season)}: ${f(r, v)} ${t('perDecade')}, ${sig(r)} (p ${pText(r.p)})`), '');
      }
      if (state.screen?.length > 1) {
        extra.push(`### ${t('screenTitle')}`, '', ...state.screen.map((r) => { const x = VARIABLES.find((q) => q.id === r.id); return `- ${x.name[getLang()]}: ${f(r, x)} ${t('perDecade')}, ${sig(r)} (p ${pText(r.p)})`; }), '');
      }
    }
    sections.push({ heading: `${state.scope === 'planet' ? t('scopePlanet') : t('scopePoint')}: ${ctx.name}, ${ctx.whereLabel}`, described, analysis, ctx, source: src, projectionText: outlook && `**${t('qNext')}:** ${outlook}`, extra });
  }
  return buildReport({ sections, projectionYear: Math.max(state.year, 2050), factor: state.factor, link: linkFor() });
}

// The annual series behind the chart, so the result can be checked elsewhere
function currentCsv() {
  const a = state.scope === 'planet' ? state.planet : state.pointAnalysis;
  if (!a) return '';
  const ctx = seriesContext();
  const src = state.scope === 'planet' ? state.gistempMeta.url : state.pointRaw.url;
  const lines = [`# ${ctx.name}, ${ctx.whereLabel}${ctx.seasonLabel ? `, ${ctx.seasonLabel}` : ''}`, `# ${t('source')}: ${src}`, `year,value_${ctx.unit},anomaly,trend,in_fitted_period`];
  a.years.forEach((y, i) => {
    const inFit = y >= a.period[0] && y <= a.period[1];
    lines.push([y, a.values[i], a.anomalies[i].toFixed(4), inFit ? a.fit.predict(y).toFixed(4) : '', inFit ? 1 : 0].join(','));
  });
  return lines.join('\n') + '\n';
}

init();
