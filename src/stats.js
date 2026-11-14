// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Statistics for trend detection. Pure functions, no dependencies.
// Methods: OLS regression, Mann-Kendall (tie- and autocorrelation-corrected),
// Theil-Sen slope with confidence interval, Welch t-test, Benjamini-Hochberg FDR.

export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export function variance(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
}

export const sd = (a) => Math.sqrt(variance(a));

export function median(a) {
  const s = [...a].sort((p, q) => p - q);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------- distributions ----------

function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

// Regularized incomplete beta function I_x(a, b)
export function ibeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// Two-sided p-value of Student's t
export function tTwoSidedP(t, df) {
  if (!isFinite(t)) return 0;
  if (!(df > 0)) return NaN;
  return ibeta(df / 2, 0.5, df / (df + t * t));
}

// Quantile of |t| for a two-sided confidence level (e.g. 0.95)
export function tQuantile(conf, df) {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (1 - tTwoSidedP(mid, df) < conf) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function normalCdf(z) {
  // Abramowitz-Stegun 7.1.26 on erf, |error| < 1.5e-7
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function normalQuantile(p) {
  // Acklam's algorithm
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------- regression ----------

export function ols(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const xm = mean(x), ym = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xm) ** 2;
    sxy += (x[i] - xm) * (y[i] - ym);
    syy += (y[i] - ym) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  const sse = Math.max(0, syy - slope * sxy);
  const df = n - 2;
  const s = Math.sqrt(sse / df);
  const seSlope = s / Math.sqrt(sxx);
  const t = seSlope > 0 ? slope / seSlope : (slope === 0 ? 0 : Infinity);
  return {
    n, slope, intercept, df, s, seSlope, t, xMean: xm, sxx,
    r2: syy > 0 ? 1 - sse / syy : 0,
    p: tTwoSidedP(t, df),
    predict: (x0) => intercept + slope * x0,
  };
}

// Half-width of the prediction interval for a single new observation at x0
export function predictionHalfWidth(fit, x0, conf = 0.95) {
  const tq = tQuantile(conf, fit.df);
  return tq * fit.s * Math.sqrt(1 + 1 / fit.n + (x0 - fit.xMean) ** 2 / fit.sxx);
}

// ---------- non-parametric trend ----------

export function lag1(y) {
  const n = y.length;
  if (n < 4) return 0;
  const m = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (y[i] - m) ** 2;
    if (i > 0) num += (y[i] - m) * (y[i - 1] - m);
  }
  return den > 0 ? num / den : 0;
}

export function theilSen(x, y, alpha = 0.05, varS = null) {
  const n = x.length;
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    }
  }
  if (!slopes.length) return null;
  slopes.sort((p, q) => p - q);
  const slope = median(slopes);
  const intercept = median(y.map((v, i) => v - slope * x[i]));
  let lo = NaN, hi = NaN;
  if (varS != null && varS > 0) {
    const N = slopes.length;
    const C = normalQuantile(1 - alpha / 2) * Math.sqrt(varS);
    const m1 = Math.max(0, Math.round((N - C) / 2) - 1);
    const m2 = Math.min(N - 1, Math.round((N + C) / 2));
    lo = slopes[m1]; hi = slopes[m2];
  }
  return { slope, intercept, lo, hi, predict: (x0) => intercept + slope * x0 };
}

// Mann-Kendall test. `correct` applies the Yue & Wang (2004) variance
// correction when the lag-1 autocorrelation of the detrended series is
// positive and significant, which otherwise inflates significance.
export function mannKendall(x, y, { correct = true } = {}) {
  const n = y.length;
  if (n < 4) return null;
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) S += Math.sign(y[j] - y[i]);
  }
  const counts = new Map();
  for (const v of y) counts.set(v, (counts.get(v) || 0) + 1);
  let tieTerm = 0;
  for (const t of counts.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  let varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  const sen = theilSen(x, y);
  const resid = y.map((v, i) => v - (sen ? sen.slope * x[i] : 0));
  const r1 = lag1(resid);
  let corrected = false, nEff = n;
  if (correct && r1 > 1.96 / Math.sqrt(n) && r1 < 1) {
    nEff = (n * (1 - r1)) / (1 + r1);
    varS *= n / nEff;
    corrected = true;
  }
  const z = varS > 0 ? (S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { n, S, varS, z, p, tau: S / ((n * (n - 1)) / 2), r1, nEff, corrected };
}

// ---------- comparisons ----------

export function welch(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const va = variance(a) / a.length, vb = variance(b) / b.length;
  const diff = mean(b) - mean(a);
  const se = Math.sqrt(va + vb);
  const t = se > 0 ? diff / se : (diff === 0 ? 0 : Infinity);
  const df = se > 0 ? (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1)) : a.length + b.length - 2;
  return { diff, t, df, p: tTwoSidedP(t, df), meanA: mean(a), meanB: mean(b) };
}

// Benjamini-Hochberg: which hypotheses stay significant at false discovery rate q
export function benjaminiHochberg(pvals, q = 0.05) {
  const idx = pvals.map((p, i) => [p, i]).filter(([p]) => isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length;
  let k = -1;
  idx.forEach(([p], r) => { if (p <= ((r + 1) / m) * q) k = r; });
  const out = pvals.map(() => false);
  for (let r = 0; r <= k; r++) out[idx[r][1]] = true;
  return out;
}

// ---------- abrupt change ----------

// Pettitt (1979) test for a single change point in the median of a series.
// `index` is the last position of the first segment; p uses Pettitt's approximation.
export function pettitt(y) {
  const n = y.length;
  if (n < 8) return null;
  let U = 0, K = 0, index = -1;
  for (let k = 0; k < n - 1; k++) {
    // U_k = U_{k-1} + sum_j sign(y_k - y_j)
    for (let j = 0; j < n; j++) U += Math.sign(y[k] - y[j]);
    if (Math.abs(U) > K) { K = Math.abs(U); index = k; }
  }
  if (index < 0) return { index: -1, K: 0, p: 1 };
  return { index, K, p: Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2))) };
}

// Do two independent regression slopes differ? Normal approximation on their standard errors.
export function slopeDifference(fitA, fitB) {
  const se = Math.hypot(fitA.seSlope, fitB.seSlope);
  const diff = fitB.slope - fitA.slope;
  const z = se > 0 ? diff / se : (diff === 0 ? 0 : Infinity);
  return { diff, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}
