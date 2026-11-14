// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Time-series chart drawn as SVG: observations, fitted trend, projection with
// prediction interval, unusual years and the year selected on the timeline.
import { t, num } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return { ticks: out, step };
}

// model: { analysis, unit, decimals, color, factor, endYear, cursorYear, baselineLabel }
export function renderChart(svg, model) {
  const { analysis: a, unit, color, factor, cursorYear } = model;
  const W = 380, H = 230, m = { l: 44, r: 12, t: 14, b: 26 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  const y0 = a.years[0];
  const lastFit = a.period[1];
  const y1 = Math.max(model.endYear, a.years.at(-1));
  const hasProj = y1 > lastFit;

  // projection samples
  const proj = [];
  if (hasProj) for (let y = lastFit; y <= y1; y++) proj.push(a.project(y, factor));

  let lo = Math.min(...a.anomalies), hi = Math.max(...a.anomalies);
  for (const p of proj) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
  lo = Math.min(lo, 0); hi = Math.max(hi, 0);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const { ticks, step } = niceTicks(lo, hi, 5);
  const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));

  const X = (y) => m.l + ((y - y0) / (y1 - y0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

  // grid and axes
  for (const v of ticks) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'c-zero' : 'c-grid' }));
    svg.append(el('text', { x: m.l - 6, y: Y(v) + 3.5, class: 'c-tick', 'text-anchor': 'end' }, num(v, dec, { sign: true })));
  }
  const spanY = y1 - y0;
  const xStep = spanY > 160 ? 40 : spanY > 80 ? 20 : spanY > 30 ? 10 : 5;
  for (let y = Math.ceil(y0 / xStep) * xStep; y <= y1; y += xStep) {
    svg.append(el('line', { x1: X(y), x2: X(y), y1: H - m.b, y2: H - m.b + 4, class: 'c-axis' }));
    svg.append(el('text', { x: X(y), y: H - m.b + 16, class: 'c-tick', 'text-anchor': 'middle' }, y));
  }
  svg.append(el('text', { x: W - m.r, y: Y(0) - 4, class: 'c-note', 'text-anchor': 'end' }, model.baselineLabel));

  // projected part of the time axis
  if (hasProj) {
    svg.append(el('rect', { x: X(lastFit), y: m.t, width: X(y1) - X(lastFit), height: H - m.t - m.b, class: 'c-future' }));
    const band = proj.map((p) => `${X(p.year)},${Y(p.hi)}`).concat(proj.slice().reverse().map((p) => `${X(p.year)},${Y(p.lo)}`)).join(' ');
    svg.append(el('polygon', { points: band, fill: color, opacity: 0.22 }));
    svg.append(el('polyline', { points: proj.map((p) => `${X(p.year)},${Y(p.value)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
  }

  // observations: years outside the fitted period are drawn fainter
  const seg = (from, to, cls) => {
    const pts = a.years.map((y, i) => (y >= from && y <= to ? `${X(y)},${Y(a.anomalies[i])}` : null)).filter(Boolean);
    if (pts.length > 1) svg.append(el('polyline', { points: pts.join(' '), class: cls }));
  };
  seg(y0, a.period[0], 'c-obs c-faint');
  seg(a.period[1], a.years.at(-1), 'c-obs c-faint');
  seg(a.period[0], a.period[1], 'c-obs');

  // trend over the fitted period
  svg.append(el('line', {
    x1: X(a.period[0]), y1: Y(a.fit.predict(a.period[0])), x2: X(a.period[1]), y2: Y(a.fit.predict(a.period[1])),
    stroke: color, 'stroke-width': 2.2,
  }));

  // unusual years
  for (const u of a.unusual) {
    svg.append(el('circle', { cx: X(u.year), cy: Y(u.value), r: 4, class: 'c-unusual' }));
    svg.append(el('text', { x: X(u.year), y: Y(u.value) + (u.z > 0 ? -7 : 14), class: 'c-note', 'text-anchor': 'middle' }, u.year));
  }

  // timeline cursor
  if (cursorYear >= y0 && cursorYear <= y1) {
    const i = a.years.indexOf(cursorYear);
    const v = i >= 0 && cursorYear <= a.years.at(-1) ? a.anomalies[i] : cursorYear > lastFit ? a.project(cursorYear, factor).value : null;
    svg.append(el('line', { x1: X(cursorYear), x2: X(cursorYear), y1: m.t, y2: H - m.b, class: 'c-cursor' }));
    if (v != null) {
      svg.append(el('circle', { cx: X(cursorYear), cy: Y(v), r: 3.2, fill: '#fff' }));
      const right = X(cursorYear) < W - 90;
      svg.append(el('text', { x: X(cursorYear) + (right ? 6 : -6), y: m.t + 9, class: 'c-cursor-label', 'text-anchor': right ? 'start' : 'end' },
        `${cursorYear}: ${num(v, model.decimals, { sign: true })} ${unit}`));
    }
  }

  // hover read-out
  const hover = el('g', { visibility: 'hidden' });
  const hl = el('line', { y1: m.t, y2: H - m.b, class: 'c-hover' });
  const ht = el('text', { y: H - m.b - 6, class: 'c-cursor-label' });
  hover.append(hl, ht);
  svg.append(hover);
  const overlay = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  svg.append(overlay);
  overlay.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const year = Math.round(y0 + ((px - m.l) / (W - m.l - m.r)) * (y1 - y0));
    const i = a.years.indexOf(year);
    const v = i >= 0 ? a.anomalies[i] : year > lastFit ? a.project(year, factor).value : null;
    if (v == null) { hover.setAttribute('visibility', 'hidden'); return; }
    hover.setAttribute('visibility', 'visible');
    hl.setAttribute('x1', X(year)); hl.setAttribute('x2', X(year));
    const right = X(year) < W - 100;
    ht.setAttribute('x', X(year) + (right ? 6 : -6));
    ht.setAttribute('text-anchor', right ? 'start' : 'end');
    ht.textContent = `${year}: ${num(v, model.decimals, { sign: true })} ${unit}${i < 0 ? ` (${t('projected')})` : ''}`;
  });
  overlay.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));

  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', model.ariaLabel || '');
}
