# Space Apps 2026 submission

Paste-ready text for every field of the project page, then the checklist for Global Judging eligibility. All of it must be in English. Items marked **confirm** depend on facts only the team knows.

## Field: Project Name

Pink Panther

## Field: High-Level Project Summary

Pink Panther is a 3D Earth observatory that answers four questions about any place on the planet: what is changing, where, how much, and whether the change is statistically significant. A user picks a place on the globe, or one of six worked examples, and the tool pulls the full monthly record of nine NASA POWER variables (MERRA-2 reanalysis, 1981 to today), ranks which ones are changing, and gives a plain-language verdict backed by a Theil-Sen slope with its confidence interval and a Mann-Kendall test corrected for autocorrelation. Regions are tested cell by cell with false-discovery-rate control, so a variable rising in one area and falling in another, the case the challenge describes, shows on the globe, with non-significant cells hatched. For the whole planet, the NASA GISTEMP record since 1880 shows warming in eight latitude bands, and an energy balance model calibrated on that record and solved on the graphics card shows where it is heading under IPCC scenarios. It is built for technical staff, teachers and researchers who need to know whether a change is real before they act on it, teach it or study it further.

## Field: Link to Project Demo

[YouTube or Google Drive link to the 30-second video, public, tested in a private window]

## Field: Link to Final Project

https://pink-panther-pi.vercel.app/

