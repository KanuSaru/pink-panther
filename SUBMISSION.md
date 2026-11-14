# Space Apps 2026 submission notes

Text for the three form fields. Items marked **confirm** depend on where the team obtained a file and should be checked before submitting.

## 1. Data, resources, and tools used

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
| three.js example `webgpu_tsl_earth` | The atmosphere shader is a GLSL port of this example's technique and constants | MIT |
| VisualPDE (visualpde.com; Walker, Townsend, Chudasama and Krause, 2023) | Method of the prediction engine: a PDE advanced by explicit time steps in a fragment shader between two alternating float textures. The idea was followed; no code was copied | Open source site; paper in Bull. Math. Biol. 85:113 |
| ColorBrewer palettes (RdBu, BrBG, PuOr) by Cynthia Brewer | Diverging colour scales | Apache 2.0 |
| Instrument Sans, from Google Fonts | Typeface | SIL Open Font License 1.1 |

**Methods (published references)**

- IPCC AR6 WG1 (2021), Summary for Policymakers and chapter 7: equilibrium climate sensitivity (best estimate 3 °C, likely 2.5 to 4 °C), forcing of doubled CO2 (3.93 W/m²), and the reference values shown next to the model's diagnosed forcing and energy imbalance.
- Geoffroy, O. et al. (2013), J. Climate 26: two-layer energy balance model and its CMIP5 multi-model parameters.
- North, G. R. (1975), J. Atmos. Sci. 32, and North, G. R. and Kim, K.-Y. (2017), Energy Balance Climate Models: diffusive energy balance models on the sphere.
- Mann, H. B. (1945) and Kendall, M. G. (1975): Mann-Kendall trend test.
- Sen, P. K. (1968): Theil-Sen slope and its confidence interval.
- Yue, S. and Wang, C. Y. (2004): variance correction of the Mann-Kendall test for autocorrelated series.
- Benjamini, Y. and Hochberg, Y. (1995): false discovery rate. Wilks, D. S. (2016) on applying it to gridded fields.

**Tools**

- Vercel: hosting and three small proxy functions.
- Node.js: unit tests of the statistics.
- Python with Pillow and NumPy: converting the textures and decoding the temperature image.
- Headless Chrome with Playwright: checking the interface and the shaders during development.
- Claude (Anthropic): code generation, see section 3.

**Space Agency Partner data**: none is used in this version. The resources listed on the challenge page (Giovanni, AppEEARS, Hydrology Time Series, Climate Data Online, KNMI Climate Explorer, CSA datasets) are not data sources of the app.

## 2. NASA data and resources, in detail

1. **NASA POWER Monthly API**: `https://power.larc.nasa.gov/api/temporal/monthly/point` and `/regional`, community `AG`, format JSON. Parameters: `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `GWETTOP`, `GWETROOT`, `TS`. The meteorological parameters come from the MERRA-2 reanalysis (NASA Global Modeling and Assimilation Office) on a 0.5° × 0.625° grid, one of the models named in the challenge statement. The app requests the full record from 1981 for the place the user selects, builds annual or seasonal series, estimates the trend (Theil-Sen), and tests its significance (Mann-Kendall, t-test, confidence interval). For a region it requests the grid in one call and tests every cell.

2. **NASA GISS Surface Temperature Analysis (GISTEMP v4)**: table `https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv`, annual anomalies relative to 1951–1980 for the globe and for eight latitude bands, 1880 to present. It drives the planet view: the globe shader colours each band for the selected year, and the same trend analysis shows that the bands warm at different rates. It also calibrates the energy balance model that projects the planet forward: present state, deep-ocean heat and the feedback of each latitude are diagnosed from this record. Citation: GISTEMP Team, 2026: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute for Space Studies. https://data.giss.nasa.gov/gistemp/

3. **NASA Global Imagery Browse Services (GIBS)**: WMS endpoint `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`. Layers: `MERRA2_2m_Air_Temperature_Monthly`, `MERRA2_Precipitation_Bias_Corrected_Monthly`, `MERRA2_Surface_Wind_Speed_Monthly`, `MERRA2_Soil_Water_Root_Zone_Monthly`, `MERRA2_Surface_Skin_Temperature_Monthly`. Each is wrapped on the globe for the month and year chosen on the timeline. Acknowledgement: we acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

4. **NASA global surface temperature image** (supplied by the team): its colour legend (192–320 K) was inverted pixel by pixel to obtain an approximate temperature field, used as the base of the "Temperature" view together with the same palette.

5. **NASA Blue Marble imagery**, through the Solar System Scope textures (**confirm**), for the natural view of the globe.

## 3. Use of SI tools

Yes. We used Claude (Anthropic), a large language model, as a programming assistant.

- **What it did**: wrote the application code (three.js scene and GLSL shaders, the energy balance model and its GPU solver, data access, statistics, chart, interface, Vercel functions, tests), wrote the script that converted the textures and decoded the NASA temperature image into `assets/temp_base.png`, and drafted the documentation.
- **What it also proposed**: within the team's proposal (which already named NASA POWER and temperature as the first variable), it suggested the two additional NASA sources (GISTEMP and GIBS), the specific statistical tests, and the formulation of the energy balance model used for the planet projection.
- **What came from the team**: the idea, the choice of challenge, the project proposal and its objectives, the first data source and variable, and the image resources. No images, audio or video were generated with SI.
- **How it is indicated**: every source file starts with an SI disclosure comment; `package.json` has an `siDisclosure` field; `index.html` carries a `<meta name="generator">` tag; the two derived PNG files carry the disclosure in their embedded metadata; the "About" dialog in the app and the README state it in text.
- No NASA branding or design elements appear in the generated content.

## Before submitting

- [ ] Confirm the source of the Earth textures and of the NASA temperature image, and correct sections 1 and 2 if they differ.
- [ ] Open the deployed site and run one example in each view; the About dialog lists the same credits as this file.
- [ ] Adjust section 3 so it describes how the team actually worked.
