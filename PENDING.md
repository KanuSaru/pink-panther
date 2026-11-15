# Pending improvements

Handoff for whoever (person or agent) picks up the visual-quality work. Nothing in this file is implemented. Written 2026-11-14 on branch `feat/hover-readout`.

Read `README.md` (structure, how to run) and `PRODUCT.md` (audience, design rules) first. The rules that constrain this work:

- No build step. Static files, vanilla ES modules, three.js 0.170 from a CDN import map. Do not add a bundler or a dependency.
- Stay on GLSL / WebGL 2. Moving to WebGPU, WGSL or TSL was considered and rejected: the model grid is 64 × 32, so there is no speed to gain, and WebGL 2 runs on every device a judge may use.
- In the data views (Anomaly, Temperature, regional trend) the only colour on screen is the data. Visual effects belong to the Natural view only.
- Every source file keeps its SI-disclosure comment on line 1.
- All user-facing text goes through `src/i18n.js` in English and Spanish.
- Respect `prefers-reduced-motion` (`reduceMotion` in `src/globe.js`).

## Order of work

| # | Task | Where it shows | Effort | Do it for the submission? |
|---|---|---|---|---|
| 1 | Full-resolution textures | Natural view, zoomed in | Low, no code | Yes |
| 2 | Hatch anchored to the globe | Regional trend | Low | Yes |
| 3 | Cloud shadows | Natural view | Low | Yes |
| 4 | Real surface-temperature base field | Temperature view and the kelvin read-out | Medium | Team decision, see below |
| 5 | Ocean glint and tone curve | Natural view | Low | Optional |
| 6 | Night side with city lights | Natural view | Medium | Optional |
| 7 | Atmosphere with scattering | Natural view | Medium to high | After the hackathon |

Tasks 1 to 3 are independent of each other. Do them as separate commits.

## 1. Full-resolution textures

**Problem.** `assets/earth_day.jpg` and `assets/earth_clouds.jpg` are reduced to 2576 px wide. The tool flies the camera close to a selected point, and the surface is blurred there.

**Change.** Replace both files, same names, with the originals: NASA Blue Marble Next Generation for the day map, NASA Visible Earth for the clouds. Both are public domain. Use 4096 × 2048 unless a phone test shows 8192 × 4096 loads acceptably; many phones cap texture size at 4096.

**Check.** `earth_normal.jpg` and `earth_specular.jpg` must still line up with the new day map (same equirectangular projection, longitude 0 at the centre). Coastlines in the data views are drawn from `earth_specular.jpg`, so a misaligned day map shows as coast lines offset from the land. Update the "Full-resolution textures" note in `README.md` and the image credits.

## 2. Hatch anchored to the globe

**Problem.** In the regional trend, cells that are not statistically significant are hatched. The hatch is computed in screen pixels (`src/shaders.js`, in `EARTH_FRAG`):

```glsl
float h = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
```

So the pattern slides over the cells when the globe turns, and its density does not follow the zoom.

**Change.** Compute the hatch from the cell coordinate `q` (already available there, 0..1 across the region box) or from `lat`/`lon`, so it is fixed to the surface. Keep the line width constant on screen by using `fwidth()` of the hatch coordinate, as the outline a few lines below does, and fade the hatch to a flat 50 % mix when the lines would be closer than about 4 px, to avoid moiré when zoomed out.

**Check.** The meaning must not change: significant cells solid, the others visibly weaker. This encoding is described in the legend and in `README.md`; if the look changes noticeably, update the legend swatch in `styles.css` to match.

## 3. Cloud shadows

**Problem.** Clouds are blended over the surface with no shadow, so they look painted on (`EARTH_FRAG`, natural view):

```glsl
float cl = texture2D(uClouds, vec2(vUv.x + uTime * 0.0012, vUv.y)).r;
```

**Change.** Take a second sample of `uClouds` offset towards the sun and darken the ground by it before the clouds are blended. The offset is the sun direction projected on the tangent plane (`T`, `B` are already computed), scaled to about 0.002 to 0.004 in UV, and divided by `cos(lat)` in the x direction. Darken by roughly `1.0 - 0.35 * shadow * uCloudAmt`.

**Check.** `uCloudAmt` falls to zero as the camera approaches; the shadow must fall with it. Nothing changes in the data views.

## 4. Real surface-temperature base field (team decision pending)

**Problem.** The Temperature view and the kelvin read-out under the cursor use `assets/temp_base.png` (1024 × 512, one channel, 0..1 = 192..320 K). It was decoded from the colours of a NASA image and is off by several degrees: the Amazon reads about 287 K where NASA POWER gives about 300 K, and deserts read 44 to 45 °C as an annual mean.

