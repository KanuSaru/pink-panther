// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// GLSL for the globe. Written against three.js ShaderMaterial conventions
// (position / normal / uv attributes and the standard matrices are injected).

// Atmosphere, ported to GLSL from the three.js example "webgpu_tsl_earth" (MIT):
// a fresnel rim whose colour goes from daylight blue to twilight orange with the
// sun angle, drawn on a slightly larger back-facing shell and mixed into the surface.
export const ATMO_GLSL = /* glsl */ `
const vec3 ATMO_DAY = vec3(0.302, 0.698, 1.0);       // #4db2ff
const vec3 ATMO_TWILIGHT = vec3(0.737, 0.286, 0.043); // #bc490b
vec3 atmosphereColor(float sunOrientation) {
  return mix(ATMO_TWILIGHT, ATMO_DAY, smoothstep(-0.25, 0.75, sunOrientation));
}
`;

export const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDay;       // colour map
uniform sampler2D uClouds;    // cloud cover (grey)
uniform sampler2D uNormal;    // tangent-space relief
uniform sampler2D uSpec;      // ocean mask (white = water)
uniform sampler2D uTempBase;  // surface temperature, 0..1 = 192..320 K
uniform sampler2D uPalette;   // NASA thermal palette, 192..320 K
uniform sampler2D uSat;       // NASA GIBS imagery for the selected date
uniform sampler2D uRegion;    // per-cell trend: R value, G significant, A valid

uniform vec3  uSunDir;
uniform float uMode;          // 0 natural, 1 zonal anomaly, 2 temperature, 3 satellite
uniform float uTime;
uniform float uCloudAmt;
uniform float uRelief;
uniform float uBands[8];      // zonal anomaly for the displayed year, south to north
uniform float uBandsRef[8];   // zonal anomaly of the reference decade
uniform float uBandSoft;      // degrees of blending between latitude bands
uniform float uRange;         // half-range of the diverging scale
uniform vec3  uDiv[11];       // diverging palette for the zonal layer
uniform vec3  uDivR[11];      // diverging palette for the regional trend
uniform float uStepped;       // 1 = classed colours, 0 = continuous
uniform float uOverlay;       // data opacity
uniform float uExag;          // exaggeration of the temperature change
uniform float uSatOn;
uniform vec4  uRegionBox;     // lonMin, latMin, lonMax, latMax
uniform float uRegionOn;
uniform vec3  uMarkerDir;
uniform float uMarkerOn;
uniform float uPx;           // world units per pixel at distance 1
uniform float uAtmoMix;      // atmosphere tint on the surface (natural view)

varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;

` + ATMO_GLSL + /* glsl */ `
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// Edges of the eight GISTEMP latitude bands
float bandEdge(float i) {
  if (i < 0.5) return -200.0;
  if (i < 1.5) return -64.0;
  if (i < 2.5) return -44.0;
  if (i < 3.5) return -24.0;
  if (i < 4.5) return 0.0;
  if (i < 5.5) return 24.0;
  if (i < 6.5) return 44.0;
  if (i < 7.5) return 64.0;
  return 200.0;
}

void zonal(float lat, out float val, out float refv) {
  val = 0.0;
  refv = 0.0;
  float s = max(uBandSoft, 0.01);
  for (int i = 0; i < 8; i++) {
    float a = bandEdge(float(i));
    float b = bandEdge(float(i) + 1.0);
    float w = smoothstep(a - s, a + s, lat) - smoothstep(b - s, b + s, lat);
    val += w * uBands[i];
    refv += w * uBandsRef[i];
  }
}

vec3 divA(float t) {
  float u = clamp(t * 0.5 + 0.5, 0.0, 1.0);
  if (uStepped > 0.5) { int i = int(min(floor(u * 11.0), 10.0)); return uDiv[i]; }
  float f = u * 10.0;
  int j = int(min(floor(f), 9.0));
  return mix(uDiv[j], uDiv[j + 1], f - float(j));
}

