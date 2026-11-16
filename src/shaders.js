// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// GLSL for the globe. Written against three.js ShaderMaterial conventions
// (position / normal / uv attributes and the standard matrices are injected).

// Atmosphere: single scattering of sunlight by air (Rayleigh) and haze (Mie), integrated
// along the view ray in a few steps. The same function tints the surface seen through the
// air and draws the glow of the limb on a slightly larger back-facing shell. The path to
// the sun is not marched: its optical depth comes from the local density and an air-mass
// factor, which is what keeps this cheap. Lengths are in planet radii; the shell is
// thicker than the real atmosphere so that it covers more than a pixel.
export const ATMO_GLSL = /* glsl */ `
const float ATMO_TOP = 1.04;
const float ATMO_HR = 0.010;                       // scale height of air
const float ATMO_HM = 0.004;                       // scale height of haze
const vec3  ATMO_TAU_R = vec3(0.046, 0.108, 0.265); // vertical optical depth of Earth's air: red, green, blue
const float ATMO_TAU_M = 0.05;                     // and of a clear-sky haze
const float ATMO_SUN = 8.0;
const int   ATMO_STEPS = 8;

void atmosphere(vec3 ro, vec3 rd, float tEnd, vec3 L, out vec3 inscatter, out vec3 trans) {
  inscatter = vec3(0.0);
  trans = vec3(1.0);
  float b = dot(ro, rd);
  float disc = b * b - dot(ro, ro) + ATMO_TOP * ATMO_TOP;
  if (disc <= 0.0) return;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = min(-b + sq, tEnd);
  if (t1 <= t0) return;
  float dt = (t1 - t0) / float(ATMO_STEPS);
  float mu = dot(rd, L);
  float phaseR = 0.0596831 * (1.0 + mu * mu);
  float phaseM = 0.0795775 * 0.4224 / pow(1.5776 - 1.52 * mu, 1.5); // Henyey-Greenstein, g = 0.76
  vec3 betaR = ATMO_TAU_R / ATMO_HR;
  float betaM = ATMO_TAU_M / ATMO_HM;
  float odR = 0.0;
  float odM = 0.0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  for (int i = 0; i < ATMO_STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    float r = length(p);
    float h = max(r - 1.0, 0.0);
    float dR = exp(-h / ATMO_HR);
    float dM = exp(-h / ATMO_HM);
    odR += dR * dt;
    odM += dM * dt;
    // towards the sun: air mass grows to the horizon and beyond it, and the planet casts a shadow
    float cz = dot(p, L) / r;
    float am = exp(max(-cz, 0.0) * 25.0) / (max(cz, 0.0) + 0.08);
    float lit = cz > 0.0 ? 1.0 : smoothstep(1.0, 1.0 + 2.0 * ATMO_HR, r * sqrt(max(1.0 - cz * cz, 0.0)));
    vec3 tau = betaR * (odR + dR * ATMO_HR * am) + betaM * 1.1 * (odM + dM * ATMO_HM * am);
    vec3 att = exp(-tau) * lit;
    sumR += dR * dt * att;
    sumM += dM * dt * att;
  }
  inscatter = ATMO_SUN * (sumR * betaR * phaseR + sumM * betaM * phaseM);
  trans = exp(-(betaR * odR + betaM * 1.1 * odM));
}

// Soft shoulder: unchanged below 0.8, highlights roll off instead of clipping
vec3 shoulder(vec3 c) { return mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(0.8, c)); }
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
uniform sampler2D uNight;     // city lights
uniform sampler2D uNormal;    // tangent-space relief
uniform sampler2D uSpec;      // ocean mask (white = water)
uniform sampler2D uTempBase;  // surface temperature climatology (NASA POWER), 0..1 = 192..320 K
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
uniform sampler2D uSim;      // energy balance model state: R = T, G = deep ocean, B = baseline offset
uniform vec2  uSimRes;
uniform float uSimOn;        // 0 observed bands, 1 model field; in between while cross-fading
uniform float uGrid;         // graticule strength in the data views
uniform float uDpr;          // device pixels per CSS pixel

varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;

` + ATMO_GLSL + /* glsl */ `
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// One level of hatching: thin lines every (spacing) degrees of g, 1 on a line; px is degrees per pixel.
float hatchLines(float g, float spacing, float px) {
  float w = 2.0 * px / spacing;
  return smoothstep(0.68 - w, 0.68 + w, abs(fract(g / spacing) - 0.5) * 2.0);
}

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

// The model grid is coarse and stored in a float texture with nearest filtering,
// so interpolate by hand: wrap in longitude, clamp at the poles.
vec3 simTap(vec2 ij) {
  vec2 uv = vec2(fract((ij.x + 0.5) / uSimRes.x), clamp((ij.y + 0.5) / uSimRes.y, 0.5 / uSimRes.y, 1.0 - 0.5 / uSimRes.y));
  return texture2D(uSim, uv).rgb;
}

// Cubic B-spline weights for the four nearest samples
vec4 bspline(float f) {
  float f2 = f * f;
  float f3 = f2 * f;
  return vec4(1.0 - 3.0 * f + 3.0 * f2 - f3, 4.0 - 6.0 * f2 + 3.0 * f3, 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3, f3) / 6.0;
}

// The model field through a bicubic B-spline over 4 x 4 cells. Two-cell interpolation
// leaves a crease along every cell border, which the colour scale turns into a visible
// staircase; the spline is smooth in value, slope and curvature.
float simValue(vec2 uv) {
  vec2 p = uv * uSimRes - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 wx = bspline(f.x);
  vec4 wy = bspline(f.y);
  float s = 0.0;
  for (int b = 0; b < 4; b++) {
    for (int a = 0; a < 4; a++) {
      vec3 t = simTap(i + vec2(float(a) - 1.0, float(b) - 1.0));
      s += wx[a] * wy[b] * (t.r + t.b);
    }
  }
  return s;
}

// 1 on the boundary between two colour classes of the diverging scale: an isotherm
float classEdge(float t) {
  float u = clamp(t * 0.5 + 0.5, 0.0, 1.0) * 11.0;
  float d = abs(fract(u - 0.5) - 0.5) / max(fwidth(u), 1e-5);
  return (1.0 - smoothstep(0.4, 1.3, d)) * step(0.02, u) * step(u, 10.98);
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
  float sunOrientation = dot(N, L);
  // past the terminator the ground goes dark, so the night side reads as night
  float day = smoothstep(-0.12, 0.18, sunOrientation);
  float light = (0.08 + 1.12 * hl * hl) * mix(0.02, 1.0, day);
  vec3 H = normalize(L + V);
  float lit = smoothstep(0.0, 0.12, sunOrientation);
  // glint: a tight core and a wide sheen, stronger at grazing angles (Schlick, F0 = 0.02)
  float ndh = max(dot(N, H), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float spec = (0.24 * pow(ndh, 72.0) + 0.05 * pow(ndh, 10.0)) * (0.7 + 6.0 * fres) * ocean * lit;
  vec2 cuv = vec2(vUv.x + uTime * 0.0012, vUv.y);
  float cl = texture2D(uClouds, cuv).r;
  // the shadow of the cloud that stands between this place and the sun
  vec2 toSun = vec2(dot(L, T) * 0.5 / max(cos(radians(lat)), 0.25), dot(L, B)) * 0.0035;
  float shade = 1.0 - 0.4 * texture2D(uClouds, cuv + toSun).r * uCloudAmt * lit;
  vec3 nat = toLinear(dayS) * light * shade + vec3(spec);
  float hlc = clamp(sunOrientation * 0.5 + 0.5, 0.0, 1.0);
  nat = mix(nat, vec3(0.06 + 1.0 * hlc * hlc) * mix(0.03, 1.0, day), cl * uCloudAmt);
  // city lights where the sun is down, dimmed under cloud
  vec3 nightS = toLinear(texture2D(uNight, vUv).rgb);
  float lights = smoothstep(0.02, 0.25, dot(nightS, vec3(0.299, 0.587, 0.114)));
  nat += nightS * lights * 2.6 * (1.0 - day) * (1.0 - 0.6 * cl * uCloudAmt);
  // the air between the eye and the ground: it dims what is behind and adds its own light
  if (uAtmoMix > 0.0 && uMode < 0.5) {
    vec3 airLight; vec3 airPass;
    atmosphere(cameraPosition, -V, length(cameraPosition - vPos), L, airLight, airPass);
    // close to the ground the haze thins out with the clouds, so the surface stays readable
    nat = mix(nat, nat * airPass + airLight, uAtmoMix * (0.3 + 0.7 * smoothstep(0.12, 0.85, uCloudAmt)));
  }
  vec3 col = toDisplay(shoulder(nat));

  // ---- data views: quiet grey base, data on top, coastlines over the data ----
  vec3 base = vec3(0.10 + 0.45 * lum) * mix(1.0, 0.72, ocean);
  if (uMode > 0.5) {
    vec3 data = base;
    float a = 0.0;
    if (uMode < 1.5) {
      float v; float r;
      zonal(lat, v, r);
      // observed bands and the model field cross-fade when the timeline passes the last record
      if (uSimOn > 0.002) v = mix(v, simValue(vUv), uSimOn);
      data = divA(v / uRange);
      // isotherms only with classed colours, where they mark the class boundaries of the model field
      data = mix(data, data * 0.55, classEdge(v / uRange) * uStepped * uSimOn * 0.8);
      a = uOverlay;
    } else if (uMode < 2.5) {
      float v; float r;
      zonal(lat, v, r);
      if (uSimOn > 0.002) v = mix(v, simValue(vUv), uSimOn);
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
    // graticule every 30 degrees; the equator a little stronger
    float gy = lat / 30.0;
    float gx = lon / 30.0;
    float ly = 1.0 - smoothstep(0.6, 1.5, abs(fract(gy - 0.5) - 0.5) / max(fwidth(gy), 1e-5));
    float lx = (1.0 - smoothstep(0.6, 1.5, abs(fract(gx - 0.5) - 0.5) / clamp(fwidth(gx), 1e-5, 0.5))) * smoothstep(0.08, 0.3, cos(radians(lat)));
    float eq = 1.0 - smoothstep(0.6, 1.5, abs(lat) / max(fwidth(lat), 1e-5));
    col = mix(col, vec3(0.0), clamp(max(ly, lx) * 0.14 + eq * 0.12, 0.0, 0.26) * uGrid);
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
          // Thin lines fixed to the surface, so they turn with the globe instead of sliding over
          // it, drawn over the cell so its colour can still be read. Spacing is
          // a power of two in degrees; two neighbouring levels are cross-faded so nothing jumps
          // while zooming.
          float hg = lon + lat;
          float hpx = max(fwidth(hg), 1e-6);
          float lv = log2(hpx * 9.0 * uDpr);
          float l0 = floor(lv);
          float h = mix(hatchLines(hg, exp2(l0), hpx), hatchLines(hg, exp2(l0 + 1.0), hpx), smoothstep(0.5, 1.0, lv - l0));
          // the lines are a darker shade of the cell itself: a grey patch would read as missing data
          rc = mix(rc, rc * 0.42, 0.85 * h);
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
  // the ray leaves the eye, crosses the shell and goes on to space; the light it gathers is added to what is behind
  vec3 airLight; vec3 airPass;
  atmosphere(cameraPosition, -V, 1e6, normalize(uSunDir), airLight, airPass);
  gl_FragColor = vec4(pow(clamp(shoulder(airLight), 0.0, 1.0), vec3(1.0 / 2.2)), uAtmo);
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
    uBandSoft: 10.0, // same value as BAND_SOFT in analysis.js
    uRange: 3,
    uDiv: new Float32Array(33),
    uDivR: new Float32Array(33),
    uStepped: 0,
    uOverlay: 0.92,
    uExag: 1,
    uSatOn: 0,
    uRegionBox: [0, 0, 1, 1],
    uRegionOn: 0,
    uMarkerDir: [1, 0, 0],
    uMarkerOn: 0,
    uPx: 0.001,
    uAtmoMix: 1,
    uSimRes: [64, 32],
    uSimOn: 0,
    uGrid: 1,
    uDpr: 1,
  };
}

export const EARTH_SAMPLERS = ['uDay', 'uClouds', 'uNight', 'uNormal', 'uSpec', 'uTempBase', 'uPalette', 'uSat', 'uRegion', 'uSim'];

// ---------------------------------------------------------------------------
// The prediction engine: a partial differential equation solved on the GPU.
// The state lives in a floating-point texture; each draw of this shader is one
// explicit time step, written to a second texture, and the two are swapped
// (the approach VisualPDE uses for its interactive simulations). The equations
// and the discretisation are identical to the reference solver in src/ebm.js.
// ---------------------------------------------------------------------------
export const SIM_W = 64;
export const SIM_H = 32;

export const SIM_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SIM_FRAG = /* glsl */ `
uniform sampler2D uState;   // R = surface anomaly T, G = deep-ocean anomaly Td, B = baseline offset
uniform sampler2D uOcean;   // R = ocean fraction of the cell
uniform vec2  uRes;
uniform float uInit;        // 1: write the initial state diagnosed from observations
uniform float uDt;          // years
uniform float uF;           // W/m2, forcing during this step
uniform vec4  uPhys;        // D, cos(lat) floor, C land, C mixed layer
uniform vec2  uDeep;        // C deep, gamma
uniform float uLam[32];     // feedback per latitude row
uniform float uGam[32];     // surface-deep exchange per latitude row
uniform float uT0[32];
uniform float uTd0[32];
uniform float uPi[32];

