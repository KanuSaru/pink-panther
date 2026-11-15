// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Run: node tests/ebm.test.mjs
// Checks the energy balance model against cases with known answers.
// The "observations" here are synthetic, shaped like the GISTEMP zonal record.
import assert from 'node:assert/strict';
import { EBM, makeGrid, fitBands, bandsToRows, rowsToBands, equilibriumMean, stableDt, calibrate, project, Model, forcingAt, recentState } from '../src/ebm.js';
import { ols } from '../src/stats.js';
import { parseGistempZonal } from '../src/analysis.js';
import { readFileSync } from 'node:fs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

function synthetic() {
  let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const amp = [0.55, 0.35, 0.75, 0.9, 0.95, 1.15, 1.6, 2.9];
  const years = [], bands = amp.map(() => []);
  for (let y = 1880; y <= 2025; y++) {
    years.push(y);
    const shape = y < 1975 ? -0.25 + (0.25 * (y - 1880)) / 95 : ((y - 1975) / 45) ** 1.15;
    amp.forEach((a, k) => bands[k].push(shape * a + 0.12 * rnd() * (1 + a / 2)));
  }
  const i0 = years.indexOf(1981);
  const fits = bands.map((b) => ols(years.slice(i0), b.slice(i0)));
  return { years, bands, present: fits.map((f) => f.predict(2025)), rate: fits.map((f) => f.slope) };
}
function oceanGrid(W, H) {
  const o = new Float64Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const lat = -90 + ((j + 0.5) * 180) / H, lon = -180 + ((i + 0.5) * 360) / W;
    const land = (lat > -60 && Math.sin(((lon + 20) * Math.PI) / 90) + Math.sin((lat * Math.PI) / 70) * 0.9 > 0.75) || lat < -72;
    o[j * W + i] = land ? 0 : 1;
  }
  return o;
}
const flat = (g, { lam, T0 = 0, Td0 = 0 }) => ({ g, lam: new Float64Array(g.H).fill(lam), T0: new Float64Array(g.H).fill(T0), Td0: new Float64Array(g.H).fill(Td0), piRows: new Float64Array(g.H), t0: 2025, F0: 0, dt: stableDt(g, Math.abs(lam)) });

test('area weights sum to one; band and row conversions are consistent', () => {
  const g = makeGrid(64, 32);
  near(g.w.reduce((s, v) => s + v, 0), 1, 1e-12);
  const rows = bandsToRows([2, 2, 2, 2, 2, 2, 2, 2], g);
  rows.forEach((v) => near(v, 2, 1e-9));
  rowsToBands(rows, g).forEach((v) => near(v, 2, 1e-9));
});

test('Legendre fit recovers a smooth profile from its band means', () => {
  // T = 1 + 0.5 P1 + 0.8 P2 (x = sin lat); exact band means over x
  const edges = [-90, -64, -44, -24, 0, 24, 44, 64, 90].map((d) => Math.sin((d * Math.PI) / 180));
  const F = (x) => x + 0.25 * x * x + 0.8 * 0.5 * (x ** 3 - x); // antiderivative
  const means = edges.slice(0, 8).map((a, k) => (F(edges[k + 1]) - F(a)) / (edges[k + 1] - a));
  const c = fitBands(means);
  near(c[0], 1, 1e-4); near(c[1], 0.5, 1e-4); near(c[2], 0.8, 1e-4); near(c[3], 0, 1e-4); // band means are integrated numerically
});

test('a land-only planet relaxes exponentially: T = F/lambda (1 - exp(-lambda t / C))', () => {
  const g = makeGrid(32, 16), lam = 1.3, F = 3.93;
  const m = new Model(flat(g, { lam }), new Float64Array(32 * 16)); // ocean fraction 0 everywhere
  const exact = (t) => (F / lam) * (1 - Math.exp((-lam * t) / EBM.C_LAND));
  // explicit Euler is first-order accurate: the error shrinks with the step
  const dt = m.cal.dt, steps = Math.round(3 / dt);
  m.step(steps, dt, F);
  const coarse = Math.abs(m.mean() - exact(steps * dt));
  m.reset(); m.step(steps * 10, dt / 10, F);
  const fine = Math.abs(m.mean() - exact(steps * dt));
  assert.ok(coarse < 5e-3 && fine < coarse / 5, `errors ${coarse}, ${fine}`);
});

test('an ocean planet reaches F/lambda once the deep ocean has caught up', () => {
  const g = makeGrid(16, 8), lam = 1.31;
  const m = new Model(flat(g, { lam }), new Float64Array(16 * 8).fill(1));
  m.step(Math.round(4000 / 0.02), 0.02, EBM.F2X);
  near(m.mean(), EBM.F2X / lam, 2e-3);
  near(m.Td[5], EBM.F2X / lam, 5e-3);
});

