# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: judges of the NASA Space Apps Challenge 2026. They see the tool during a short demo, usually on a laptop or a projector, and have a few minutes to decide whether it answers the challenge. They are technically literate but are not necessarily statisticians or climate scientists.

Secondary (not confirmed as a priority): anyone who opens the public link afterwards, including on a phone. The phone layout has to work; it does not lead design decisions.

## Product Purpose

A 3D Earth observatory. The user picks an Earth science variable, a place and a period, watches the variable change on a globe, and gets four answers: what is changing, where, how much, and whether the change is statistically significant.

Success in a demo: within the first screen and one click, a judge can read a plain-language verdict, see it on the globe and the chart, and trust that the significance claim is backed by a real test.

## Positioning

The tool does not stop at showing a change. It tests it: Theil-Sen slope with a confidence interval, Mann-Kendall corrected for autocorrelation, and false discovery rate control across the cells of a region. Cells that are not significant are hatched, so solid colour always means a robust change.

## Operating Context

- Demoed live, on a possibly unreliable connection. NASA POWER requests can take many seconds; region analysis samples many cells.
- Data: NASA POWER (MERRA-2), NASA GISTEMP v4, NASA GIBS imagery.
- Three scopes: planet (eight latitude bands), point (click on the globe or one of six examples), region (8° × 8° box).
- Four globe views: natural, anomaly, temperature, satellite. A timeline from 1880 to 2100; years after the last record are a projection.
- Output: a downloadable Markdown report with results, method, limits and the exact data URL.

## Capabilities and Constraints

- No build step: static `index.html`, `styles.css`, vanilla ES modules, three.js from a CDN, three Vercel functions in `api/` used only as fallbacks. This stays.
- No new runtime dependency for the interface.
- English by default, Spanish via the EN / ES control or `?lang=es`. Every interface string exists in both.
- Projections are a statistical extrapolation (points, regions) or a simple energy balance model (planet). They are not a climate model and the interface must keep saying so.
- A significant trend does not identify its cause.
- Space Apps rule: every source file states on its first line that it was generated with Claude, as do `package.json`, the generator meta tag and the About dialog.

## Brand Commitments

- Name: Intelligent Earth Observatory / Observatorio Inteligente de la Tierra.
- Stated in `styles.css` and binding: flat surfaces, one typeface (Instrument Sans), no interface colour. The only colour on screen is data.
- Plain language first; the statistical terms come second and are explained.

## Evidence on Hand

- Live NASA data for every number shown; nothing is mocked.
- 15 tests of the statistics (`tests/stats.test.mjs`) and 11 of the energy balance model (`tests/ebm.test.mjs`).
- Six worked examples in `src/config.js` (Barranquilla, Svalbard, the Sahel, the Amazon, the Aral Sea, Siberia).
- No user testimonials, usage numbers or external reviews exist. Do not invent any.

## Product Principles

1. The verdict comes first. A judge should read the answer before any control.
2. Never overstate. Significance, uncertainty and the observed/projected boundary are always visible.
3. Colour means data. Interface chrome stays neutral so the globe, the chart and the legend carry all the colour.
4. Waiting is part of the product. Slow NASA requests must show what is happening and that the tool is working.
5. Standard controls. A judge should not have to learn the interface during a five-minute demo.

## Accessibility & Inclusion

WCAG 2.1 AA as the target: contrast, keyboard operation with visible focus, labelled controls, reduced-motion support. Colour is never the only carrier of significance (hatching and text carry it too).
