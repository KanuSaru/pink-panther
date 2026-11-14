// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// What the observatory can study, and where each thing comes from.
// Add a variable here and it appears in the interface; nothing else to change.

// Diverging palettes, 11 classes, low -> high (ColorBrewer)
export const PALETTES = {
  // cooler -> warmer
  temp: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'],
  // drier -> wetter
  water: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
  // less -> more (wind, sunlight)
  other: ['#2d004b', '#542788', '#8073ac', '#b2abd2', '#d8daeb', '#f7f7f7', '#fee0b6', '#fdb863', '#e08214', '#b35806', '#7f3b08'],
};

// Line colours for the chart, one pair per palette. Checked against the panel
// colour for contrast and colour-vision-deficiency separation.
export const TREND_COLORS = {
  temp: { up: '#d6604d', down: '#4393c3' },
  water: { up: '#1fa59a', down: '#bf812d' },
  other: { up: '#d67a14', down: '#8a6fc4' },
};

export function paletteFloats(name) {
  const out = new Float32Array(33);
  PALETTES[name].forEach((hex, i) => {
    out[i * 3] = parseInt(hex.slice(1, 3), 16) / 255;
    out[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
    out[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
  });
  return out;
}

// NASA POWER parameters (monthly API, community AG; meteorology from MERRA-2, 1981 onward).
// `gibs` is the matching NASA GIBS imagery layer shown in the satellite view, when one exists.
export const VARIABLES = [
  { id: 'T2M', about: { es: 'Temperatura media del aire a dos metros del suelo: la que sentimos al aire libre.', en: 'Average air temperature two meters above the ground: what we feel outdoors.' },
    group: 'atmosphere', unit: '°C', palette: 'temp', decimals: 2, gibs: 'MERRA2_2m_Air_Temperature_Monthly',
    name: { es: 'Temperatura del aire a 2 m', en: 'Air temperature at 2 m' } },
  { id: 'T2M_MAX', about: { es: 'La temperatura más alta del aire a dos metros del suelo, promediada en el mes.', en: 'The highest air temperature two meters above the ground, averaged over the month.' },
    group: 'atmosphere', unit: '°C', palette: 'temp', decimals: 2, gibs: 'MERRA2_2m_Air_Temperature_Monthly',
    name: { es: 'Temperatura máxima a 2 m', en: 'Maximum temperature at 2 m' } },
  { id: 'T2M_MIN', about: { es: 'La temperatura más baja del aire a dos metros del suelo, promediada en el mes.', en: 'The lowest air temperature two meters above the ground, averaged over the month.' },
    group: 'atmosphere', unit: '°C', palette: 'temp', decimals: 2, gibs: 'MERRA2_2m_Air_Temperature_Monthly',
    name: { es: 'Temperatura mínima a 2 m', en: 'Minimum temperature at 2 m' } },
  { id: 'PRECTOTCORR', about: { es: 'Lluvia y nieve que llegan a la superficie, en milímetros por día.', en: 'Rain and snow reaching the surface, in millimeters per day.' },
    group: 'atmosphere', unit: 'mm/día', unitEn: 'mm/day', palette: 'water', decimals: 2, gibs: 'MERRA2_Precipitation_Bias_Corrected_Monthly',
    name: { es: 'Precipitación', en: 'Precipitation' } },
  { id: 'RH2M', about: { es: 'Cuánta humedad tiene el aire frente al máximo que podría contener a esa temperatura.', en: 'How much moisture the air holds compared with the most it could hold at that temperature.' },
    group: 'atmosphere', unit: '%', palette: 'water', decimals: 2, gibs: null,
    name: { es: 'Humedad relativa a 2 m', en: 'Relative humidity at 2 m' } },
  { id: 'WS2M', about: { es: 'Velocidad media del viento a dos metros del suelo.', en: 'Average wind speed two meters above the ground.' },
    group: 'atmosphere', unit: 'm/s', palette: 'other', decimals: 2, gibs: 'MERRA2_Surface_Wind_Speed_Monthly',
    name: { es: 'Velocidad del viento a 2 m', en: 'Wind speed at 2 m' } },
  { id: 'GWETTOP', about: { es: 'Qué tan mojados están los primeros 5 cm del suelo: 0 es seco, 1 es saturado.', en: 'How wet the top 5 cm of soil is: 0 is dry, 1 is saturated.' },
    group: 'water', unit: '0–1', palette: 'water', decimals: 3, gibs: null,
    name: { es: 'Humedad superficial del suelo', en: 'Surface soil wetness' } },
  { id: 'GWETROOT', about: { es: 'Qué tan mojado está el suelo hasta un metro de profundidad, donde beben las raíces: 0 es seco, 1 es saturado.', en: 'How wet the soil is down to one meter, where roots drink: 0 is dry, 1 is saturated.' },
    group: 'water', unit: '0–1', palette: 'water', decimals: 3, gibs: 'MERRA2_Soil_Water_Root_Zone_Monthly',
    name: { es: 'Humedad del suelo en la zona de raíces', en: 'Root-zone soil wetness' } },
  { id: 'TS', about: { es: 'Temperatura de la propia superficie (suelo, agua o hielo), no del aire.', en: 'Temperature of the surface itself (ground, water or ice), not of the air.' },
    group: 'land', unit: '°C', palette: 'temp', decimals: 2, gibs: 'MERRA2_Surface_Skin_Temperature_Monthly',
    name: { es: 'Temperatura de la superficie', en: 'Surface skin temperature' } },
];

export const GROUPS = {
  atmosphere: { es: 'Atmósfera', en: 'Atmosphere' },
  water: { es: 'Agua', en: 'Water' },
  land: { es: 'Terreno', en: 'Land' },
};

// Demonstration cases: one click sets the variable, the months and the place.
export const EXAMPLES = [
  { lat: 10.99, lon: -74.8, variable: 'T2M', season: 'ANN', place: { es: 'Barranquilla', en: 'Barranquilla' }, label: { es: 'Calor en Barranquilla', en: 'Heat in Barranquilla' } },
  { lat: 78.2, lon: 15.6, variable: 'T2M', season: 'DJF', place: { es: 'Svalbard', en: 'Svalbard' }, label: { es: 'Inviernos en Svalbard', en: 'Winters in Svalbard' } },
  { lat: 13.5, lon: 2.1, variable: 'PRECTOTCORR', season: 'JJA', place: { es: 'el Sahel', en: 'the Sahel' }, label: { es: 'Lluvias del Sahel', en: 'Sahel rains' } },
  { lat: -9.5, lon: -56.0, variable: 'GWETROOT', season: 'JJA', place: { es: 'el sur de la Amazonía', en: 'the southern Amazon' }, label: { es: 'Suelo de la Amazonía', en: 'Amazon soil' } },
  { lat: 45.0, lon: 60.0, variable: 'TS', season: 'JJA', place: { es: 'el mar de Aral', en: 'the Aral Sea' }, label: { es: 'Mar de Aral', en: 'Aral Sea' } },
  { lat: 62.0, lon: 129.7, variable: 'T2M_MIN', season: 'ANN', place: { es: 'Siberia', en: 'Siberia' }, label: { es: 'Noches de Siberia', en: 'Siberian nights' } },
];

export const POWER_FIRST_YEAR = 1981;
export const GIBS_FIRST_YEAR = 1980;
export const HORIZON_MAX = 2100;
export const REGION_SIZE = 8; // degrees; the POWER regional API accepts 2 to 10

export const SOURCES = {
  power: { name: 'NASA POWER (MERRA-2)', url: 'https://power.larc.nasa.gov/' },
  gistemp: { name: 'NASA GISS Surface Temperature Analysis (GISTEMP v4)', url: 'https://data.giss.nasa.gov/gistemp/' },
  gibs: { name: 'NASA Global Imagery Browse Services (GIBS)', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' },
};

// Everything this project uses, shown in the "Data and credits" dialog.
export const CREDITS = [
  { name: 'NASA POWER', url: 'https://power.larc.nasa.gov/', note: { es: 'Series mensuales por punto y por región (MERRA-2, NASA GMAO).', en: 'Monthly point and regional series (MERRA-2, NASA GMAO).' } },
  { name: 'NASA GISTEMP v4', url: 'https://data.giss.nasa.gov/gistemp/', note: { es: 'Anomalías anuales de temperatura por franja de latitud, desde 1880.', en: 'Annual temperature anomalies by latitude band, since 1880.' } },
  { name: 'NASA GIBS', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api', note: { es: 'Imágenes mensuales globales de MERRA-2 para la vista de satélite.', en: 'Global monthly MERRA-2 imagery for the satellite view.' } },
  { name: 'Solar System Scope', url: 'https://www.solarsystemscope.com/textures/', note: { es: 'Texturas de la Tierra (día, nubes, relieve, océanos), CC BY 4.0, a partir de imágenes de NASA.', en: 'Earth textures (day, clouds, relief, oceans), CC BY 4.0, based on NASA imagery.' } },
  { name: 'three.js', url: 'https://threejs.org/', note: { es: 'Motor 3D (licencia MIT). La atmósfera adapta el ejemplo webgpu_tsl_earth.', en: '3D engine (MIT license). The atmosphere adapts the webgpu_tsl_earth example.' } },
  { name: 'VisualPDE', url: 'https://visualpde.com/', note: { es: 'Método del motor de predicción: una ecuación en derivadas parciales resuelta paso a paso en un shader, con dos texturas que se alternan. No se copió código.', en: 'Method of the prediction engine: a partial differential equation stepped in a shader between two alternating textures. No code was copied.' } },
  { name: 'IPCC AR6 WG1', url: 'https://www.ipcc.ch/report/ar6/wg1/', note: { es: 'Sensibilidad climática (3 °C, probable 2,5 a 4), forzamiento de 2×CO2 (3,93 W/m²) y valores de referencia.', en: 'Climate sensitivity (3 °C, likely 2.5 to 4), 2×CO2 forcing (3.93 W/m²) and reference values.' } },
  { name: 'ColorBrewer', url: 'https://colorbrewer2.org/', note: { es: 'Paletas divergentes de Cynthia Brewer (Apache 2.0).', en: 'Diverging palettes by Cynthia Brewer (Apache 2.0).' } },
  { name: 'Instrument Sans', url: 'https://fonts.google.com/specimen/Instrument+Sans', note: { es: 'Tipografía (SIL Open Font License).', en: 'Typeface (SIL Open Font License).' } },
];