const float PI = 3.141592653589793;

float surf(vec2 px) {
  vec2 uv = vec2(fract(px.x / uRes.x), clamp(px.y / uRes.y, 0.5 / uRes.y, 1.0 - 0.5 / uRes.y));
  return texture2D(uState, uv).r;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  int j = int(px.y);
  if (uInit > 0.5) {
    gl_FragColor = vec4(uT0[j], uTd0[j], uPi[j], 1.0);
    return;
  }
  vec2 uv = px / uRes;
  vec3 s = texture2D(uState, uv).rgb;
  float o = texture2D(uOcean, uv).r;

  float dphi = PI / uRes.y;
  float dlam = 2.0 * PI / uRes.x;
  float phi = -0.5 * PI + px.y * dphi;
  float c = cos(phi);
  float cp = max(cos(phi + 0.5 * dphi), 0.0);
  float cm = max(cos(phi - 0.5 * dphi), 0.0);

  float t = s.r;
  float lapZ = (surf(px + vec2(1.0, 0.0)) - 2.0 * t + surf(px - vec2(1.0, 0.0))) / (dlam * dlam * max(c * c, uPhys.y * uPhys.y));
  float lapM = (cp * (surf(px + vec2(0.0, 1.0)) - t) - cm * (t - surf(px - vec2(0.0, 1.0)))) / (dphi * dphi * c);

  float ex = uGam[j] * (t - s.g);
  float C = mix(uPhys.z, uPhys.w, o);
  float tNew = t + uDt / C * (uF - uLam[j] * t - o * ex + uPhys.x * (lapZ + lapM));
  float dNew = s.g + uDt / uDeep.x * ex;
  gl_FragColor = vec4(tNew, dNew, s.b, 1.0);
}
`;
