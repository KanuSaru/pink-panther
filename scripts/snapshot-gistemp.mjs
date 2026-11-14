// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Optional: save a local copy of the GISTEMP zonal table so the planet view
// still works if the live source is unreachable during a demo.
// Run on a machine with internet access:  npm run snapshot
import { mkdir, writeFile } from 'node:fs/promises';

const url = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv';
// GISS closes the connection on requests without a user agent
const res = await fetch(url, { headers: { 'user-agent': 'observatorio-inteligente-de-la-tierra (NASA Space Apps 2026)' } });
const text = await res.text();
if (!res.ok || !/Year\s*,/i.test(text)) throw new Error(`Unexpected response from ${url}`);
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/gistemp-zonal.csv', import.meta.url), text);
console.log(`Saved ${text.trim().split('\n').length - 1} rows to data/gistemp-zonal.csv`);
