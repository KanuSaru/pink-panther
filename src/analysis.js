// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Turns raw NASA responses into series, and series into findings.
import { mean, sd, ols, mannKendall, theilSen, welch, benjaminiHochberg, predictionHalfWidth, pettitt, slopeDifference } from './stats.js';

export const SEASONS = {
  ANN: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  DJF: [12, 1, 2],
  MAM: [3, 4, 5],
  JJA: [6, 7, 8],
  SON: [9, 10, 11],
};

const ok = (v, fill) => typeof v === 'number' && isFinite(v) && v !== fill && v > -900;

// POWER monthly dictionary {"198101": v, ..., "198113": annual} -> one value per year
export function seriesFromPower(dict, season = 'ANN', fill = -999) {
  const yearsSet = new Set(Object.keys(dict).map((k) => +k.slice(0, 4)));
  const years = [], values = [];
  const months = SEASONS[season] || SEASONS.ANN;
  for (const y of [...yearsSet].sort((a, b) => a - b)) {
    const vals = [];
    for (const m of months) {
      const yy = season === 'DJF' && m === 12 ? y - 1 : y;
      const v = dict[`${yy}${String(m).padStart(2, '0')}`];
      if (ok(v, fill)) vals.push(v);
    }
    let value = null;
    if (vals.length === months.length) value = mean(vals);
    else if (season === 'ANN' && ok(dict[`${y}13`], fill)) value = dict[`${y}13`];
    if (value != null) { years.push(y); values.push(value); }
  }
  return { years, values };
}

// GISTEMP zonal annual CSV -> { years, global, bands: [8 arrays south to north] }
export const BAND_COLUMNS = ['90S-64S', '64S-44S', '44S-24S', '24S-EQU', 'EQU-24N', '24N-44N', '44N-64N', '64N-90N'];
export const BAND_EDGES = [-90, -64, -44, -24, 0, 24, 44, 64, 90];

export function parseGistempZonal(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const h = lines.findIndex((l) => /^Year\s*,/i.test(l));
  if (h < 0) throw new Error('GISTEMP: header not found');
  const cols = lines[h].split(',').map((c) => c.trim());
  const col = (name) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`GISTEMP: column ${name} not found`);
    return i;
  };
  const iGlob = col('Glob');
  const iBands = BAND_COLUMNS.map(col);
  const num = (s) => { const v = parseFloat(s); return isFinite(v) ? v : NaN; };
  const years = [], global = [], bands = BAND_COLUMNS.map(() => []);
  for (const line of lines.slice(h + 1)) {
    const p = line.split(',');
    const y = parseInt(p[0], 10);
    if (!isFinite(y)) continue;
    const g = num(p[iGlob]);
    const b = iBands.map((i) => num(p[i]));
    if (!isFinite(g) || b.some((v) => !isFinite(v))) continue;
    years.push(y); global.push(g); b.forEach((v, k) => bands[k].push(v));
  }
  if (years.length < 30) throw new Error('GISTEMP: too few rows');
  return { years, global, bands };
}

