// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Build assets/temp_base.png, the base field of the Temperature view, from the
// NASA POWER climatology of surface temperature (TS, MERRA-2, annual mean).
// The same source as the point analysis, so the map and the numbers agree.
//
// Encoding: 720 x 360, 8-bit grey, north at the top, longitude -180 at the left
// edge, value = round((K - 192) / 128 * 255).
//
// The climatology service answers for boxes of at most 10 x 10 degrees, so this
// makes 648 small requests (a few minutes). Answers are cached in .tmp/power-ts/.
// Run on a machine with internet access:  npm run temp-base
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const W = 720, H = 360, K0 = 192, KSPAN = 128;
const NLON = 576, NLAT = 361;             // MERRA-2 grid: 0.625 x 0.5 degrees
const cache = new URL('../.tmp/power-ts/', import.meta.url);
await mkdir(cache, { recursive: true });

const grid = new Float32Array(NLON * NLAT).fill(NaN); // row 0 = 90 S, column 0 = 180 W
let period = null;

async function tile(lat0, lon0) {
  const file = new URL(`${lat0}_${lon0}.json`, cache);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not cached yet */ }
  // The service returns the points above the lower bounds and up to the upper ones, so
  // 10-degree boxes tile the globe; 180 E is the same meridian as 180 W (wrapped below).
  const q = new URLSearchParams({
    parameters: 'TS', community: 'AG', format: 'JSON',
    'latitude-min': lat0, 'latitude-max': lat0 + 10, 'longitude-min': lon0, 'longitude-max': lon0 + 10,
  });
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/regional?${q}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const out = {
        start: json.header.start, end: json.header.end, fill: json.header.fill_value,
        points: json.features.map((f) => [f.geometry.coordinates[0], f.geometry.coordinates[1], f.properties.parameter.TS.ANN]),
      };
      await writeFile(file, JSON.stringify(out));
      return out;
    } catch (e) {
      if (attempt >= 5) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const jobs = [];
for (let lat0 = -90; lat0 < 90; lat0 += 10) for (let lon0 = -180; lon0 < 180; lon0 += 10) jobs.push([lat0, lon0]);
let done = 0;
async function worker() {
  for (let job; (job = jobs.pop());) {
    const t = await tile(...job);
    period ??= [t.start.slice(0, 4), t.end.slice(0, 4)];
    for (const [lon, lat, v] of t.points) {
      if (v === t.fill || v == null) continue;
      const i = Math.round((lon + 180) / 0.625) % NLON, j = Math.round((lat + 90) / 0.5);
      if (i >= 0 && j >= 0 && j < NLAT) grid[j * NLON + i] = v + 273.15;
    }
    if (++done % 50 === 0) console.log(`${done} / 648 boxes`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

// Rows the service does not return (a pole) take the nearest row; anything else missing is an error.
for (const [j, from] of [[0, 1], [NLAT - 1, NLAT - 2]]) {
  for (let i = 0; i < NLON; i++) if (Number.isNaN(grid[j * NLON + i])) grid[j * NLON + i] = grid[from * NLON + i];
}
const missing = grid.reduce((n, v) => n + Number.isNaN(v), 0);
if (missing) throw new Error(`${missing} grid points have no value`);

// Bilinear resampling to pixel centres, wrapping in longitude
const px = Buffer.alloc(W * H);
let lo = Infinity, hi = -Infinity, sum = 0, wsum = 0;
for (let y = 0; y < H; y++) {
  const lat = 90 - (y + 0.5) * (180 / H);
  const fj = (lat + 90) / 0.5, j0 = Math.min(NLAT - 2, Math.floor(fj)), tj = fj - j0;
  for (let x = 0; x < W; x++) {
    const lon = -180 + (x + 0.5) * (360 / W);
    const fi = (lon + 180) / 0.625, i0 = Math.floor(fi) % NLON, i1 = (i0 + 1) % NLON, ti = fi - Math.floor(fi);
    const k = (grid[j0 * NLON + i0] * (1 - ti) + grid[j0 * NLON + i1] * ti) * (1 - tj)
            + (grid[(j0 + 1) * NLON + i0] * (1 - ti) + grid[(j0 + 1) * NLON + i1] * ti) * tj;
    px[y * W + x] = Math.max(0, Math.min(255, Math.round(((k - K0) / KSPAN) * 255)));
    lo = Math.min(lo, k); hi = Math.max(hi, k);
    const w = Math.cos((lat * Math.PI) / 180); sum += k * w; wsum += w;
  }
}

// Minimal PNG writer: 8-bit greyscale, no filtering
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sumBuf = Buffer.alloc(4); sumBuf.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sumBuf]);
};
const head = Buffer.alloc(13);
head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 0; // 8 bits, greyscale
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
await writeFile(new URL('../assets/temp_base.png', import.meta.url), png);
console.log(`assets/temp_base.png: ${W} x ${H}, climatology ${period[0]}-${period[1]}, ${lo.toFixed(1)} to ${hi.toFixed(1)} K, global mean ${(sum / wsum).toFixed(2)} K`);
