// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Run: node tests/stats.test.mjs
import assert from 'node:assert/strict';
import * as S from '../src/stats.js';
import { seriesFromPower, analyzeSeries, parseGistempZonal, analyzeRegion, regionTexture, niceRange, screenVariables, seasonBreakdown, comparePlaces } from '../src/analysis.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

test('normal CDF and quantile', () => {
  near(S.normalCdf(1.959964), 0.975, 1e-6);
  near(S.normalCdf(-1), 0.158655, 1e-6);
  near(S.normalQuantile(0.975), 1.959964, 1e-5);
  near(S.normalQuantile(0.005), -2.575829, 1e-5);
});

test('Student t p-values and quantiles (reference tables)', () => {
  near(S.tTwoSidedP(2.228, 10), 0.05, 2e-4);
  near(S.tTwoSidedP(2.045, 29), 0.05, 2e-4);
  near(S.tTwoSidedP(12.706, 1), 0.05, 2e-4);
  near(S.tQuantile(0.95, 10), 2.228, 1e-3);
  near(S.tQuantile(0.99, 20), 2.845, 1e-3);
});

test('OLS against a hand-computed example', () => {
  // x = 1..5, y = 2,4,5,4,5 -> slope 0.6, intercept 2.2, r2 0.6, se(slope) 0.2828, p 0.1243
  const f = S.ols([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  near(f.slope, 0.6, 1e-12); near(f.intercept, 2.2, 1e-12); near(f.r2, 0.6, 1e-12);
  near(f.seSlope, 0.28284, 1e-4); near(f.p, 0.1243, 5e-4);
});

test('Mann-Kendall: textbook example (Gilbert 1987 style)', () => {
  // Strictly increasing n=10 -> S = 45, var = 125, z = 44/sqrt(125) = 3.9355
  const x = [...Array(10).keys()];
  const mk = S.mannKendall(x, x.map((v) => v * 2 + 1), { correct: false });
  assert.equal(mk.S, 45); near(mk.varS, 125, 1e-9); near(mk.z, 3.93548, 1e-4); near(mk.tau, 1, 1e-12);
  near(mk.p, 8.3e-5, 2e-5);
});

test('Mann-Kendall: ties reduce the variance', () => {
  const y = [1, 1, 2, 2, 3, 3, 4, 4];
  const mk = S.mannKendall([...y.keys()], y, { correct: false });
  // 4 tie groups of 2: tie term = 4 * 2*1*9 = 72; var = (8*7*21 - 72)/18 = 61.333
  assert.equal(mk.S, 24); near(mk.varS, 61.3333, 1e-3);
});

test('Mann-Kendall: no trend in a flat alternating series', () => {
  const y = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
  const mk = S.mannKendall([...y.keys()], y);
  assert.ok(mk.p > 0.5);
});

test('Theil-Sen is robust to an outlier, OLS is not', () => {
  const x = [...Array(21).keys()];
  const y = x.map((v) => 0.5 * v + 3);
  y[20] = 100;
  const sen = S.theilSen(x, y);
  near(sen.slope, 0.5, 1e-9);
  assert.ok(S.ols(x, y).slope > 1);
});

test('Theil-Sen confidence interval brackets the slope', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const x = [...Array(40).keys()], y = x.map((v) => 0.03 * v + rnd());
  const mk = S.mannKendall(x, y, { correct: false });
  const sen = S.theilSen(x, y, 0.05, mk.varS);
  assert.ok(sen.lo < sen.slope && sen.slope < sen.hi && sen.lo > 0);
});

test('autocorrelation correction makes the test more conservative', () => {
  // AR(1) noise with strong persistence plus a weak trend
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const x = [...Array(60).keys()]; const y = []; let e = 0;
  for (const v of x) { e = 0.8 * e + rnd(); y.push(0.01 * v + e); }
  const raw = S.mannKendall(x, y, { correct: false }), cor = S.mannKendall(x, y, { correct: true });
  assert.ok(cor.corrected && cor.p > raw.p && cor.nEff < 60);
});

test('Welch t-test', () => {
  const r = S.welch([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  near(r.diff, 5, 1e-12); near(r.t, 5, 1e-9); near(r.df, 8, 1e-9); near(r.p, 0.001053, 2e-5);
});

test('Benjamini-Hochberg', () => {
  const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
  // thresholds k/10*0.05: 0.005,0.010,0.015,... -> only the first two pass
  assert.deepEqual(S.benjaminiHochberg(p, 0.05), [true, true, false, false, false, false, false, false, false, false]);
});

test('POWER monthly dictionary -> annual and seasonal series', () => {
  const d = {};
  for (const y of [2000, 2001]) { for (let m = 1; m <= 12; m++) d[`${y}${String(m).padStart(2, '0')}`] = m + (y - 2000) * 10; d[`${y}13`] = 99; }
  d['200107'] = -999; // missing month -> falls back to POWER's own annual value
  const ann = seriesFromPower(d, 'ANN');
  assert.deepEqual(ann.years, [2000, 2001]); near(ann.values[0], 6.5, 1e-12); assert.equal(ann.values[1], 99);
  const djf = seriesFromPower(d, 'DJF'); // 2000 lacks Dec 1999 -> only 2001: Dec2000=12, Jan2001=11, Feb2001=12
  assert.deepEqual(djf.years, [2001]); near(djf.values[0], (12 + 11 + 12) / 3, 1e-12);
  assert.deepEqual(seriesFromPower(d, 'JJA').years, [2000]);
});

test('analyzeSeries recovers a known trend and flags an unusual year', () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const years = [], values = [];
  for (let y = 1981; y <= 2025; y++) { years.push(y); values.push(27 + 0.02 * (y - 1981) + 0.2 * rnd()); }
  values[years.indexOf(2015)] += 1.5;
  const a = analyzeSeries(years, values, { baseline: [1991, 2020] });
  near(a.perDecade, 0.2, 0.03); assert.ok(a.significant && a.direction === 1);
  assert.ok(a.unusual.some((u) => u.year === 2015));
  near(a.change, 0.02 * 44, 0.12);
  const p = a.project(2050, 1); assert.ok(p.lo < p.value && p.value < p.hi);
  near(a.project(2050, 2).value - a.project(2050, 0).value, 2 * a.fit.slope * 25, 1e-9);
  near(a.project(2025, 3).value, a.fit.predict(2025), 1e-9);
});

test('GISTEMP zonal CSV parser', () => {
  const head = 'Year,Glob,NHem,SHem,24N-90N,24S-24N,90S-24S,64N-90N,44N-64N,24N-44N,EQU-24N,24S-EQU,44S-24S,64S-44S,90S-64S';
  const rows = [];
  for (let y = 1880; y <= 1920; y++) rows.push([y, '-.17', -0.28, -0.05, -0.37, -0.13, -0.02, -0.8, -0.44, -0.27, -0.16, -0.1, -0.04, 0.05, y === 1881 ? '*****' : 0.66].join(','));
  const g = parseGistempZonal([head, ...rows].join('\n'));
  assert.equal(g.years.length, 40); assert.equal(g.years[1], 1882);
  near(g.global[0], -0.17, 1e-12);
  near(g.bands[0][0], 0.66, 1e-12); near(g.bands[7][0], -0.8, 1e-12); // south -> north
});

test('region grid: opposite significant trends inside one box', () => {
  const feats = [];
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (const lat of [10, 10.5, 11]) for (const lon of [-75, -74.375, -73.75, -73.125]) {
    const d = {}; const s = lon < -74 ? 0.05 : -0.05;
    for (let y = 1981; y <= 2025; y++) d[`${y}13`] = 20 + s * (y - 1981) + 0.3 * rnd();
    feats.push({ geometry: { coordinates: [lon, lat, 10] }, properties: { parameter: { T2M: d } } });
  }
  const r = analyzeRegion(feats, 'T2M');
  assert.equal(r.w, 4); assert.equal(r.h, 3); assert.equal(r.nCells, 12);
  assert.equal(r.nUp, 6); assert.equal(r.nDown, 6); assert.ok(r.opposing);
  near(r.bounds.lonMin, -75.3125, 1e-6); near(r.bounds.latMax, 11.25, 1e-6);
  const tex = regionTexture(r, niceRange(r.maxAbs));
  assert.equal(tex.length, 48); assert.ok(tex[0] > 128 && tex[1] === 255 && tex[3] === 255); // SW cell warms
  assert.ok(tex[3 * 4] < 128); // SE cell cools
  assert.equal(niceRange(0.53), 1); assert.equal(niceRange(0.18), 0.2);
});

const lcg = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const monthly = (fn) => { const d = {}; for (let y = 1981; y <= 2025; y++) for (let m = 1; m <= 12; m++) d[`${y}${String(m).padStart(2, '0')}`] = fn(y, m); return d; };

test('Pettitt: finds a step and its year, stays quiet on noise', () => {
  const rnd = lcg(21);
  const step = [...Array(40).keys()].map((i) => (i < 22 ? 0 : 2) + rnd());
  const pt = S.pettitt(step);
  assert.equal(pt.index, 21); assert.ok(pt.p < 0.001);
  // hand check, n = 8 fully separated halves: K = 4 * 4 = 16, p = 2 exp(-6*256 / (512 + 64))
  const small = S.pettitt([1, 2, 3, 4, 11, 12, 13, 14]);
  assert.equal(small.K, 16); assert.equal(small.index, 3); near(small.p, 2 * Math.exp(-1536 / 576), 1e-12);
  const noise = lcg(4); assert.ok(S.pettitt([...Array(40)].map(() => noise())).p > 0.05);
});

test('analyzeSeries tells a step from a steady trend', () => {
  const rnd = lcg(9); const years = [...Array(45).keys()].map((i) => 1981 + i);
  const stepped = analyzeSeries(years, years.map((y) => (y < 2001 ? 10 : 12) + 0.4 * rnd()));
  assert.ok(stepped.shift.abrupt); assert.equal(stepped.shift.year, 2001); near(stepped.shift.diff, 2, 0.2);
  const steady = analyzeSeries(years, years.map((y) => 10 + 0.05 * (y - 1981) + 0.4 * rnd()));
  assert.ok(steady.significant && steady.shift.significant && !steady.shift.abrupt);
});

test('screening ranks the variables that change and controls false discoveries', () => {
  const rnd = lcg(13);
  const dicts = {
    A: monthly((y) => 20 + 0.04 * (y - 1981) + 0.3 * rnd()),   // clear rise
    B: monthly(() => 5 + 2 * rnd()),                           // noise
    C: monthly((y) => 0.6 - 0.004 * (y - 1981) + 0.02 * rnd()), // clear fall, tiny units
    D: monthly(() => -999),                                    // no data here
  };
  const rows = screenVariables(dicts, ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['A', 'B', 'C']);
  assert.equal(rows.at(-1).id, 'B'); assert.ok(!rows.at(-1).significant && !rows.at(-1).fdr);
  const c = rows.find((r) => r.id === 'C'); assert.ok(c.significant && c.fdr && c.direction === -1);
  assert.ok(rows[0].snr >= rows[1].snr);
});

test('season breakdown: a change confined to one season', () => {
  const rnd = lcg(17);
  const d = monthly((y, m) => 15 + (m >= 6 && m <= 8 ? 0.06 * (y - 1981) : 0) + 0.3 * rnd());
  const s = seasonBreakdown(d);
  assert.deepEqual(s.map((r) => r.season), ['DJF', 'MAM', 'JJA', 'SON']);
  assert.ok(s[2].significant && s[2].perDecade > 0.4);
  assert.ok(Math.abs(s[0].perDecade) < 0.15 && Math.abs(s[3].perDecade) < 0.15);
});

test('comparing two places: opposite trends are reported as opposite and different', () => {
  const rnd = lcg(29); const years = [...Array(45).keys()].map((i) => 1981 + i);
  const up = analyzeSeries(years, years.map((y) => 3 + 0.03 * (y - 1981) + 0.3 * rnd()));
  const down = analyzeSeries(years, years.map((y) => 3 - 0.03 * (y - 1981) + 0.3 * rnd()));
  const same = analyzeSeries(years, years.map((y) => 8 + 0.03 * (y - 1981) + 0.3 * rnd()));
  const c = comparePlaces(up, down); assert.ok(c.opposite && c.differ);
  const c2 = comparePlaces(up, same); assert.ok(!c2.opposite && !c2.differ);
});

console.log(`\n${n} tests passed`);
