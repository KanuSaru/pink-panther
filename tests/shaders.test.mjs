// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Run: node tests/shaders.test.mjs
// Static guards on the GLSL. The shaders are only compiled in a browser, so these checks
// catch the mistakes that cost frame rate or break the solver before anyone opens it.
import assert from 'node:assert/strict';
import { EARTH_FRAG, ATMO_FRAG, ATMO_GLSL, SIM_FRAG, SIM_H, EARTH_SAMPLERS } from '../src/shaders.js';

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
});

test('solver arrays match the model grid', () => {
  for (const u of ['uLam', 'uGam', 'uT0', 'uTd0', 'uPi']) assert.match(SIM_FRAG, new RegExp(`uniform float ${u}\\[${SIM_H}\\]`), u);
});

test('every sampler the renderer binds is declared in the earth shader', () => {
  for (const s of EARTH_SAMPLERS) assert.match(EARTH_FRAG, new RegExp(`uniform sampler2D ${s};`), s);
});

console.log(`\n${n} tests passed`);
