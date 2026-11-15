# Pink Panther

Prototype for the NASA Space Apps Challenge 2026. A 3D globe where you pick an Earth science variable, watch it change over time, and get four answers: **what** is changing, **where**, **how much**, and whether the change is **significant**.

The interface is in English by default and also in Spanish (EN / ES button, or `?lang=es` in the URL).

## Who it is for

Technical staff, teachers and researchers who need to know whether a change in a place is real before acting on it, teaching it or studying it further. The **Guided tour** button in the header walks through the tool in six steps, each one run on live NASA data: one place and its four answers, which variables are changing there, two places moving in opposite directions, the planet, its projection, and how to take the result away (report, CSV, link). Every result also carries a "What you can say" line: what the test supports stating, and what it does not.

## What it does

| Challenge objective | How the tool answers |
|---|---|
| Select variables from missions or models | 9 NASA POWER variables (MERRA-2 reanalysis) grouped into atmosphere, water and land, each with a plain-language definition. For any place, "What else is changing here" tests all nine at once and ranks them, so the tool points to the variables that indicate change |
| Visualize change over time | 3D globe with four views, an 1880–2100 timeline, and a chart of the series |
| What and where | Analysis by point (click the globe, type coordinates or use your location), by region (8° × 8° box, a trend in every cell), and for the planet (eight latitude bands). A place can be pinned and compared with another: the tool says whether the two trends differ and whether they run in opposite directions. A table shows in which months the change happens |
| How much | Theil-Sen slope per decade with confidence interval, total change over the period (also as a share of the usual value for rain, wind and soil moisture), first half against second half, and whether the change was gradual or a step (Pettitt test) |
| Is it significant? | Mann-Kendall test corrected for autocorrelation, t-test of the linear regression, and false discovery rate control (Benjamini-Hochberg) for regions and for the nine-variable screening |
| Automatic report | "Download report" button (Markdown) with results, method, limits and the exact data URL; the annual series as CSV; and a link that reopens the same analysis (`?v=T2M&lat=…&lon=…&s=JJA&from=…&to=…`) |

Cells of a region that are not significant are hatched, so solid colour always means robust change. One region can hold cells that rise and cells that fall, which is the case the challenge describes.

Six one-click examples (Barranquilla, Svalbard, the Sahel, the Amazon, the Aral Sea, Siberia) set the variable, the months and the place.

### Globe views

- **Natural**: day map, relief, ocean glint, clouds and atmosphere.
- **Anomaly**: temperature difference from 1951–1980 in eight latitude bands (NASA GISTEMP) for the year on the timeline.
- **Temperature**: a surface temperature field shifted by each band's change, in the palette of the NASA image.
- **Satellite**: the monthly NASA GIBS image of the selected variable.

In the Anomaly and Temperature views, moving the mouse over the globe shows the value under the cursor (kelvin and °C, or the anomaly), and the legend gives the same value for the selected point. It is computed in the browser from the data already loaded, with the arithmetic the shader uses and without the visual exaggeration. The map's base field was decoded from an image and can be several degrees off (it reads warm over deserts and cool over rainforest), so for the selected point the legend puts the NASA POWER surface temperature first.

In the data views the globe carries a latitude-longitude grid, and model fields are drawn with isotherms on the colour-class boundaries.

## The prediction engine