// Full analysis of one annual series.
export function analyzeSeries(years, values, opts = {}) {
  const { period = [years[0], years.at(-1)], baseline = [1991, 2020], alpha = 0.05 } = opts;
  if (years.length < 8) return null;

  let baseVals = values.filter((_, i) => years[i] >= baseline[0] && years[i] <= baseline[1]);
  let baselineUsed = baseline;
  if (baseVals.length < 10) { baseVals = values; baselineUsed = [years[0], years.at(-1)]; }
  const base = mean(baseVals);
  const anomalies = values.map((v) => v - base);

  const idx = years.map((y, i) => (y >= period[0] && y <= period[1] ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 8) return null;
  const fx = idx.map((i) => years[i]);
  const fy = idx.map((i) => anomalies[i]);

  const fit = ols(fx, fy);
  const mk = mannKendall(fx, fy);
  const sen = theilSen(fx, fy, alpha, mk.varS);
  const span = fx.at(-1) - fx[0];
  // a series made mostly of repeated values (months with no rain) can pass the test with a slope of exactly zero: that is not a change
  const significant = mk.p < alpha && sen.slope !== 0;
  const direction = !significant ? 0 : Math.sign(sen.slope);

  // Unusual years: residual from the trend line beyond 2 standard deviations
  const resid = fy.map((v, i) => v - fit.predict(fx[i]));
  const rs = sd(resid);
  const unusual = fx.map((y, i) => ({ year: y, z: resid[i] / rs, value: fy[i] })).filter((d) => Math.abs(d.z) >= 2);

  // First half vs second half of the fitted period
  const half = Math.floor(fx.length / 2);
  const a = fy.slice(0, half), b = fy.slice(fx.length - half);
  const cmp = welch(a, b);
  const compare = cmp && {
    a: [fx[0], fx[half - 1]], b: [fx[fx.length - half], fx.at(-1)],
    meanA: cmp.meanA + base, meanB: cmp.meanB + base, diff: cmp.diff, p: cmp.p,
  };

  // Abrupt change: Pettitt's test finds the most likely break. A steady trend also
  // trips it, so the break only counts as a step when two flat levels describe the
  // series better than the straight line does.
  let shift = null;
  const pt = pettitt(fy);
  if (pt && pt.index >= 2 && pt.index < fy.length - 3) {
    const before = fy.slice(0, pt.index + 1), after = fy.slice(pt.index + 1);
    const mb = mean(before), ma = mean(after);
    const sseStep = before.reduce((q, v) => q + (v - mb) ** 2, 0) + after.reduce((q, v) => q + (v - ma) ** 2, 0);
    const sseLine = resid.reduce((q, v) => q + v * v, 0);
    shift = {
      year: fx[pt.index + 1], p: pt.p, significant: pt.p < alpha,
      before: mb + base, after: ma + base, diff: ma - mb,
      abrupt: pt.p < alpha && sseStep < sseLine,
    };
  }

  const lastYear = fx.at(-1);
  const project = (year, factor = 1) => {
    const value = fit.predict(lastYear) + fit.slope * factor * (year - lastYear);
    const hw = predictionHalfWidth(fit, year, 1 - alpha);
    return { year, value, lo: value - hw, hi: value + hw };
  };

  return {
    years, values, anomalies, base, baselineUsed, period: [fx[0], lastYear], n: fx.length, alpha,
    fit, mk, sen, significant, direction, span,
    perDecade: sen.slope * 10, perDecadeLo: sen.lo * 10, perDecadeHi: sen.hi * 10,
    change: sen.slope * span,
    pctOfBase: Math.abs(base) > 1e-9 ? (sen.slope * span) / Math.abs(base) * 100 : NaN,
    // how large the change is next to the year-to-year scatter around the trend
    snr: rs > 0 ? Math.abs(sen.slope * span) / rs : 0,
    unusual, compare, shift, project,
  };
}

// The same analysis for every variable at one place, to show which ones are changing.
// dicts: { parameterId: POWER monthly dictionary }. Sorted: significant first, then by strength.
export function screenVariables(dicts, ids, opts = {}) {
  const { season = 'ANN', fill = -999, alpha = 0.05 } = opts;
  const rows = [];
  for (const id of ids) {
    if (!dicts[id]) continue;
    const s = seriesFromPower(dicts[id], season, fill);
    const a = s.years.length ? analyzeSeries(s.years, s.values, opts) : null;
    if (a) rows.push({ id, perDecade: a.perDecade, p: a.mk.p, significant: a.significant, direction: Math.sign(a.perDecade), snr: a.snr, pctOfBase: a.pctOfBase });
  }
  const fdr = benjaminiHochberg(rows.map((r) => r.p), alpha);
  rows.forEach((r, i) => { r.fdr = fdr[i]; });
  rows.sort((a, b) => (b.significant - a.significant) || (b.snr - a.snr));
  return rows;
}

// One trend per season, to show when in the year the change happens.
export function seasonBreakdown(dict, opts = {}) {
  const { fill = -999 } = opts;
  return ['DJF', 'MAM', 'JJA', 'SON'].map((season) => {
    const s = seriesFromPower(dict, season, fill);
    const a = s.years.length ? analyzeSeries(s.years, s.values, opts) : null;
    return a && { season, perDecade: a.perDecade, p: a.mk.p, significant: a.significant };
  });
}

// Two places, same variable: do they move the same way, and do the trends differ?
export function comparePlaces(a, b) {
  const d = slopeDifference(a.fit, b.fit);
  return {
    perDecadeA: a.perDecade, perDecadeB: b.perDecade, pDiff: d.p, differ: d.p < a.alpha,
    opposite: a.significant && b.significant && a.direction * b.direction < 0,
  };
}

// POWER regional GeoJSON -> grid of per-cell trends.
export function analyzeRegion(features, parameter, opts = {}) {
  const { season = 'ANN', period, alpha = 0.05, fill = -999 } = opts;
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const cells = [];
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    const dict = f?.properties?.parameter?.[parameter];
    if (!c || !dict) continue;
    const s = seriesFromPower(dict, season, fill);
    const idx = s.years.map((y, i) => (!period || (y >= period[0] && y <= period[1]) ? i : -1)).filter((i) => i >= 0);
    const cell = { lon: round(c[0]), lat: round(c[1]), slope: NaN, p: NaN, n: idx.length, mean: NaN };
    if (idx.length >= 8) {
      const x = idx.map((i) => s.years[i]), y = idx.map((i) => s.values[i]);
      const mk = mannKendall(x, y);
      const sen = theilSen(x, y);
      cell.slope = sen.slope * 10; cell.p = mk.p; cell.mean = mean(y);
    }
    cells.push(cell);
  }
  const lats = [...new Set(cells.map((c) => c.lat))].sort((a, b) => a - b);
  const lons = [...new Set(cells.map((c) => c.lon))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  const dLat = (lats.at(-1) - lats[0]) / (lats.length - 1);
  const dLon = (lons.at(-1) - lons[0]) / (lons.length - 1);
  const w = lons.length, h = lats.length;
  const slope = new Float32Array(w * h).fill(NaN);
  const pval = new Float32Array(w * h).fill(NaN);
  for (const c of cells) {
    const k = lats.indexOf(c.lat) * w + lons.indexOf(c.lon);
    slope[k] = c.slope; pval[k] = c.p;
  }
  const valid = cells.filter((c) => isFinite(c.slope));
  if (!valid.length) return null;
  const sig = valid.filter((c) => c.p < alpha);
  const fdr = benjaminiHochberg(valid.map((c) => c.p), alpha);
  const up = sig.filter((c) => c.slope > 0), down = sig.filter((c) => c.slope < 0);
  const by = (fn) => valid.reduce((best, c) => (fn(c, best) ? c : best), valid[0]);
  const maxAbs = Math.max(...valid.map((c) => Math.abs(c.slope)));
  return {
    w, h, lats, lons, slope, pval, alpha,
    bounds: { lonMin: lons[0] - dLon / 2, lonMax: lons.at(-1) + dLon / 2, latMin: lats[0] - dLat / 2, latMax: lats.at(-1) + dLat / 2 },
    nCells: valid.length,
    nUp: up.length, nDown: down.length, nNone: valid.length - sig.length,
    nFdr: fdr.filter(Boolean).length,
    meanSlope: mean(valid.map((c) => c.slope)),
    max: by((c, b) => c.slope > b.slope), min: by((c, b) => c.slope < b.slope),
    maxAbs, opposing: up.length > 0 && down.length > 0,
  };
}

// RGBA bytes for the region texture: R = slope scaled to [0,1] around 0.5,
// G = 255 when significant, A = 255 when the cell has data.
export function regionTexture(region, range) {
  const { w, h, slope, pval, alpha } = region;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = slope[i];
    if (!isFinite(s)) continue;
    data[i * 4] = Math.round(Math.max(0, Math.min(1, s / range * 0.5 + 0.5)) * 255);
    data[i * 4 + 1] = pval[i] < alpha ? 255 : 0;
    data[i * 4 + 3] = 255;
  }
  return data;
}

// A "nice" symmetric range for a diverging scale
export function niceRange(maxAbs) {
  if (!(maxAbs > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(maxAbs));
  const m = maxAbs / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