(Code: https://github.com/KanuSaru/pink-panther)

## Field: Detailed Project Description

**What it does.** The challenge asks for a tool that selects Earth science variables, visualizes how they change over time, and determines what is changing, where, how much, and whether the change is significant. Pink Panther does each step on live NASA data:

- *Select variables.* Nine NASA POWER variables across atmosphere, water and land (air temperature, its maximum and minimum, precipitation, humidity, wind, surface and root-zone soil wetness, surface temperature), each with a one-line plain definition. For any place, the tool tests all nine at once and ranks them, so the user does not have to guess which variable indicates change.
- *Visualize change.* A 3D globe with four views (natural, temperature anomaly, temperature, NASA GIBS satellite imagery), a timeline from 1880 to 2100, and a chart of the series with its trend and unusual years.
- *What and where.* Analysis by point (click the globe, type coordinates, or use your location), by region (an 8° × 8° box, with a trend tested in every cell), and for the planet (eight latitude bands). Two places can be pinned side by side to test whether their trends really differ.
- *How much.* Rate per decade with its 95% confidence interval, the total change over the period, a comparison of the first and second half, the change by season, and abrupt steps (Pettitt test).
- *Is it significant.* Mann-Kendall test corrected for autocorrelation, the regression t-test, and false discovery rate control across region cells and across the nine variables. Every result carries a "What you can say" line: what the test supports stating, and what it does not (a significant trend does not identify its cause).

**Where it is heading.** After the last observed year, the planet follows a two-layer energy balance model with heat diffusion on a 64 × 32 grid, solved step by step in a GPU shader. Nothing is tuned by eye: today's state, the deep-ocean heat and the feedback of each latitude are diagnosed from the GISTEMP record. On the real record the diagnosed present forcing (3.1 W/m²) and energy imbalance (0.96 W/m²) fall in or near the IPCC AR6 ranges, and the chart shows the IPCC likely range of climate sensitivity. The interface states that this is a simple physical model, not a climate model forecast.

**Benefits.** A municipal technician gets a defensible statement with method and limits for a brief (downloadable report). A researcher gets the annual series and the exact NASA request to repeat the analysis (CSV). A teacher gets a link that reopens the same analysis on any device, and a six-step guided tour for class. The interface is in English and Spanish.

**How it is built.** Static web app, no build step: vanilla JavaScript modules, three.js with custom GLSL shaders (surface, atmospheric scattering, and the model solver), statistics written from scratch and covered by 43 automated tests, and three small Vercel functions used as fallbacks when a browser cannot reach NASA directly. Hosted on Vercel.

**Goals.** Make the question "is this change real?" answerable in one click by people who are not statisticians, without hiding the uncertainty.

## Field: NASA Data

1. **NASA POWER Monthly API**: `https://power.larc.nasa.gov/api/temporal/monthly/point` and `/regional`, community `AG`, format JSON. Parameters: `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `GWETTOP`, `GWETROOT`, `TS`. The meteorological parameters come from the MERRA-2 reanalysis (NASA Global Modeling and Assimilation Office) on a 0.5° × 0.625° grid, one of the models named in the challenge statement. The app requests the full record from 1981 for the place the user selects, builds annual or seasonal series, estimates the trend (Theil-Sen), and tests its significance (Mann-Kendall, t-test, confidence interval). For a region it requests the grid in one call and tests every cell.

2. **NASA GISS Surface Temperature Analysis (GISTEMP v4)**: table `https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv`, annual anomalies relative to 1951–1980 for the globe and for eight latitude bands, 1880 to present. It drives the planet view: the globe shader colours each band for the selected year, and the same trend analysis shows that the bands warm at different rates. It also calibrates the energy balance model that projects the planet forward: present state, deep-ocean heat and the feedback of each latitude are diagnosed from this record. Citation: GISTEMP Team, 2026: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute for Space Studies. https://data.giss.nasa.gov/gistemp/

3. **NASA Global Imagery Browse Services (GIBS)**: WMS endpoint `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`. Layers: `MERRA2_2m_Air_Temperature_Monthly`, `MERRA2_Precipitation_Bias_Corrected_Monthly`, `MERRA2_Surface_Wind_Speed_Monthly`, `MERRA2_Soil_Water_Root_Zone_Monthly`, `MERRA2_Surface_Skin_Temperature_Monthly`. Each is wrapped on the globe for the month and year chosen on the timeline. Acknowledgement: we acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

4. **NASA POWER climatology** (`https://power.larc.nasa.gov/api/temporal/climatology/regional`, parameter `TS`, MERRA-2, annual mean of 2001–2025, accessed 2026-11-15): the base field of the "Temperature" view, stored as `assets/temp_base.png` by `scripts/build-temp-base.mjs`. The palette of that view (192–320 K) is the colour legend of a NASA global surface temperature image supplied by the team.

5. **NASA Blue Marble and Black Marble imagery**, through the Solar System Scope textures (CC BY 4.0) as distributed with the three.js r170 examples (**confirm**), for the natural view of the globe: day map, city lights and clouds.

## Field: Space Agency Partner & Other Data

**Data**

| Resource | Provider | Used for | Terms |
|---|---|---|---|
| NASA POWER Monthly API (MERRA-2 meteorology) | NASA Langley Research Center, POWER Project; MERRA-2 from NASA GMAO | Monthly series by point and by 8° × 8° region, 1981 to the last complete year | Open, no key |
| GISTEMP v4, zonal annual means (`ZonAnn.Ts+dSST.csv`) | NASA Goddard Institute for Space Studies | Global and latitude-band temperature anomalies, 1880 to present | Open; cite GISTEMP Team |
| GIBS WMS imagery (EPSG:4326, "best") | NASA ESDIS | Global monthly imagery in the satellite view | Open; acknowledge GIBS |
| Global surface temperature image (Kelvin colour scale) | NASA (**confirm** the exact page; the team's notes point to NASA Science "Global Temperature") | Decoded into the base field and palette of the "Temperature" view | NASA media guidelines |

**Images**

| Resource | Source | License |
|---|---|---|
| Earth day map, clouds, normal map, specular map (`8k_earth_*`) | Solar System Scope texture pack, based on NASA imagery (**confirm**: the file names match that pack) | CC BY 4.0, attribution required |

No NASA logos, insignia or mission identifiers are used anywhere in the project.

**Code and libraries**

| Resource | Use | License |
|---|---|---|
| three.js r170 (with OrbitControls), loaded from jsDelivr | 3D rendering | MIT |
| VisualPDE (visualpde.com; Walker, Townsend, Chudasama and Krause, 2023) | Method of the prediction engine: a PDE advanced by explicit time steps in a fragment shader between two alternating float textures. The idea was followed; no code was copied | Open source site; paper in Bull. Math. Biol. 85:113 |
| ColorBrewer palettes (RdBu, BrBG, PuOr) by Cynthia Brewer | Diverging colour scales | Apache 2.0 |
| Instrument Sans, from Google Fonts | Typeface | SIL Open Font License 1.1 |

**Methods (published references)**

- IPCC AR6 WG1 (2021), Summary for Policymakers and chapter 7: equilibrium climate sensitivity (best estimate 3 °C, likely 2.5 to 4 °C), forcing of doubled CO2 (3.93 W/m²), and the reference values shown next to the model's diagnosed forcing and energy imbalance.
- Geoffroy, O. et al. (2013), J. Climate 26: two-layer energy balance model and its CMIP5 multi-model parameters.
- North, G. R. (1975), J. Atmos. Sci. 32, and North, G. R. and Kim, K.-Y. (2017), Energy Balance Climate Models: diffusive energy balance models on the sphere.
- Mann, H. B. (1945) and Kendall, M. G. (1975): Mann-Kendall trend test.
- Sen, P. K. (1968): Theil-Sen slope and its confidence interval.
- Pettitt, A. N. (1979), Applied Statistics 28: change-point test used to tell a step from a gradual change.
- Yue, S. and Wang, C. Y. (2004): variance correction of the Mann-Kendall test for autocorrelated series.
- Benjamini, Y. and Hochberg, Y. (1995): false discovery rate. Wilks, D. S. (2016) on applying it to gridded fields.

**Tools**

- Vercel: hosting and three small proxy functions.
- Node.js: unit tests of the statistics.
- Python with Pillow and NumPy: converting the textures and decoding the temperature image.
- Headless Chrome with Playwright: checking the interface and the shaders during development.
- Claude (Anthropic): code generation, see the AI field.
- ElevenLabs: AI-generated narration for the demo video, see the AI field.

**Space Agency Partner data**: none is used in this version. The resources listed on the challenge page (Giovanni, AppEEARS, Hydrology Time Series, Climate Data Online, KNMI Climate Explorer, CSA datasets) are not data sources of the app.

## Field: Use of Artificial Intelligence

Yes. Two AI tools were used.

- **Claude (Anthropic), large language model.** Wrote the application code (three.js scene and GLSL shaders, the energy balance model and its GPU solver, data access, statistics, chart, interface, Vercel functions, tests), wrote the scripts that converted the textures and built `assets/temp_base.png` from the NASA POWER climatology, and drafted the documentation.
- **What it also proposed**: within the team's proposal (which already named NASA POWER and temperature as the first variable), it suggested the two additional NASA sources (GISTEMP and GIBS), the specific statistical tests, and the formulation of the energy balance model used for the planet projection.
- **What came from the team**: the idea, the choice of challenge, the project proposal and its objectives, the first data source and variable, and the image resources. No images were generated with AI.
- **How it is indicated**: every source file starts with an SI disclosure comment; `package.json` has an `siDisclosure` field; `index.html` carries a `<meta name="generator">` tag; the two derived PNG files carry the disclosure in their embedded metadata; the "About" dialog in the app and the README state it in text.
- **ElevenLabs, AI voice.** The narration of the 30-second demo video was generated with ElevenLabs from a script the team approved. This is stated in the video's subtitles and end card, in its description, and in the file's metadata.
- No NASA branding or design elements (logos, flags, mission identifiers) appear in any AI-assisted content.

## Global Judging eligibility checklist

From the Judging & Awards Guide and the Project Submission Guide. Every item is required unless marked.

**Team**
- [ ] The project responds to an official 2026 challenge (not "Create Your Own Challenge").
- [ ] 1 to 6 members, every one registered, at the same Local Event, not waitlisted, and listed on the Members tab. Nobody can be added after the deadline.

**Fields**
- [ ] Every required field above is filled in, in English.
- [ ] Space Agency Partner & Other Data lists every external resource: data, code, text, images, fonts, the music in the video if any, Claude and ElevenLabs.

**Demo**
- [ ] Video of 30 seconds or less (or 7 slides or fewer). Over the limit means not eligible for Global Judging.
- [ ] Hosted outside the Space Apps site (YouTube, Google Drive…), public, no sign-in. Tested in a private window by someone who is not the owner.
- [ ] English subtitles (`demo/subtitles.srt`).
- [ ] AI voice acknowledged in the video, its description and its metadata (see `DEMO.md`).
- [ ] No NASA logos, flags or mission identifiers, and nothing from the Pink Panther films (character, theme music, title art).

**Final project link**
- [ ] https://pink-panther-pi.vercel.app/ opens in a private window, on a laptop and on a phone, with no sign-in.
- [ ] The GitHub repository is public.

**Submit**
- [ ] The three checkboxes: Project Submission Guide, Terms and Conditions and Privacy Policy; "Confirm All Work is Original"; external resources listed.
- [ ] "Submit for Judging" pressed before 11:59 p.m. on Sunday in the Team Owner's Local Event time zone (**confirm** the exact time with the Local Lead). Saving is not submitting.

**Confirm**
- [ ] The source of the Earth textures and of the NASA temperature image (sections below).
- [ ] The AI field describes how the team actually worked.
- [ ] `[TEAM NAME]` in the demo files.
