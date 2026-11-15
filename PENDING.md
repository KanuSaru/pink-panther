# Pending improvements

State of the visual-quality work on branch `feat/hover-readout`, updated 2026-11-15. Read `README.md` (structure, how to run) and `PRODUCT.md` (audience, design rules) first.

Rules that constrain this work:

- No build step. Static files, vanilla ES modules, three.js 0.170 from a CDN import map. No bundler, no new dependency.
- Stay on GLSL / WebGL 2. WebGPU, WGSL and TSL were considered and rejected: the model grid is 64 × 32, so there is no speed to gain.
- In the data views (Anomaly, Temperature, regional trend) the only colour on screen is the data. Visual effects belong to the Natural view only.
- Every source file keeps its SI-disclosure comment on line 1. All user-facing text goes through `src/i18n.js` in English and Spanish.

## Done

| Task | What changed | Where |
|---|---|---|
| Real base temperature field | `assets/temp_base.png` is now the NASA POWER climatology of surface temperature (`TS`, MERRA-2, annual mean 2001–2025), 720 × 360. Changes are counted from those same years (`TEMP_BASE_PERIOD`). | `scripts/build-temp-base.mjs`, `src/config.js`, `src/main.js` |
| Full-resolution textures | Day and cloud maps at 4096 px (same images as before, not reduced). | `assets/` |
| Hatch anchored to the globe | Stripes of non-significant cells are fixed to latitude and longitude; spacing is a power of two in degrees chosen to stay near 8 px. | `EARTH_FRAG` in `src/shaders.js` |
| Cloud shadows | A second cloud sample towards the sun darkens the ground. | same |
| Ocean glint and tone curve | Two-lobe glint with a Schlick Fresnel term; soft shoulder on highlights, natural view only. | same |
| Atmosphere with scattering | Single scattering (Rayleigh and Mie) integrated in 8 steps along the view ray; it tints the surface and draws the limb. Replaces the two-colour rim. | `ATMO_GLSL` in `src/shaders.js` |
| Planet view loads at once | The saved GISTEMP table and the live one are requested together; the first answer is used (about 1.5 s locally, 22 s before). | `fetchGistemp` in `src/data.js` |
| Satellite view race | Changing variable while a satellite image was loading threw a script error. | `loadSat` in `src/main.js` |
| City lights on the night edge | `assets/earth_night.jpg` (`uNight`). In the Natural view the sun sits further to the side, so night shows along one edge; the centre of the globe, where the selected point is, stays lit. | same, `src/globe.js` |

Measured after the base field was replaced, map against the mean of the NASA POWER point series over 2001–2025:

| Place | NASA POWER | Map | Difference |
|---|---|---|---|
| Sahara (23, 10) | 297.8 K | 297.9 K | +0.1 |
| Amazon (−5, −60) | 300.2 K | 299.9 K | −0.2 |
| Tibet (33, 88) | 271.0 K | 270.8 K | −0.2 |
| Australia (−25, 134) | 297.4 K | 297.4 K | 0.0 |
| Greenland (72, −40) | 243.3 K | 243.2 K | −0.1 |
| Sahel (14, 0) | 302.8 K | 302.9 K | +0.1 |
| Barranquilla (10.96, −74.8) | 301.3 K | 301.4 K | +0.2 |
| Antarctica (−80, 60) | 217.5 K | 216.1 K | −1.4 |

Before the change the Amazon read 287 K on the map.

## Still open

### 1. One value instead of two in the legend

For the selected point the legend shows the NASA POWER mean first and the map value second. They now agree, so the row could show one. Kept as two because the map adds the change of a whole latitude band, which is not the change at the point: in years far from 2001–2025 the two differ by design.

### 2. Image credits

`SUBMISSION.md` item 5 still carries a **confirm** mark: the day, night and cloud maps are the Solar System Scope textures (CC BY 4.0, based on NASA imagery) as distributed with the three.js r170 examples. Someone on the team should confirm the wording before the form is sent.

### 3. Things not verified

- The app under `vercel dev` or on the deployed Vercel project.
- Any of this on a real GPU; every check ran on the software renderer. Look at the Natural view once on a laptop and a phone: glint, cloud shadows and night lights are tuned by eye on that renderer.
- Frame rate of the new atmosphere on a low-end phone. It adds 8 loop steps per pixel in the Natural view only; the software renderer used for testing draws it at about 16 frames per second.
- The Congo basin example shows a step change around 2003 that may be an artefact of the reanalysis. Do not present it as a climate fact.

## Warning: rate limit

`npm run temp-base` makes 648 requests to NASA POWER. After running it, the service answered `429 Too Many Requests` to this network for several minutes, and the app showed "NASA POWER did not respond". Do not run it shortly before a demo. The file it produces is committed; there is no need to run it again unless the period changes.

## Last full check (2026-11-15)

A Playwright walk on a laptop (1180 px) and a phone (390 px) viewport, against live NASA POWER, all passing: planet result in under 5 s, the four views, a place analysis (verdict, significance, chart, nine-variable screening, seasons), NASA POWER and map agreeing in the legend, the value under the cursor, comparing two places, the regional trend with hatching, CSV download, shareable link, projection year, Spanish, the six-step guided tour, the About dialog, axe with no violations, no horizontal scroll, no script or shader errors. The script is not in the repository (it needs Playwright, and the project has no dependencies).

## How to verify

```
npm test                                         # 21 + 11 tests, all must pass
python -m http.server 5178 --bind 127.0.0.1      # then open http://127.0.0.1:5178/
```

Locally the planet view appears in a few seconds: the saved GISTEMP copy and the live table are requested together. A GLSL error leaves the globe black and prints the compile log in the console.
