// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Vercel function: proxy for NASA GIBS WMS images, used only if the browser
// cannot load them directly as WebGL textures.
const ALLOWED = new Set(['SERVICE', 'VERSION', 'REQUEST', 'LAYERS', 'STYLES', 'SRS', 'BBOX', 'WIDTH', 'HEIGHT', 'FORMAT', 'TRANSPARENT', 'TIME']);

export default async function handler(req, res) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) if (ALLOWED.has(k) && typeof v === 'string' && v.length < 120) params.set(k, v);
  if (params.get('REQUEST') !== 'GetMap' || Number(params.get('WIDTH')) > 4096) return res.status(400).send('bad request');
  try {
    const upstream = await fetch(`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`);
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return res.status(502).send('GIBS: no image for this layer and date');
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, s-maxage=2592000, immutable');
    return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    return res.status(502).send(`GIBS unreachable: ${e.message}`);
  }
}
