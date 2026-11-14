# Intelligent Earth Observatory

*Observatorio Inteligente de la Tierra.* Prototype for the NASA Space Apps Challenge 2026. A 3D globe where you pick an Earth science variable, watch it change over time, and get four answers: **what** is changing, **where**, **how much**, and whether the change is **significant**.

The interface is in English by default and also in Spanish (EN / ES button, or `?lang=es` in the URL).

## What it does

| Challenge objective | How the tool answers |
|---|---|
| Select variables from missions or models | 9 NASA POWER variables (MERRA-2 reanalysis) grouped into atmosphere, water and land, each with a plain-language definition |
| Visualize change over time | 3D globe with four views, an 1880–2100 timeline, and a chart of the series |
| What and where | Analysis by point (click the globe), by region (8° × 8° box, a trend in every cell), and for the planet (eight latitude bands) |
| How much | Theil-Sen slope per decade with confidence interval, total change over the period, first half against second half |
| Is it significant? | Mann-Kendall test corrected for autocorrelation, t-test of the linear regression, and false discovery rate control (Benjamini-Hochberg) for regions |
| Automatic report | "Download report" button (Markdown) with results, method, limits and the exact data URL |

Cells of a region that are not significant are hatched, so solid colour always means robust change. One region can hold cells that rise and cells that fall, which is the case the challenge describes.

Six one-click examples (Barranquilla, Svalbard, the Sahel, the Amazon, the Aral Sea, Siberia) set the variable, the months and the place.

### Globe views

- **Natural**: day map, relief, ocean glint, clouds and atmosphere.
- **Anomaly**: temperature difference from 1951–1980 in eight latitude bands (NASA GISTEMP) for the year on the timeline.
- **Temperature**: a surface temperature field shifted by each band's change, in the palette of the NASA image.
- **Satellite**: the monthly NASA GIBS image of the selected variable.

After the last year with data, the globe and the chart **extend the observed trend**; the "If the rate of change…" control stops it, keeps it or doubles it. This is a statistical extrapolation with a prediction interval, **not a climate model**.

## Deploy on Vercel

There is no build step: static files plus three functions in `api/`.

**Option A, from GitHub**

1. Push this folder to a repository.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty.
4. Deploy.

**Option B, from the terminal**

```bash
npm i -g vercel
cd observatorio-tierra
vercel          # preview
vercel --prod   # production
```

## Run locally

```bash
vercel dev            # recommended: serves the page and the api/ functions
npm test              # 15 tests of the statistics
```

Any static server (`python3 -m http.server`) runs the point and region analysis but not the planet view: NASA GISS sends no CORS headers, so that table is read through `api/gistemp`. For a demo on an unreliable connection, `npm run snapshot` saves a copy to `data/gistemp-zonal.csv`, which the app uses as a last resort.

## Structure

```
index.html, styles.css      interface
src/main.js                 state and events
src/globe.js                three.js scene (the only module that uses three)
src/shaders.js              GLSL for the Earth and the atmosphere
src/data.js                 requests to NASA POWER, GISTEMP and GIBS
src/analysis.js, stats.js   series, trends and significance tests
src/chart.js, report.js     SVG chart and report
src/config.js               variables, examples, palettes and credits
src/i18n.js                 English and Spanish text
api/                        Vercel proxies (used only if the browser cannot reach NASA)
assets/                     textures
tests/stats.test.mjs        tests of the statistics
```

**Add a variable**: one entry in `VARIABLES` in `src/config.js` with the NASA POWER parameter code. **Add an example**: one entry in `EXAMPLES`.

**Full-resolution textures**: the day map and the cloud map arrived reduced to 2576 px. Replace `assets/earth_day.jpg` and `assets/earth_clouds.jpg` with the 8k originals (or 4k, kinder to phones) under the same names.

## Method

- Annual series (or one season) built from monthly data, which removes the seasonal cycle.
- Trend: Theil-Sen slope, robust to outliers.
- Significance: Mann-Kendall with tie correction and autocorrelation correction (Yue and Wang, 2004).
- The linear regression is reported too, with its t-test and R².
- Unusual years: residual from the trend beyond 2 standard deviations.
- Regions: one test per cell, with false discovery rate control (Benjamini-Hochberg).
- Projection: the regression line extended, with a prediction interval.

## Limits

- A significant trend does not identify its cause.
- The anomaly view only resolves latitude bands; real spatial detail is in the region analysis.
- The base field of the "Temperature" view was decoded from the colours of a NASA image; its values are approximate and meant for viewing, not measuring.
- MERRA-2 cells are about 50 km wide: it does not resolve microclimates.

## Use of SI

The code of this application and the derived data file `assets/temp_base.png` were generated with Claude (Anthropic), a large language model, directed by the team. There are no SI-generated images, audio or video. Every source file says so on its first line, as do `package.json`, the `<meta name="generator">` tag and the "About" dialog.

## Data and credits

See [SUBMISSION.md](./SUBMISSION.md) for the full list with licenses, ready for the Space Apps form.
