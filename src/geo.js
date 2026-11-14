// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Coordinate helpers shared by the renderer and the UI.
// Convention (matches THREE.SphereGeometry with an equirectangular texture):
// longitude 0 faces +X, longitude -90 faces +Z, north is +Y.

const RAD = Math.PI / 180;

export function latLonToVec3(lat, lon) {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), Math.sin(lat * RAD), -c * Math.sin(lon * RAD)];
}

export function vec3ToLatLon([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / r) / RAD, lon: Math.atan2(-z, x) / RAD };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function formatLatLon(lat, lon, locale = 'en') {
  const f = (v, pos, neg) => `${Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')}, ${f(lon, 'E', 'W')}`;
}

// A box of `size` degrees centred on a point, kept inside the map and off the antimeridian
export function boxAround(lat, lon, size) {
  const h = size / 2;
  const cLat = clamp(lat, -90 + h, 90 - h);
  const cLon = clamp(lon, -180 + h, 180 - h);
  const r = (v) => Math.round(v * 2) / 2;
  return { latMin: r(cLat - h), latMax: r(cLat - h) + size, lonMin: r(cLon - h), lonMax: r(cLon - h) + size };
}