test('diffusion and ocean exchange conserve heat exactly', () => {
  const g = makeGrid(32, 16), o = oceanGrid(32, 16);
  const cal = flat(g, { lam: 0 });
  const m = new Model(cal, o);
  for (let k = 0; k < m.T.length; k++) { m.T[k] = Math.sin(k * 0.37) + 1; m.Td[k] = 0.3 * Math.cos(k * 0.11); }
  const heat = () => { let s = 0; for (let j = 0; j < 16; j++) for (let i = 0; i < 32; i++) { const k = j * 32 + i; s += (g.w[j] / 32) * ((EBM.C_LAND + (EBM.C_MIX - EBM.C_LAND) * o[k]) * m.T[k] + o[k] * EBM.C_DEEP * m.Td[k]); } return s; };
  const before = heat();
  m.step(4000, cal.dt, 0);
  near(heat(), before, 1e-9);
  const rows = m.rows(); // and diffusion has smoothed the field
  assert.ok(Math.max(...rows) - Math.min(...rows) < 0.4);
});

test('uniform feedback: the equilibrium solve gives F/lambda', () => {
  const g = makeGrid(64, 32);
  near(equilibriumMean(g, new Float64Array(32).fill(1.31), EBM.F2X), 3.0, 1e-9);
  assert.equal(equilibriumMean(g, new Float64Array(32).fill(-1), EBM.F2X), Infinity); // unstable system is reported
});

const obs = synthetic(), o16 = oceanGrid(32, 16);

test('calibration closes today\'s global energy budget and hits the requested sensitivity', () => {
  for (const ecs of [2, 2.5, 3, 4, 5]) {
    const c = calibrate({ obs, ocean: o16, W: 32, H: 16, ecs });
    assert.ok(c.ok);
    near(c.ecsModel, ecs, 1e-3, `ECS ${ecs}`);
    near(c.F0, c.N0 + c.lamG * c.meanT0, 1e-9);      // forcing = imbalance + radiative response
    assert.ok(c.N0 > 0.4 && c.N0 < 1.6, `imbalance ${c.N0}`);
    assert.ok(c.F0 > 1 && c.F0 < 5, `forcing ${c.F0} at ECS ${ecs}`); // real-data bounds are tested below
    // local feedbacks stay inside their limits; the rest goes to ocean uptake
    assert.ok(c.lam.every((v) => v >= EBM.LAMBDA_RANGE[0] - 1e-9 && v <= EBM.LAMBDA_RANGE[1] + 1e-9));
    assert.ok(c.gam.every((v) => v >= EBM.GAMMA - 1e-9 && v <= EBM.GAMMA_MAX + 1e-9));
  }
});

test('at the start, the heat the model stores equals the heat the observed warming rate requires', () => {
  const c = calibrate({ obs, ocean: o16, W: 32, H: 16, ecs: 3 });
  const g = c.g, m = new Model(c, o16);
  const before = Float64Array.from(m.T);
  m.step(1, 1e-5, c.F0);
  // surface heat storage of the model, W/m2: area mean of C(x) dT/dt
  let model = 0, observed = 0;
  const rate = bandsToRows(obs.rate, g);
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    const k = j * g.W + i, C = EBM.C_LAND + (EBM.C_MIX - EBM.C_LAND) * o16[k];
    model += (g.w[j] / g.W) * C * (m.T[k] - before[k]) / 1e-5;
    observed += (g.w[j] / g.W) * C * rate[j];
  }
  // equal unless a latitude hits the limits placed on the feedback
  near(model, observed, 0.05, 'surface heat storage');
  console.log(`    surface storage ${model.toFixed(3)} W/m2 (observed rate implies ${observed.toFixed(3)}), imbalance ${c.N0.toFixed(2)}, forcing ${c.F0.toFixed(2)} W/m2`);
});

test('projections: ordered by forcing and by sensitivity, and inside the IPCC AR6 very likely ranges', () => {
  const end = (ecs, f) => project(calibrate({ obs, ocean: o16, W: 32, H: 16, ecs }), o16, f).warmingSincePI;
  const base = [2.6, 4.5, 7.0, 8.5].map((f) => end(3, f));
  for (let i = 1; i < base.length; i++) assert.ok(base[i] > base[i - 1]);
  assert.ok(end(4, 4.5) > end(3, 4.5) && end(3, 4.5) > end(2.5, 4.5));
  // AR6 WG1 SPM table SPM.1, 2081-2100 vs 1850-1900, very likely ranges
  assert.ok(base[0] > 1.3 && base[0] < 2.4, `SSP1-2.6 level: ${base[0]}`);
  assert.ok(base[1] > 2.1 && base[1] < 3.5, `SSP2-4.5 level: ${base[1]}`);
  assert.ok(base[3] > 3.3 && base[3] < 5.7, `SSP5-8.5 level: ${base[3]}`);
  console.log('    warming in 2100 vs 1880-1900, ECS 3: ' + base.map((v, i) => `${[2.6, 4.5, 7.0, 8.5][i]} W/m2 -> +${v.toFixed(2)} K`).join(', '));
});

