// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Energy balance model used for the planet projections.
//
// A two-layer diffusive energy balance model on a latitude-longitude grid:
//
//   C(x) dT/dt  = F(t) - lambda(lat) T - gamma o(x) (T - Td) + D lap(T)      surface
//   Cd   dTd/dt = gamma (T - Td)                                             deep ocean
//
// T is the surface temperature anomaly relative to 1880-1900, o(x) the ocean
// fraction of the cell, lap the Laplacian on the sphere. The same equations run
// on the GPU (src/shaders.js, SIM_FRAG); this file is the reference version,
// used for the chart, for tests, and as the fallback when the GPU cannot
// render to floating-point textures.
//
// Nothing here is tuned by hand to give a nice answer. The present-day state,
// the deep-ocean lag and the latitude profile of the feedback lambda(lat) are
// all diagnosed from the observed NASA GISTEMP record (see calibrate()).

export const EBM = {
  F2X: 3.93,       // W/m2, forcing of doubled CO2 (IPCC AR6 WG1 ch. 7)
  D: 0.6,          // W/m2/K, horizontal heat diffusion (North, 1975 class of models)
  CAP: 0.5,        // floor on cos(lat) in the zonal term, keeps the explicit step stable near the poles
  C_LAND: 2.0,     // W yr/m2/K, land + atmosphere column
  C_MIX: 9.5,      // W yr/m2/K, ocean mixed layer  \  chosen so the global means equal the
  C_DEEP: 150,     // W yr/m2/K, deep ocean          > CMIP5 multi-model two-layer fit of
  GAMMA: 1.03,     // W/m2/K, surface-deep exchange /  Geoffroy et al. (2013): C 7.3, C0 106, gamma 0.73
  PI: [1880, 1900],        // reference period standing in for "pre-industrial"
  ECS_LIKELY: [2.5, 4.0],  // IPCC AR6 likely range of equilibrium climate sensitivity
  ECS_BEST: 3.0,
  LAMBDA_RANGE: [-4.0, 6.0], // local feedback may be amplifying (negative) where ice and snow retreat
  DEGREE: 5,                 // Legendre degree of the smooth latitude profiles
};

export const BAND_CENTERS = [-77, -54, -34, -12, 12, 34, 54, 77];
const BAND_EDGES = [-90, -64, -44, -24, 0, 24, 44, 64, 90];
const RAD = Math.PI / 180;

export function makeGrid(W, H) {
  const dphi = Math.PI / H, dlam = (2 * Math.PI) / W;
  const phi = new Float64Array(H), c = new Float64Array(H), cp = new Float64Array(H), cm = new Float64Array(H), w = new Float64Array(H);
  let sum = 0;
  for (let j = 0; j < H; j++) {
    phi[j] = -Math.PI / 2 + (j + 0.5) * dphi;
    c[j] = Math.cos(phi[j]);
    cp[j] = Math.max(0, Math.cos(phi[j] + dphi / 2));
    cm[j] = Math.max(0, Math.cos(phi[j] - dphi / 2));
    sum += c[j];
  }
  for (let j = 0; j < H; j++) w[j] = c[j] / sum;
  return { W, H, dphi, dlam, phi, c, cp, cm, w };
}

// Legendre polynomials P0..Pn at x = sin(latitude): the natural smooth basis on a sphere
function legendre(x, n) {
  const p = [1, x];
  for (let k = 2; k <= n; k++) p.push(((2 * k - 1) * x * p[k - 1] - (k - 1) * p[k - 2]) / k);
  return p.slice(0, n + 1);
}