After the last observed year, the planet view runs an **energy balance model solved on the GPU**. The method is the one [VisualPDE](https://visualpde.com/) uses for its interactive simulations: the state of a partial differential equation lives in a floating-point texture, a fragment shader advances it one explicit time step into a second texture, and the two are swapped, hundreds of times per frame.

The equations are a two-layer energy balance model with horizontal diffusion on a 64 × 32 latitude-longitude grid:

```
C(x) dT/dt  = F(t) − λ(lat) T − γ o(x) (T − Td) + D ∇²T      surface
Cd   dTd/dt = γ (T − Td)                                      deep ocean
```

`T` is the surface temperature anomaly, `o(x)` the ocean fraction of each cell (from the ocean mask texture), `F` the radiative forcing, `λ` the climate feedback and `γ` the heat exchange with the deep ocean. Heat capacities and `γ` are set so that their global means equal the CMIP5 multi-model fit of Geoffroy et al. (2013).

Nothing is tuned by eye. Everything else is diagnosed from the NASA GISTEMP record each time the app loads:

1. **Present state**: each latitude band's fitted trend value today, relative to its 1880–1900 mean, turned into a smooth profile with a Legendre fit.
2. **Deep-ocean heat**: the deep-layer equation integrated with the observed surface record since 1880.
3. **Feedback by latitude**: the value of `λ` each latitude needs for its energy budget to close today, given its observed warming rate. This is where polar amplification comes from: it is read from the data, not imposed.
4. **Global feedback**: set so the model's equilibrium warming for doubled CO₂ equals the climate sensitivity chosen in the interface (IPCC AR6: best estimate 3 °C, likely 2.5 to 4 °C). The chart's band is this likely range.
5. **Present forcing**: whatever closes the global budget. The interface shows it next to the IPCC AR6 values as a check that the calibration is physically sensible.

You choose the forcing reached in 2100 (the levels that name the SSP scenarios: 2.6, 4.5, 7.0, 8.5 W/m²) and the climate sensitivity. Forcing follows a straight line from today's diagnosed value to that level.

`src/ebm.js` is the same model on the CPU. It draws the chart curve, serves as the fallback on devices that cannot render to float textures (the globe then shows band means), and is what the tests exercise.

For points and regions (any variable), the chart still **extends the observed trend** with a prediction interval; the "if the rate of change…" control stops it, keeps it or doubles it. That is a statistical extrapolation, not a model.

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
cd pink-panther
vercel          # preview
vercel --prod   # production
```

## Run locally

```bash
vercel dev            # recommended: serves the page and the api/ functions
npm test              # 21 tests of the statistics, 11 of the energy balance model
```

Any static server (`python3 -m http.server`) runs the point and region analysis but not the planet view: NASA GISS sends no CORS headers, so that table is read through `api/gistemp`. For a demo on an unreliable connection, `npm run snapshot` saves a copy to `data/gistemp-zonal.csv`, which the app uses as a last resort.

## Structure

```
index.html, styles.css      interface
src/main.js                 state and events
src/globe.js                three.js scene (the only module that uses three)
src/shaders.js              GLSL for the Earth, the atmosphere and the PDE solver
src/ebm.js                  energy balance model: calibration and CPU reference solver
src/simdriver.js            steps the GPU solver towards the selected year
src/data.js                 requests to NASA POWER, GISTEMP and GIBS
src/analysis.js, stats.js   series, trends and significance tests
src/chart.js, report.js     SVG chart and report
src/ui.js                   term explanations, toast and count-up
src/tour.js                 guided tour
src/config.js               variables, examples, palettes and credits
src/i18n.js                 English and Spanish text
api/                        Vercel proxies (used only if the browser cannot reach NASA)
assets/                     textures
tests/stats.test.mjs        tests of the statistics
tests/ebm.test.mjs          tests of the energy balance model
```

**Add a variable**: one entry in `VARIABLES` in `src/config.js` with the NASA POWER parameter code. **Add an example**: one entry in `EXAMPLES`.

**Full-resolution textures**: the day map and the cloud map arrived reduced to 2576 px. Replace `assets/earth_day.jpg` and `assets/earth_clouds.jpg` with the 8k originals (or 4k, kinder to phones) under the same names.

## Method

- Annual series (or one season) built from monthly data, which removes the seasonal cycle.
- Trend: Theil-Sen slope, robust to outliers.
- Significance: Mann-Kendall with tie correction and autocorrelation correction (Yue and Wang, 2004).
- The linear regression is reported too, with its t-test and R².
- Unusual years: residual from the trend beyond 2 standard deviations.
- Abrupt change: Pettitt test for one change point. A steady trend also trips this test, so the break is reported as a step only when two flat levels fit the series better than the straight line.
- A test that passes with a slope of exactly zero (series made mostly of repeated values, such as months with no rain) is not counted as a change.
- Screening: the same analysis for every variable at the place, ranked by total change divided by the scatter around the trend (so units do not matter), with false discovery rate control across the variables.
- Two places: the difference between their regression slopes, tested with a normal approximation on the two standard errors.
- Regions: one test per cell, with false discovery rate control (Benjamini-Hochberg).
- Point and region projection: the regression line extended, with a prediction interval.
- Planet projection: the energy balance model above.

What the model tests check (`tests/ebm.test.mjs`, with synthetic observations shaped like GISTEMP): exponential relaxation against the analytic solution; equilibrium at `F/λ`; exact conservation of heat by diffusion and ocean exchange; the calibration reproducing the requested sensitivity from 2 to 5 °C and closing today's energy budget; and 2100 warming for the 2.6, 4.5 and 8.5 W/m² levels falling inside the IPCC AR6 very likely ranges. In a browser test the GPU solver matched the CPU solver to about 0.001 K after 55 model years.

## Limits

- A significant trend does not identify its cause.
- The energy balance model has one surface layer and one deep-ocean layer. It has no winds, clouds, currents or ice; the diagnosed feedback profile absorbs what its simple diffusion cannot represent, and is assumed to stay fixed. The straight-line forcing is an idealized pathway, not the SSP time series. Treat its output as a physically grounded illustration, not as a substitute for CMIP models.
- The model starts from zonally uniform anomalies, because zonal means are what the GISTEMP table provides. Land-ocean contrast develops during the first model years.
- The anomaly view only resolves latitude bands; real spatial detail is in the region analysis.
- The base field of the "Temperature" view was decoded from the colours of a NASA image; its values are approximate and meant for viewing, not measuring.
- MERRA-2 cells are about 50 km wide: it does not resolve microclimates.

## Use of SI

The code of this application and the derived data file `assets/temp_base.png` were generated with Claude (Anthropic), a large language model, directed by the team. There are no SI-generated images, audio or video. Every source file says so on its first line, as do `package.json`, the `<meta name="generator">` tag and the "About" dialog.

## Data and credits

See [SUBMISSION.md](./SUBMISSION.md) for the full list with licenses, ready for the Space Apps form.