test('grid resolution barely changes the global mean', () => {
  const coarse = project(calibrate({ obs, ocean: o16, W: 32, H: 16, ecs: 3 }), o16, 4.5);
  const o32 = oceanGrid(64, 32);
  const fine = project(calibrate({ obs, ocean: o32, W: 64, H: 32, ecs: 3 }), o32, 4.5);
  near(coarse.warmingSincePI, fine.warmingSincePI, 0.05);
  assert.ok(fine.global.every(Number.isFinite));
});

test('forcing pathway is a straight line from today to the 2100 level', () => {
  const cal = { t0: 2025, F0: 3 };
  near(forcingAt(2025, cal, 4.5), 3, 1e-12); near(forcingAt(2100, cal, 4.5), 4.5, 1e-12); near(forcingAt(2062.5, cal, 4.5), 3.75, 1e-12);
});

test('today\'s state comes from the recent record, whatever the analysis period', () => {
  // accelerating warming: a long straight line would put today far below the last values
  const years = [], b = [];
  for (let y = 1880; y <= 2025; y++) { years.push(y); b.push(y < 1970 ? 0 : 0.0003 * (y - 1970) ** 2); }
  const r = recentState(years, [b])[0];
  near(r.present, b.at(-1), 0.05);                 // within 0.05 K of the curve today
  near(r.rate, 2 * 0.0003 * (2010.5 - 1970), 0.002); // slope of the curve at the window centre
});

test('per-row ocean exchange still conserves heat and does not change the sensitivity', () => {
  const c = calibrate({ obs, ocean: o16, W: 32, H: 16, ecs: 3 });
  const g = c.g, m = new Model({ ...c, lam: new Float64Array(16), gam: Float64Array.from({ length: 16 }, (_, j) => 1 + j * 0.3) }, o16);
  for (let k = 0; k < m.T.length; k++) { m.T[k] = 1 + Math.sin(k); m.Td[k] = 0.2; }
  const heat = () => { let s = 0; for (let j = 0; j < 16; j++) for (let i = 0; i < 32; i++) { const k = j * 32 + i; s += (g.w[j] / 32) * ((EBM.C_LAND + (EBM.C_MIX - EBM.C_LAND) * o16[k]) * m.T[k] + o16[k] * EBM.C_DEEP * m.Td[k]); } return s; };
  const h0 = heat();
  m.step(2000, stableDt(g, 0, 1 + 15 * 0.3), 0);
  near(heat(), h0, 1e-9);
  near(c.ecsModel, 3, 1e-3);
});

// Performance guards: the interface recalibrates on every scenario or sensitivity change
// (three CPU runs plus one GPU calibration), so these must stay fast.
test('performance: calibration and the three projections fit in an interactive budget', () => {
  const t0 = performance.now();
  for (const ecs of [2.5, 3, 4]) project(calibrate({ obs, ocean: o16, W: 32, H: 16, ecs }), o16, 4.5);
  const o32 = oceanGrid(64, 32);
  calibrate({ obs, ocean: o32, W: 64, H: 32, ecs: 3 });
  const ms = performance.now() - t0;
  console.log(`    recalibration took ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1500, `recalibration took ${ms.toFixed(0)} ms (budget 1500)`);
});

test('performance: the GPU time step keeps the step count per model year bounded', () => {
  // each model year costs ceil(1/dt) shader passes; the frame loop runs two model years
  const c = calibrate({ obs, ocean: oceanGrid(64, 32), W: 64, H: 32, ecs: 3 });
  const passes = Math.ceil(1 / c.dt);
  assert.ok(passes <= 600, `${passes} passes per model year (budget 600)`);
});

test('on the real GISTEMP record, the diagnosed forcing and imbalance match IPCC AR6', () => {
  const g = parseGistempZonal(readFileSync(new URL('../data/gistemp-zonal.csv', import.meta.url), 'utf8'));
  const now = recentState(g.years, g.bands);
  const real = { years: g.years, bands: g.bands, present: now.map((b) => b.present), rate: now.map((b) => b.rate) };
  const c = calibrate({ obs: real, ocean: o16, W: 32, H: 16, ecs: 3 });
  // AR6 WG1: forcing 2.72 [1.96 to 3.48] W/m2 in 2019; imbalance 0.79 [0.52 to 1.06] W/m2 for 2006-2018
  assert.ok(c.F0 > 1.96 && c.F0 < 3.48, `forcing ${c.F0}`);
  assert.ok(c.N0 > 0.52 && c.N0 < 1.2, `imbalance ${c.N0}`); // a little above AR6: the imbalance has kept rising
  // the projection continues from today without a jump
  const p = project(c, o16, 4.5);
  const last5 = g.global.slice(-5).reduce((a, b) => a + b, 0) / 5;
  assert.ok(Math.abs(p.global[0] - last5) < 0.15, `model starts at ${p.global[0]}, last five years average ${last5}`);
  console.log(`    real record: forcing ${c.F0.toFixed(2)} W/m2, imbalance ${c.N0.toFixed(2)} W/m2, 2100 at 4.5 W/m2: +${p.warmingSincePI.toFixed(2)} K`);
});

console.log(`\n${n} tests passed`);
