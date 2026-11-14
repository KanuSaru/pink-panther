// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Vercel function: NASA GISS zonal annual temperature anomalies (GISTEMP v4).
// GISS does not send CORS headers, so the browser reads the table through here.
const URL_ZONAL = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv';

export default async function handler(req, res) {
  try {
    const upstream = await fetch(URL_ZONAL, {
      headers: { 'user-agent': 'pink-panther (NASA Space Apps 2026)' },
    });
    const text = await upstream.text();
    if (!upstream.ok || !/Year\s*,/i.test(text)) return res.status(502).send('GISTEMP: unexpected response');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=2592000');
    return res.status(200).send(text);
  } catch (e) {
    return res.status(502).send(`GISTEMP unreachable: ${e.message}`);
  }
}
