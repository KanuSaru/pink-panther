// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Run: node tests/shaders.test.mjs
// Static guards on the GLSL. The shaders are only compiled in a browser, so these checks
// catch the mistakes that cost frame rate or break the solver before anyone opens it.
import assert from 'node:assert/strict';
import { EARTH_FRAG, ATMO_FRAG, ATMO_GLSL, SIM_FRAG, SIM_H, EARTH_SAMPLERS, earthUniformDefaults } from '../src/shaders.js';
import { BAND_SOFT, zonalBlend } from '../src/analysis.js';
import { createSmoother } from '../src/simdriver.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const loops = (src) => [...src.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\w+)\s*;/g)].map((m) => m[1]);
const constant = (src, name) => { const m = src.match(new RegExp(`const\\s+int\\s+${name}\\s*=\\s*(\\d+)`)); return m ? +m[1] : null; };

test('every loop has a compile-time bound (GLSL ES and frame rate)', () => {
  for (const [name, src] of [['earth', EARTH_FRAG], ['atmosphere', ATMO_FRAG + ATMO_GLSL], ['solver', SIM_FRAG]]) {
    for (const b of loops(src)) assert.ok(/^\d+$/.test(b) || constant(src, b) != null, `${name}: loop bound ${b} is not a constant`);
  }
});

test('atmosphere stays within its per-pixel budget', () => {
  // the scattering integral runs once per pixel in the natural view; see PENDING.md
  const bounds = loops(ATMO_GLSL).map((b) => (/^\d+$/.test(b) ? +b : constant(ATMO_GLSL, b)));
  const total = bounds.reduce((s, v) => s * (v || 1), 1);
  assert.ok(total <= 64, `atmosphere loop iterations per pixel: ${total} (budget 64)`);
});

test('the earth shader samples a bounded number of textures', () => {
  const taps = (EARTH_FRAG.match(/texture2D\s*\(/g) || []).length;
  assert.ok(taps <= 40, `${taps} texture reads in the earth shader (budget 40)`);
  // the model field costs 16 reads per pixel, only while a projection is on screen
  assert.match(EARTH_FRAG, /if \(uSimOn > 0\.002\)/);
});

test('solver arrays match the model grid', () => {
  for (const u of ['uLam', 'uGam', 'uT0', 'uTd0', 'uPi']) assert.match(SIM_FRAG, new RegExp(`uniform float ${u}\\[${SIM_H}\\]`), u);
});

test('every sampler the renderer binds is declared in the earth shader', () => {
  for (const s of EARTH_SAMPLERS) assert.match(EARTH_FRAG, new RegExp(`uniform sampler2D ${s};`), s);
});

test('the band blend is the same on the globe and in the read-out, and it is smooth', () => {
  assert.equal(earthUniformDefaults().uBandSoft, BAND_SOFT);
  const v = [0.6, 0.4, 0.8, 1.0, 1.0, 1.3, 1.8, 3.0];
  // each band keeps its own value at its centre
  [-77, -54, -34, -12, 12, 34, 54, 77].forEach((c, k) => assert.ok(Math.abs(zonalBlend(c, v) - v[k]) < 1e-9, `band ${k}`));
  // no jump anywhere: the largest change over a tenth of a degree is small
  let worst = 0;
  for (let lat = -90; lat < 90; lat += 0.1) worst = Math.max(worst, Math.abs(zonalBlend(lat + 0.1, v) - zonalBlend(lat, v)));
  assert.ok(worst < 0.012, `largest step ${worst}`); // with a 2 degree blend this was 0.045
});

test('the model field is sampled with a spline whose weights always sum to one', () => {
  assert.match(EARTH_FRAG, /vec4 bspline\(float f\)/);
  for (let f = 0; f <= 1; f += 0.05) {
    const f2 = f * f, f3 = f2 * f;
    const w = [1 - 3 * f + 3 * f2 - f3, 4 - 6 * f2 + 3 * f3, 1 + 3 * f + 3 * f2 - 3 * f3, f3].map((x) => x / 6);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12 && w.every((x) => x >= -1e-12));
  }
});

test('values ease towards their target: no jump, then exactly on target', () => {
  const s = createSmoother(140);
  const seen = [];
  s.set('x', 0);                       // first value applies at once
  s.tick(0, (n, v) => seen.push(v));
  s.set('x', 1);
  for (let t = 16; t <= 2000; t += 16) s.tick(t, (n, v) => seen.push(v));
  assert.equal(seen[0], 0);
  assert.ok(seen[1] > 0 && seen[1] < 0.2, `first frame moved ${seen[1]}`);
  for (let i = 2; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
  assert.equal(seen.at(-1), 1);
  const n0 = seen.length;
  s.tick(3000, (n, v) => seen.push(v)); // at rest it does no work
  assert.equal(seen.length, n0);
  s.set('y', [1, 2], true); s.set('y', [3, 4], true);
  let y; s.tick(3016, (n, v) => { if (n === 'y') y = v; });
  assert.deepEqual(Array.from(y), [3, 4]); // instant mode, used with reduced motion
});

console.log(`\n${n} tests passed`);
