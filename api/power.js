// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Vercel function: same-origin proxy for the NASA POWER monthly API.
// Used only when the browser cannot reach NASA directly. Responses are cached at the edge.
const ALLOWED = new Set(['parameters', 'community', 'format', 'start', 'end', 'latitude', 'longitude',
  'latitude-min', 'latitude-max', 'longitude-min', 'longitude-max']);

export default async function handler(req, res) {
  const { kind = 'point', ...query } = req.query;
  if (kind !== 'point' && kind !== 'regional') return res.status(400).json({ messages: ['kind must be point or regional'] });
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (ALLOWED.has(k) && typeof v === 'string' && v.length < 200) params.set(k, v);
  params.set('format', 'JSON');
  try {
    const upstream = await fetch(`https://power.larc.nasa.gov/api/temporal/monthly/${kind}?${params}`, {
      headers: { 'user-agent': 'pink-panther (NASA Space Apps 2026)' },
    });
    const text = await upstream.text();
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (upstream.ok) res.setHeader('cache-control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ messages: [`NASA POWER unreachable: ${e.message}`] });
  }
}
