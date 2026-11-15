// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Live NASA data. Every request goes straight to NASA first and falls back to
// this project's own /api proxy (Vercel functions) when the browser is blocked.

const POWER = 'https://power.larc.nasa.gov/api/temporal/monthly';
const GISTEMP_ZONAL = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

const cache = new Map();

async function request(url, { as = 'json', timeout = 60000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const body = as === 'json' ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) {
      const detail = body && typeof body === 'object'
        ? (body.messages?.join(' ') || body.header || (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body).slice(0, 200)))
        : String(body || '').slice(0, 200);
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (body == null) throw new Error('empty response');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Try each URL in order; a 4xx answer from NASA is final (the request itself is wrong).
async function firstOf(urls, opts) {
  let best;
  for (const url of urls) {
    try { return { body: await request(url, opts), url }; }
    catch (e) {
      // keep the most informative failure: an answer from NASA beats a missing proxy
      if (!best || (e.status && e.status !== 404)) best = e;
      if (e.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 429) break;
    }
  }
  throw best;
}

function qs(params) {
  return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

async function power(kind, params) {
  const q = qs({ ...params, community: 'AG', format: 'JSON' });
  const key = `${kind}?${q}`;
  if (cache.has(key)) return cache.get(key);
  const direct = `${POWER}/${kind}?${q}`;
  const { body } = await firstOf([direct, `/api/power?kind=${kind}&${q}`], { timeout: 90000 });
  const out = { body, url: direct, fetchedAt: new Date() };
  cache.set(key, out);
  return out;
}

// The monthly API serves complete years only. Early in a year the previous
// year may not be published yet, so step back once if NASA rejects the range.
async function withEndYear(fn, end) {
  try { return { ...(await fn(end)), end }; }
  catch (e) {
    if (e.status === 422 || e.status === 400) return { ...(await fn(end - 1)), end: end - 1 };
    throw e;
  }
}

export function lastCompleteYear() {
  return new Date().getFullYear() - 1;
}

export async function fetchPoint({ lat, lon, parameter, start }) {
  const r = await withEndYear((end) => power('point', {
    parameters: parameter, latitude: lat.toFixed(4), longitude: lon.toFixed(4), start, end,
  }), lastCompleteYear());
  const dict = r.body?.properties?.parameter?.[parameter];
  if (!dict) throw new Error('NASA POWER: unexpected response');
  return {
    dict,
    fill: r.body.header?.fill_value ?? -999,
    units: r.body.parameters?.[parameter]?.units,
    longname: r.body.parameters?.[parameter]?.longname,
    elevation: r.body.geometry?.coordinates?.[2],
    url: r.url, fetchedAt: r.fetchedAt,
  };
}

// Every listed variable for one point in a single request (the point service takes up to 20).
export async function fetchPointAll({ lat, lon, parameters, start }) {
  const r = await withEndYear((end) => power('point', {
    parameters: parameters.join(','), latitude: lat.toFixed(4), longitude: lon.toFixed(4), start, end,
  }), lastCompleteYear());
  const dicts = r.body?.properties?.parameter;
  if (!dicts) throw new Error('NASA POWER: unexpected response');
  return { dicts, fill: r.body.header?.fill_value ?? -999, elevation: r.body.geometry?.coordinates?.[2], url: r.url, fetchedAt: r.fetchedAt };
}

// One request for the whole box. If the regional service refuses, sample the
// box with individual points instead (slower and coarser, same data).
export async function fetchRegion({ box, parameter, start, onProgress }) {
  try {
    const r = await withEndYear((end) => power('regional', {
      parameters: parameter, 'latitude-min': box.latMin, 'latitude-max': box.latMax,
      'longitude-min': box.lonMin, 'longitude-max': box.lonMax, start, end,
    }), lastCompleteYear());
    const features = r.body?.features;
    if (!Array.isArray(features) || features.length < 4) throw new Error('NASA POWER: empty region');
    return { features, fill: r.body.header?.fill_value ?? -999, url: r.url, fetchedAt: r.fetchedAt, sampled: false };
  } catch (regionalError) {
    const n = 5, features = [];
    const pts = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      pts.push({ lat: box.latMin + ((i + 0.5) * (box.latMax - box.latMin)) / n, lon: box.lonMin + ((j + 0.5) * (box.lonMax - box.lonMin)) / n });
    }
    let done = 0, firstUrl = null, failures = 0;
    const worker = async () => {
      while (pts.length) {
        const p = pts.shift();
        try {
          const r = await fetchPoint({ ...p, parameter, start });
          firstUrl ??= r.url;
          features.push({ geometry: { coordinates: [p.lon, p.lat, r.elevation] }, properties: { parameter: { [parameter]: r.dict } } });
        } catch { failures++; }
        onProgress?.(++done, n * n);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (features.length < 9) throw regionalError;
    return { features, fill: -999, url: firstUrl, fetchedAt: new Date(), sampled: true, failures };
  }
}

// The saved copy and the live table are requested together and the first valid answer is
// used, so the planet view never waits on NASA GISS. If the live table arrives later and
// differs from the copy, `onFresh` receives it. GISS sends no CORS headers, so the live
// table can only be read through the proxy.
export async function fetchGistemp(onFresh) {
  if (cache.has('gistemp')) return cache.get('gistemp');
  const read = async (url, snapshot, timeout) => {
    const body = await request(url, { as: 'text', timeout });
    if (!/Year\s*,/i.test(body)) throw new Error('GISTEMP: unexpected response');
    return { csv: body, url: GISTEMP_ZONAL, snapshot, fetchedAt: new Date() };
  };
  const live = read('/api/gistemp', false, 30000);
  const saved = read('./data/gistemp-zonal.csv', true, 15000);
  let first;
  try { first = await Promise.any([live, saved]); }
  catch (e) { throw e.errors?.find((x) => x.status && x.status !== 404) || e.errors?.[0] || e; }
  cache.set('gistemp', first);
  if (first.snapshot) {
    live.then((fresh) => {
      cache.set('gistemp', fresh);
      if (fresh.csv.trim() !== first.csv.trim()) onFresh?.(fresh);
    }).catch(() => { /* the saved copy stays */ });
  }
  return first;
}

// Global image of one GIBS layer for one month, in the same projection as the globe textures.
export function gibsUrls(layer, year, month, width = 2048) {
  const q = qs({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer, STYLES: '', SRS: 'EPSG:4326',
    BBOX: '-180,-90,180,90', WIDTH: width, HEIGHT: width / 2, FORMAT: 'image/png', TRANSPARENT: 'TRUE',
    TIME: `${year}-${String(month).padStart(2, '0')}-01`,
  });
  return [`${GIBS_WMS}?${q}`, `/api/gibs?${q}`];
}