// Coefficients of the smooth latitude profile whose band means best fit the eight
// observed band means (least squares). Band means are exact averages over sin(lat),
// which is how area is distributed on a sphere.
export function fitBands(vals, degree = EBM.DEGREE) {
  const n = degree + 1, A = [];
  for (let k = 0; k < 8; k++) {
    const x0 = Math.sin(BAND_EDGES[k] * RAD), x1 = Math.sin(BAND_EDGES[k + 1] * RAD), m = 64, row = new Array(n).fill(0);
    for (let s = 0; s < m; s++) legendre(x0 + ((s + 0.5) / m) * (x1 - x0), degree).forEach((v, i) => { row[i] += v / m; });
    A.push(row);
  }
  // normal equations, weighted by band area
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < 8; k++) {
    const w = Math.sin(BAND_EDGES[k + 1] * RAD) - Math.sin(BAND_EDGES[k] * RAD);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] += w * A[k][i] * A[k][j]; M[i][n] += w * A[k][i] * vals[k]; }
  }
  for (let i = 0; i < n; i++) { // Gaussian elimination with pivoting
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Eight band values -> one value per grid row, through the smooth fit
export function bandsToRows(vals, g) {
  const coef = fitBands(vals);
  return Float64Array.from(g.phi, (ph) => legendre(Math.sin(ph), coef.length - 1).reduce((s, v, i) => s + v * coef[i], 0));
}

// One value per row -> area-weighted mean in each of the eight bands
export function rowsToBands(rows, g) {
  const sum = new Float64Array(8), wt = new Float64Array(8);
  for (let j = 0; j < g.H; j++) {
    const lat = g.phi[j] / RAD;
    let k = 0;
    while (k < 7 && lat >= BAND_EDGES[k + 1]) k++;
    sum[k] += rows[j] * g.w[j]; wt[k] += g.w[j];
  }
  return Array.from(sum, (s, k) => (wt[k] > 0 ? s / wt[k] : NaN));
}

export function rowMeans(field, g) {
  const out = new Float64Array(g.H);
  for (let j = 0; j < g.H; j++) {
    let s = 0;
    for (let i = 0; i < g.W; i++) s += field[j * g.W + i];
    out[j] = s / g.W;
  }
  return out;
}

const weighted = (rows, g) => rows.reduce((s, v, j) => s + v * g.w[j], 0);

// Meridional diffusion of a zonally uniform profile, per row
function meridional(T, g) {
  const out = new Float64Array(g.H);
  for (let j = 0; j < g.H; j++) {
    const n = T[Math.min(j + 1, g.H - 1)], s = T[Math.max(j - 1, 0)];
    out[j] = (g.cp[j] * (n - T[j]) - g.cm[j] * (T[j] - s)) / (g.dphi * g.dphi * g.c[j]);
  }
  return out;
}

// Equilibrium response to a uniform forcing F. At equilibrium the deep ocean
// has caught up and the state is zonally uniform, so this is a tridiagonal
// system in latitude: lambda_j T_j - D lap(T)_j = F.
export function equilibriumMean(g, lam, F) {
  const H = g.H, a = new Float64Array(H), b = new Float64Array(H), c = new Float64Array(H), d = new Float64Array(H);
  for (let j = 0; j < H; j++) {
    const k = EBM.D / (g.dphi * g.dphi * g.c[j]);
    const up = j < H - 1 ? k * g.cp[j] : 0, dn = j > 0 ? k * g.cm[j] : 0;
    a[j] = -dn; c[j] = -up; b[j] = lam[j] + up + dn; d[j] = F;
  }
  if (!(b[0] > 0)) return Infinity;
  for (let j = 1; j < H; j++) {
    const m = a[j] / b[j - 1]; b[j] -= m * c[j - 1]; d[j] -= m * d[j - 1];
    if (!(b[j] > 0)) return Infinity; // not positive definite: amplifying feedbacks win over transport
  }
  const T = new Float64Array(H);
  T[H - 1] = d[H - 1] / b[H - 1];
  for (let j = H - 2; j >= 0; j--) T[j] = (d[j] - c[j] * T[j + 1]) / b[j];
  return weighted(T, g);
}

// Largest stable explicit time step (years), with a safety margin
export function stableDt(g, lamMax) {
  let worst = 0;
  for (let j = 0; j < g.H; j++) {
    const zonal = 2 / (g.dlam * g.dlam * Math.max(g.c[j] * g.c[j], EBM.CAP * EBM.CAP));
    const merid = (g.cp[j] + g.cm[j]) / (g.dphi * g.dphi * g.c[j]);
    worst = Math.max(worst, EBM.D * (zonal + merid) + lamMax + EBM.GAMMA);
  }
  return (0.8 * EBM.C_LAND) / worst;
}

// Diagnose the model's state and parameters from observations.
//   obs.years, obs.bands[8][]: annual zonal anomalies (GISTEMP, any fixed baseline)
//   obs.present[8]:            value of each band's fitted trend line in the last year
//   obs.rate[8]:               present warming rate of each band, K per year
//   ocean:                     ocean fraction per cell (W*H, row 0 = south)
// Returns everything both solvers need.
export function calibrate({ obs, ocean, W, H, ecs = EBM.ECS_BEST }) {
  const g = makeGrid(W, H);
  const y0 = obs.years[0], yN = obs.years.at(-1);

  // reference level of each band: its 1880-1900 mean
  const pi = obs.bands.map((b) => {
    const v = b.filter((_, i) => obs.years[i] >= EBM.PI[0] && obs.years[i] <= EBM.PI[1]);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  });

  // deep-ocean anomaly today: integrate the deep-layer equation with the OBSERVED surface record
  const td = obs.bands.map((b, k) => {
    let Td = 0;
    for (let i = 0; i < b.length; i++) Td += (EBM.GAMMA / EBM.C_DEEP) * (b[i] - pi[k] - Td);
    return Td;
  });

  const oRow = rowMeans(ocean, g);
  const T0 = bandsToRows(obs.present.map((v, k) => v - pi[k]), g);
  const Td0 = bandsToRows(td, g);
  const rate = bandsToRows(obs.rate, g);
  const Crow = Array.from(oRow, (o) => EBM.C_LAND + (EBM.C_MIX - EBM.C_LAND) * o);
  const storage = Crow.map((C, j) => C * rate[j]);                         // heat going into the surface layer
  const uptake = Array.from(oRow, (o, j) => EBM.GAMMA * o * (T0[j] - Td0[j])); // heat going into the deep ocean
  const diff = meridional(T0, g).map((v) => v * EBM.D);
  const N0 = weighted(storage, g) + weighted(uptake, g);                   // present energy imbalance
  const meanT0 = weighted(T0, g);

  // For a given global feedback lamG: the present forcing that closes the global
  // budget, then the feedback each latitude needs to close ITS budget today.
  const profile = (lamG) => {
    const F0 = N0 + lamG * meanT0;
    const lam = new Float64Array(H);
    for (let j = 0; j < H; j++) {
      const v = (F0 - storage[j] - uptake[j] + diff[j]) / Math.max(T0[j], 0.2);
      lam[j] = Math.max(EBM.LAMBDA_RANGE[0], Math.min(EBM.LAMBDA_RANGE[1], v));
    }
    return { F0, lam };
  };

  // Choose lamG so that the model's equilibrium warming for doubled CO2 is exactly the requested ECS
  // (a weaker global feedback always means a more sensitive, eventually unstable, model)
  let lo = 0.05, hi = 8, lamG = EBM.F2X / ecs;
  const sens = (x) => equilibriumMean(g, profile(x).lam, EBM.F2X);
  if (sens(hi) < ecs) {
    for (let it = 0; it < 60; it++) {
      lamG = (lo + hi) / 2;
      if (sens(lamG) > ecs) lo = lamG; else hi = lamG;
    }
    lamG = hi; // the stable side of the bracket
  }
  let { F0, lam } = profile(lamG);
  let ok = [F0, N0, meanT0, ...lam, ...T0, ...Td0].every(Number.isFinite) && meanT0 > 0.1;
  if (!ok) { // observations unusable: fall back to a uniform feedback and a state of rest
    lam = new Float64Array(H).fill(EBM.F2X / ecs); F0 = 0; T0.fill(0); Td0.fill(0);
  }
  const lamMax = Math.max(...lam);
  return {
    g, ok, ecs, t0: yN, y0, pi, piRows: bandsToRows(pi, g), T0, Td0, lam, lamG, F0, N0, meanT0,
    ecsModel: equilibriumMean(g, lam, EBM.F2X), dt: stableDt(g, lamMax),
  };
}

// Forcing pathway: a straight line from today's diagnosed forcing to the chosen 2100 level
export function forcingAt(year, cal, f2100, tEnd = 2100) {
  const k = Math.max(0, Math.min(1, (year - cal.t0) / (tEnd - cal.t0)));
  return cal.F0 + (f2100 - cal.F0) * k;
}

export class Model {
  constructor(cal, ocean) {
    this.cal = cal; this.g = cal.g; this.ocean = ocean;
    const n = this.g.W * this.g.H;
    this.T = new Float64Array(n); this.Td = new Float64Array(n); this.next = new Float64Array(n);
    this.reset();
  }

  reset() {
    const { W, H } = this.g;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { this.T[j * W + i] = this.cal.T0[j]; this.Td[j * W + i] = this.cal.Td0[j]; }
    this.year = this.cal.t0;
  }

  // n explicit Euler steps of size dt under a constant forcing F
  step(n, dt, F) {
    const { W, H, dphi, dlam, c, cp, cm } = this.g, lam = this.cal.lam, o = this.ocean;
    for (let s = 0; s < n; s++) {
      const T = this.T, Td = this.Td, out = this.next;
      for (let j = 0; j < H; j++) {
        const zk = 1 / (dlam * dlam * Math.max(c[j] * c[j], EBM.CAP * EBM.CAP));
        const mk = 1 / (dphi * dphi * c[j]);
        const jn = Math.min(j + 1, H - 1) * W, js = Math.max(j - 1, 0) * W, row = j * W;
        for (let i = 0; i < W; i++) {
          const k = row + i, t = T[k];
          const e = T[row + (i + 1) % W], w = T[row + (i + W - 1) % W];
          const lap = (e - 2 * t + w) * zk + (cp[j] * (T[jn + i] - t) - cm[j] * (t - T[js + i])) * mk;
          const ex = EBM.GAMMA * (t - Td[k]);
          const C = EBM.C_LAND + (EBM.C_MIX - EBM.C_LAND) * o[k];
          out[k] = t + (dt / C) * (F - lam[j] * t - o[k] * ex + EBM.D * lap);
          Td[k] += (dt / EBM.C_DEEP) * ex;
        }
      }
      this.next = T; this.T = out;
    }
  }

  // advance one calendar year, forcing held at its mid-year value
  advanceYear(f2100) {
    const n = Math.ceil(1 / this.cal.dt);
    this.step(n, 1 / n, forcingAt(this.year + 0.5, this.cal, f2100));
    this.year += 1;
  }

  rows() { return rowMeans(this.T, this.g); }
  mean() { return weighted(this.rows(), this.g); }
}

// Run to tEnd and keep, for every year, the global mean and the eight band means.
// Values are returned in the observations' own baseline (the pre-industrial offset is added back).
export function project(cal, ocean, f2100, tEnd = 2100) {
  const m = new Model(cal, ocean);
  const years = [], global = [], bands = [];
  const record = () => {
    const rows = m.rows();
    const native = rows.map((v, j) => v + cal.piRows[j]);
    years.push(m.year); global.push(weighted(native, cal.g)); bands.push(rowsToBands(native, cal.g));
  };
  record();
  while (m.year < tEnd) { m.advanceYear(f2100); record(); }
  return { years, global, bands, warmingSincePI: m.mean() };
}