vec3 divB(float t) {
  float u = clamp(t * 0.5 + 0.5, 0.0, 1.0);
  if (uStepped > 0.5) { int i = int(min(floor(u * 11.0), 10.0)); return uDivR[i]; }
  float f = u * 10.0;
  int j = int(min(floor(f), 9.0));
  return mix(uDivR[j], uDivR[j + 1], f - float(j));
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  vec3 L = normalize(uSunDir);
  float lat = (vUv.y - 0.5) * 180.0;
  float lon = (vUv.x - 0.5) * 360.0;

  vec3 dayS = texture2D(uDay, vUv).rgb;
  float ocean = texture2D(uSpec, vUv).r;
  float lum = dot(dayS, vec3(0.299, 0.587, 0.114));
  float coast = 1.0 - smoothstep(0.5, 1.4, abs(ocean - 0.5) / max(fwidth(ocean), 1e-4));

  // ---- natural view: relief, ocean glint, drifting clouds ----
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-6, 0.0, 0.0));
  vec3 B = cross(N, T);
  vec3 nm = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec3 Nn = normalize(N + uRelief * (T * nm.x + B * nm.y));
  float hl = clamp(dot(Nn, L) * 0.5 + 0.5, 0.0, 1.0);
  float light = 0.08 + 1.12 * hl * hl;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * ocean * 0.30 * step(0.0, dot(N, L));
  vec3 nat = toLinear(dayS) * light + vec3(spec);
  float cl = texture2D(uClouds, vec2(vUv.x + uTime * 0.0012, vUv.y)).r;
  float hlc = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  nat = mix(nat, vec3(0.06 + 1.0 * hlc * hlc), cl * uCloudAmt);
  vec3 col = toDisplay(nat);
  float sunOrientation = dot(N, L);
  float fresnel = 1.0 - abs(dot(V, N));
  float atmoMix = clamp(smoothstep(-0.5, 1.0, sunOrientation) * fresnel * fresnel, 0.0, 1.0);
  col = mix(col, atmosphereColor(sunOrientation), atmoMix * uAtmoMix);

  // ---- data views: quiet grey base, data on top, coastlines over the data ----
  vec3 base = vec3(0.10 + 0.45 * lum) * mix(1.0, 0.72, ocean);
  if (uMode > 0.5) {
    vec3 data = base;
    float a = 0.0;
    if (uMode < 1.5) {
      float v; float r;
      zonal(lat, v, r);
      data = divA(v / uRange);
      a = uOverlay;
    } else if (uMode < 2.5) {
      float v; float r;
      zonal(lat, v, r);
      float k = texture2D(uTempBase, vUv).r;
      float t = clamp(k + (v - r) * uExag / 128.0, 0.0, 1.0);
      data = texture2D(uPalette, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
      a = uOverlay;
    } else {
      vec4 s = texture2D(uSat, vUv);
      data = s.rgb;
      a = s.a * uOverlay * uSatOn;
    }
    col = mix(base, data, a);
    col = mix(col, vec3(0.03), coast * 0.6);
    col *= 0.84 + 0.16 * clamp(dot(N, V), 0.0, 1.0);
  }

  // ---- regional trend patch (drawn in every view) ----
  if (uRegionOn > 0.5) {
    vec2 q = vec2((lon - uRegionBox.x) / (uRegionBox.z - uRegionBox.x),
                  (lat - uRegionBox.y) / (uRegionBox.w - uRegionBox.y));
    if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
      vec4 r = texture2D(uRegion, q);
      if (r.a > 0.5) {
        vec3 rc = divB(r.r * 2.0 - 1.0);
        if (r.g < 0.5) {
          // not significant: hatch the cell so only robust change reads as solid colour
          float h = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
          rc = mix(rc, base, 0.2 + 0.65 * h);
        }
        col = mix(col, rc, 0.94);
        col = mix(col, vec3(0.03), coast * 0.6);
      }
    }
    vec2 d = min(q, 1.0 - q);
    vec2 fw = min(fwidth(q), vec2(0.02));
    float lineX = 1.0 - smoothstep(fw.x, fw.x * 2.0, abs(d.x));
    float lineY = 1.0 - smoothstep(fw.y, fw.y * 2.0, abs(d.y));
    float outline = max(lineX * step(-fw.y * 2.0, d.y), lineY * step(-fw.x * 2.0, d.x));
    col = mix(col, vec3(1.0), outline);
  }

  // ---- selected point ----
  if (uMarkerOn > 0.5) {
    float ang = distance(N, normalize(uMarkerDir));
    float px = max(uPx * length(cameraPosition - vPos), 1e-5);
    float rr = max(0.012, px * 9.0);
    float stroke = 1.0 - smoothstep(px * 2.4, px * 3.6, abs(ang - rr));
    float ring = 1.0 - smoothstep(px * 1.0, px * 2.0, abs(ang - rr));
    float dotc = 1.0 - smoothstep(px * 2.0, px * 3.0, ang);
    col = mix(col, vec3(0.0), stroke * 0.85);
    col = mix(col, vec3(1.0), max(ring, dotc));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export const ATMO_VERT = /* glsl */ `
varying vec3 vNw;
varying vec3 vPw;
void main() {
  vNw = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPw = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATMO_FRAG = /* glsl */ `
uniform float uAtmo;
uniform vec3 uSunDir;
varying vec3 vNw;
varying vec3 vPw;
` + ATMO_GLSL + /* glsl */ `
void main() {
  vec3 N = normalize(vNw);
  vec3 V = normalize(cameraPosition - vPw);
  float fresnel = 1.0 - abs(dot(V, N));
  float sunOrientation = dot(N, normalize(uSunDir));
  // opaque where the shell meets the planet (fresnel 0.73), gone at its outer edge
  float alpha = pow(clamp((1.0 - fresnel) / 0.27, 0.0, 1.0), 3.0) * smoothstep(-0.5, 1.0, sunOrientation);
  gl_FragColor = vec4(atmosphereColor(sunOrientation), alpha * uAtmo);
}
`;

export const ATMO_SCALE = 1.04;

export function earthUniformDefaults() {
  return {
    uSunDir: [1, 0.4, 0.6],
    uMode: 0,
    uTime: 0,
    uCloudAmt: 0.85,
    uRelief: 0.7,
    uBands: new Float32Array(8),
    uBandsRef: new Float32Array(8),
    uBandSoft: 2.0,
    uRange: 3,
    uDiv: new Float32Array(33),
    uDivR: new Float32Array(33),
    uStepped: 1,
    uOverlay: 0.92,
    uExag: 1,
    uSatOn: 0,
    uRegionBox: [0, 0, 1, 1],
    uRegionOn: 0,
    uMarkerDir: [1, 0, 0],
    uMarkerOn: 0,
    uPx: 0.001,
    uAtmoMix: 1,
  };
}

export const EARTH_SAMPLERS = ['uDay', 'uClouds', 'uNormal', 'uSpec', 'uTempBase', 'uPalette', 'uSat', 'uRegion'];