**Current mitigation.** The hover label is marked "estimated". For the selected point, the legend shows the NASA POWER 1991–2020 mean first and the map value second (`renderLegend` in `src/main.js`, keys `probePower` and `probeMap`).

**Decision the team has not made.** Keep it as it is and not quote hover figures in the video, or replace the field with real data.

**If replacing.** Build a 1991–2020 annual-mean surface-temperature climatology on a regular latitude-longitude grid and write it in the same encoding, so nothing else changes:

- Source options: MERRA-2 `TS` or `T2M` monthly means (the reanalysis behind NASA POWER, which keeps the map and the point analysis consistent), or the NASA POWER regional endpoint, which is limited to 10° × 10° per request at 0.5° × 0.625°, so it needs many requests.
- Output: PNG, single channel, equirectangular, north at the top, longitude −180 at the left edge, value `round((K − 192) / 128 × 255)`. 720 × 360 is enough.
- Add the generating script under `scripts/` next to `snapshot-gistemp.mjs`, and record source, period and access date in `README.md` and `SUBMISSION.md`.
- Readers of the file: `uTempBase` in `EARTH_FRAG`, and `loadTempBase()` / `estimateAt()` in `src/main.js`. Both assume the encoding above.

**Check.** After replacing, the map value and the POWER value for the same point should agree within about 2 K over land away from coasts and mountains. If they do, drop the two-value legend row and show one.

## 5. Ocean glint and tone curve

**Problem.** The glint is a fixed Blinn-Phong lobe, `pow(max(dot(N, H), 0.0), 48.0) * ocean * 0.30`, which reads as plastic. The output is `pow(c, 1/2.2)` with a hard clamp, so clouds and glint clip to flat white.

**Change.** Multiply the glint by a Schlick Fresnel term (`F0 = 0.02`) and widen the lobe slightly with distance from the highlight. Replace the clamp in `toDisplay` with a soft shoulder (Reinhard or a small ACES fit) **for the natural view only**: the data views must keep exact palette colours, because the legend swatches are the same sRGB values.

## 6. Night side with city lights

**Problem.** There is no night side. In `src/globe.js` the sun follows the camera ("the sun stays over the viewer's shoulder so the visible side is always lit").

**Change.** Add NASA Black Marble as `assets/earth_night.jpg` and a `uNight` sampler; blend it in where `dot(N, L)` is below zero, with a soft terminator. This only shows if the sun stops following the camera, so it needs a fixed or slowly moving sun in the Natural view.

**Constraint.** Keep the sun on the viewer's side in the data views, or data on the dark side becomes unreadable. Do not make this the default if it hides the selected point.

## 7. Atmosphere with scattering

**Problem.** The rim is a two-colour gradient on a back-face shell (`ATMO_FRAG`, `atmosphereColor`), ported from the three.js `webgpu_tsl_earth` example.

**Change.** A single-scattering approximation (Rayleigh plus a small Mie term) evaluated along the view ray through the shell. This is the most expensive item and only affects the Natural view. Leave it for after the submission.

## What does not need work

- Coastlines, graticule, isotherms, region outline and marker use screen-space derivatives and are sharp at every zoom.
- The model field (64 × 32) is sampled with hand-written bilinear plus smoothstep filtering; there are no visible cells.
- Performance. The solver runs hundreds of steps per frame at this grid size.

## How to verify

```
npm test                                         # 21 + 11 tests, all must pass
python -m http.server 5178 --bind 127.0.0.1      # then open http://127.0.0.1:5178/
```

Locally the planet view takes about 25 s to appear, because the live GISTEMP request times out before the saved copy is used. That is expected without `vercel dev`.

For each change, check by eye and with a screenshot:

- Natural, Anomaly, Temperature and Satellite views, far and zoomed in to a point.
- A regional trend (select a point, then the regional option) for task 2.
- Laptop width (1180 px) and phone width (390 px); no horizontal scroll.
- With the operating system's reduced-motion setting on: no drifting clouds.
- The browser console stays free of shader compile errors. A GLSL error leaves the globe black.

The earlier work was verified with Playwright and axe-core scripts kept outside the repository. They are not included; if you need automated checks, write them against the selectors in `index.html` (`#globe`, `[data-view="…"]`, `#legend`, `#probe`, `#lat`, `#lon`, `#goPoint`).

## Not verified so far

- The app under `vercel dev` or on the deployed Vercel project (the `api/` fallbacks have not been exercised in this round).
- The hover read-out on a real GPU; it was tested on the software renderer.
- The Congo basin example shows a step change around 2003 that may be an artefact of the reanalysis. Do not present it as a climate fact.
