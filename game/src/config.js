// Aurora Ridge — shared constants, palettes and mission definitions.
// One sun direction drives the sky shader, the key light, the fog colour
// and the cloud tint, so the whole frame agrees about where the sun is.
export const WORLD = {
  size: 4200,          // play area, metres, centred on 0,0
  waterY: 2,           // lake / sea level
  snowLine: 720,       // metres: above this, snow
  rockSlope: 0.55,     // slope above this reads as rock
};

// Sun directions are unit vectors pointing TOWARD the sun.
export const SUN = {
  golden: { x: -0.55, y: 0.22, z: -0.80 },   // low, ahead-left of the runway heading
  storm:  { x: -0.30, y: 0.10, z: -0.90 },
  night:  { x: 0.20,  y: 0.45, z: -0.60 },
};

export const PALETTES = {
  golden: {
    zenith: 0x4a3f8a, horizon: 0xff9a4d, mid: 0xe0708a, sun: 0xffd27a, sunCore: 0xfff3c4,
    fog: 0xf58a4a, fogDensity: 0.00042,
    key: 0xffb36b, keyIntensity: 2.6, hemiSky: 0x8a7fd6, hemiGround: 0x5a3a28, hemi: 0.85,
    cloudTop: 0xffd9b0, cloudBottom: 0xff9d7a, cloudOpacity: 0.85,
    water: 0x14424e, waterGlitter: 0xffb36b,
    exposure: 1.08,
  },
  storm: {
    zenith: 0x0a0d18, horizon: 0x2a3040, mid: 0x232838, sun: 0x8a93a8, sunCore: 0xb9c0d0,
    fog: 0x232833, fogDensity: 0.0011,
    key: 0x9aa4b8, keyIntensity: 0.55, hemiSky: 0x3a4358, hemiGround: 0x1a1d24, hemi: 0.5,
    cloudTop: 0x3c4356, cloudBottom: 0x141824, cloudOpacity: 0.95,
    water: 0x0d1a22, waterGlitter: 0x5a6a7a,
    exposure: 0.95,
  },
  night: {
    zenith: 0x05060f, horizon: 0x1a2340, mid: 0x141c33, sun: 0xcfd8ff, sunCore: 0xffffff,
    fog: 0x11182c, fogDensity: 0.0007,
    key: 0x8fa0d8, keyIntensity: 0.5, hemiSky: 0x2a3358, hemiGround: 0x0d0f16, hemi: 0.45,
    cloudTop: 0x2c3450, cloudBottom: 0x12141f, cloudOpacity: 0.9,
    water: 0x0a1420, waterGlitter: 0x8fa0d8,
    exposure: 0.9,
  },
  clouds: { // sortie 04: above the deck, sun still golden
    zenith: 0x4a3f8a, horizon: 0xffa85e, mid: 0xe0708a, sun: 0xffd27a, sunCore: 0xfff6cf,
    fog: 0xff9a55, fogDensity: 0.00030,
    key: 0xffb36b, keyIntensity: 2.8, hemiSky: 0x9a8ad6, hemiGround: 0x6a4a34, hemi: 0.95,
    cloudTop: 0xffe9c4, cloudBottom: 0xffab7a, cloudOpacity: 0.95,
    water: 0x14424e, waterGlitter: 0xffb36b,
    exposure: 1.12,
  },
};

export const PLANE = {
  name: 'AURORA-9',
  callsign: 'AURORA RIDGE',
  stallKt: 58,       // clean stall; flaps lower it
  stallKtFlaps: 46,
  maxG: 4.0,         // over-G damages the airframe
  cruiseKt: 150,
  maxKt: 210,
  climbFpm: 1400,
  fuelBurnPerMin: 0.55, // % per minute at full throttle
};

export const MISSIONS = [
  {
    id: 1, name: 'RIDGE GATE RUN', code: 'GATE RUN', type: 'gates',
    brief: 'Thread 7 gold gates down the valley. Smooth wins — hard banks cost G.',
    par: '7:00', gates: 7, fuel: 78, weather: 'golden', reward: 1200,
  },
  {
    id: 2, name: 'VALLEY LANDING', code: 'LANDING', type: 'landing',
    brief: 'Final approach RWY 36. Touch down soft, on the centreline, flaps set.',
    par: '6:00', gates: 2, fuel: 64, weather: 'golden', reward: 1400,
  },
  {
    id: 3, name: 'STORM WINDOW', code: 'STORM', type: 'gates',
    brief: 'Beat the front through the valley before it closes. Gusts, rain, lightning.',
    par: '8:00', gates: 6, fuel: 58, weather: 'storm', frontEtaSec: 168, reward: 1800,
  },
  {
    id: 4, name: 'ABOVE THE CLOUDS', code: 'CLOUDS', type: 'gates',
    brief: 'Climb through the deck and run the high gates in the evening sun.',
    par: '7:30', gates: 5, fuel: 72, weather: 'clouds', reward: 1600,
  },
  {
    id: 5, name: 'SUPPLY DROP', code: 'DROP', type: 'drop',
    brief: 'Drop 3 crates on the valley outposts. Slow, low, steady over the ring.',
    par: '9:00', gates: 3, fuel: 66, weather: 'storm', frontEtaSec: 168, reward: 1700,
  },
  {
    id: 6, name: 'NIGHT PATROL', code: 'NIGHT', type: 'gates',
    brief: 'Night circuit of the valley beacons. Landing lights on, watch the ridges.',
    par: '8:00', gates: 6, fuel: 60, weather: 'night', reward: 1900,
  },
];

export const RUNWAY = {
  x: 150, z: 350, headingDeg: 0, length: 900, width: 30,
  // threshold (south end, RWY 36 approach from the south)
  threshold: { x: 150, z: 800 },
};

export const DROP_ZONES = [
  { name: 'TARN FIELD', x: -120, z: 1150 },
  { name: 'OUTPOST BRAVO', x: -260, z: -420 },
  { name: 'GLACIER CAMP', x: 420, z: -900 },
];

// Seeded world constants so every load builds the same valley.
export const SEED = 20261127;
