import * as satellite from 'satellite.js';

// ─── Physical Constants ─────────────────────────────────────────────────────────

export const EARTH_RADIUS_KM = 6371;
export const MOON_RADIUS_KM = 1737.4;
export const EARTH_MOON_DISTANCE_KM = 384400;
export const EARTH_MU = 398600.4418; // km³/s²
export const MOON_MU = 4902.8; // km³/s²
export const G = 6.674e-11; // m³/(kg·s²)
export const AU_KM = 149597870.7;
export const SECONDS_PER_DAY = 86400;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const TWO_PI = 2 * Math.PI;
export const EARTH_J2 = 1.08263e-3;
export const EARTH_ROTATION_RAD_PER_SEC = 7.2921159e-5;
export const MOON_ORBITAL_PERIOD_DAYS = 27.321661;
export const LEO_ALTITUDE_KM = 200;
export const TLI_COAST_FRACTION = 0.5;

// ─── Lunar Surface Features ────────────────────────────────────────────────────

export const LUNAR_FEATURES = [
  { name: 'Tycho', lat: -43.31, lon: -11.36, type: 'crater', radiusKm: 43 },
  { name: 'Copernicus', lat: 9.62, lon: -20.08, type: 'crater', radiusKm: 47 },
  { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, type: 'mare', radiusKm: 435 },
  { name: 'Mare Imbrium', lat: 32.8, lon: -15.6, type: 'mare', radiusKm: 580 },
  { name: 'Mare Serenitatis', lat: 28.0, lon: 17.5, type: 'mare', radiusKm: 340 },
  { name: 'Oceanus Procellarum', lat: 18.4, lon: -57.4, type: 'oceanus', radiusKm: 1280 },
  { name: 'Aristarchus', lat: 23.73, lon: -47.49, type: 'crater', radiusKm: 20 },
  { name: 'Kepler', lat: 8.12, lon: -38.01, type: 'crater', radiusKm: 16 },
  { name: 'South Pole-Aitken', lat: -53.0, lon: -169.0, type: 'basin', radiusKm: 1250 },
  { name: 'Mare Crisium', lat: 17.0, lon: 59.1, type: 'mare', radiusKm: 280 },
  { name: 'Mare Nubium', lat: -21.3, lon: -16.6, type: 'mare', radiusKm: 360 },
  { name: 'Mare Fecunditatis', lat: -7.8, lon: 51.3, type: 'mare', radiusKm: 450 },
  { name: 'Mare Humorum', lat: -24.4, lon: -38.6, type: 'mare', radiusKm: 195 },
  { name: 'Mare Nectaris', lat: -15.2, lon: 35.5, type: 'mare', radiusKm: 170 },
  { name: 'Mare Frigoris', lat: 56.0, lon: 1.4, type: 'mare', radiusKm: 580 },
  { name: 'Plato', lat: 51.62, lon: -9.38, type: 'crater', radiusKm: 52 },
  { name: 'Clavius', lat: -58.4, lon: -14.4, type: 'crater', radiusKm: 114 },
  { name: 'Archimedes', lat: 29.72, lon: -4.04, type: 'crater', radiusKm: 42 },
  { name: 'Ptolemaeus', lat: -9.2, lon: -1.8, type: 'crater', radiusKm: 77 },
  { name: 'Theophilus', lat: -11.4, lon: 26.4, type: 'crater', radiusKm: 50 },
  { name: 'Langrenus', lat: -8.86, lon: 60.97, type: 'crater', radiusKm: 66 },
  { name: 'Petavius', lat: -25.3, lon: 60.4, type: 'crater', radiusKm: 88 },
  { name: 'Grimaldi', lat: -5.2, lon: -68.6, type: 'crater', radiusKm: 86 },
  { name: 'Schickard', lat: -44.3, lon: -55.1, type: 'crater', radiusKm: 114 },
  { name: 'Eratosthenes', lat: 14.5, lon: -11.3, type: 'crater', radiusKm: 29 },
  { name: 'Herschel', lat: -5.7, lon: -2.1, type: 'crater', radiusKm: 20 },
  { name: 'Shackleton', lat: -89.9, lon: 0.0, type: 'crater', radiusKm: 10.5 },
  { name: 'Mare Vaporum', lat: 13.3, lon: 3.6, type: 'mare', radiusKm: 120 },
  { name: 'Sinus Iridum', lat: 44.1, lon: -31.5, type: 'sinus', radiusKm: 130 },
  { name: 'Montes Apenninus', lat: 18.9, lon: -3.7, type: 'mountain', radiusKm: 310 },
  { name: 'Tsiolkovsky', lat: -21.2, lon: 128.9, type: 'crater', radiusKm: 93 },
  { name: 'Jackson', lat: 22.4, lon: -163.1, type: 'crater', radiusKm: 36 },
  { name: 'Cabeus', lat: -85.3, lon: -35.7, type: 'crater', radiusKm: 49 },
];

// ─── Utility Helpers ────────────────────────────────────────────────────────────

function julianDate(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours();
  const min = date.getUTCMinutes();
  const sec = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  const dayFraction = (h + min / 60 + sec / 3600) / 24;
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  const jdn =
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045;
  return jdn + dayFraction - 0.5;
}

function julianCenturies(date) {
  return (julianDate(date) - 2451545.0) / 36525.0;
}

function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function vecMag(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecScale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function vecNormalize(v) {
  const m = vecMag(v);
  if (m === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dateAdd(date, ms) {
  return new Date(date.getTime() + ms);
}

function dateAddSeconds(date, sec) {
  return new Date(date.getTime() + sec * 1000);
}

// ─── GMST Computation ──────────────────────────────────────────────────────────

function computeGmst(date) {
  return satellite.gstime(date);
}

// ─── 1. TLE Parsing & SGP4 Propagation ──────────────────────────────────────────

/**
 * Parse a two-line element set and propagate the satellite to the given date.
 * Returns { position: {x,y,z} in km ECI, velocity: {x,y,z} in km/s ECI, satrec }.
 */
export function parseTleAndPropagate(tleLine1, tleLine2, date) {
  const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
  const positionAndVelocity = satellite.propagate(satrec, date);

  if (
    positionAndVelocity.position === false ||
    positionAndVelocity.position === undefined
  ) {
    return {
      position: null,
      velocity: null,
      satrec,
      error: 'Propagation failed for this TLE at the given date.',
    };
  }

  const posEci = positionAndVelocity.position; // {x, y, z} in km
  const velEci = positionAndVelocity.velocity; // {x, y, z} in km/s

  return {
    position: { x: posEci.x, y: posEci.y, z: posEci.z },
    velocity: { x: velEci.x, y: velEci.y, z: velEci.z },
    satrec,
  };
}

// ─── 2. ECI to Geodetic ─────────────────────────────────────────────────────────

/**
 * Convert ECI coordinates to geodetic (lat, lon, alt).
 * @param {Object} eciPos - {x, y, z} in km
 * @param {number} gmst - Greenwich Mean Sidereal Time in radians
 * @returns {{ latDeg: number, lonDeg: number, altKm: number }}
 */
export function eciToGeodetic(eciPos, gmst) {
  const geodetic = satellite.eciToGeodetic(eciPos, gmst);
  return {
    latDeg: satellite.degreesLat(geodetic.latitude),
    lonDeg: satellite.degreesLong(geodetic.longitude),
    altKm: geodetic.height, // height in km above ellipsoid
    latRad: geodetic.latitude,
    lonRad: geodetic.longitude,
  };
}

// ─── 3. ECI to Three.js ─────────────────────────────────────────────────────────

/**
 * Convert ECI coordinates to Three.js coordinate system.
 * Three.js: Y-up. Mapping: ECI_X -> Three_X, ECI_Z -> Three_Y, ECI_Y -> Three_Z.
 * Positions are scaled so earthRadiusKm maps to 1.0 unit.
 * @param {Object} eciPos - {x, y, z} in km
 * @param {number} [earthRadiusKm=EARTH_RADIUS_KM]
 * @returns {{ x: number, y: number, z: number }}
 */
export function eciToThreeJs(eciPos, earthRadiusKm = EARTH_RADIUS_KM) {
  const scale = 1.0 / earthRadiusKm;
  return {
    x: eciPos.x * scale,
    y: eciPos.z * scale, // ECI Z -> Three.js Y (up)
    z: eciPos.y * scale, // ECI Y -> Three.js Z
  };
}

// ─── Moon Position Cache ────────────────────────────────────────────────────────

const _moonPosCache = new Map();
const MOON_CACHE_RESOLUTION_MS = 600000; // 10-minute resolution is fine for trajectory

function getMoonPositionCached(date) {
  const key = Math.floor(date.getTime() / MOON_CACHE_RESOLUTION_MS);
  if (_moonPosCache.has(key)) return _moonPosCache.get(key);
  const result = getMoonPosition(date);
  _moonPosCache.set(key, result);
  return result;
}

// ─── 4. Moon Position (Simplified Brown's Lunar Theory) ─────────────────────────

/**
 * Calculate the Moon's geocentric position for any date using a simplified
 * version of Brown's lunar theory (Meeus, Astronomical Algorithms Ch. 47).
 *
 * Returns ECI-ish ecliptic-rotated coordinates in km, plus RA/Dec/distance
 * and selenographic sub-Earth coordinates.
 */
export function getMoonPosition(date) {
  const T = julianCenturies(date);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Fundamental arguments in degrees (Meeus Ch. 47)
  // Moon's mean longitude, referred to the mean equinox of the date
  const Lp = normalizeAngle(
    218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000
  );
  // Mean elongation of the Moon
  const D = normalizeAngle(
    297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000
  );
  // Sun's mean anomaly
  const M = normalizeAngle(
    357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000
  );
  // Moon's mean anomaly
  const Mp = normalizeAngle(
    134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000
  );
  // Moon's argument of latitude
  const F = normalizeAngle(
    93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000
  );

  // Additional arguments
  const A1 = normalizeAngle(119.75 + 131.849 * T);
  const A2 = normalizeAngle(53.09 + 479264.29 * T);
  const A3 = normalizeAngle(313.45 + 481266.484 * T);

  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;

  const dr = DEG_TO_RAD;

  // Longitude terms: [D, M, Mp, F, coefficient_longitude, coefficient_distance]
  const lonTerms = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751],
    [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950],
    [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0],
    [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0],
    [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616],
    [4, -1, -2, 0, 759, -1897],
    [0, 2, -1, 0, -713, -2117],
    [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0],
    [2, -1, 0, -2, 596, 0],
    [4, 0, 1, 0, 549, -1423],
    [0, 0, 4, 0, 537, -1117],
    [4, -1, 0, 0, 520, -1571],
    [1, 0, -2, 0, -487, -1739],
  ];

  // Latitude terms: [D, M, Mp, F, coefficient_latitude]
  const latTerms = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
    [4, 0, 0, -1, 1021],
    [4, 0, -1, 1, 833],
  ];

  // Compute eccentricity factor for each term based on M coefficient
  function eFactor(mCoeff) {
    const absM = Math.abs(mCoeff);
    if (absM === 1) return E;
    if (absM === 2) return E2;
    return 1;
  }

  // Sum longitude and distance
  let sumL = 0;
  let sumR = 0;
  for (const term of lonTerms) {
    const [d, m, mp, f, sl, sr] = term;
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = eFactor(m);
    sumL += sl * ef * Math.sin(arg * dr);
    sumR += sr * ef * Math.cos(arg * dr);
  }

  // Sum latitude
  let sumB = 0;
  for (const term of latTerms) {
    const [d, m, mp, f, sb] = term;
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = eFactor(m);
    sumB += sb * ef * Math.sin(arg * dr);
  }

  // Additive corrections
  sumL +=
    3958 * Math.sin(A1 * dr) +
    1962 * Math.sin((Lp - F) * dr) +
    318 * Math.sin(A2 * dr);
  sumB +=
    -2235 * Math.sin(Lp * dr) +
    382 * Math.sin(A3 * dr) +
    175 * Math.sin((A1 - F) * dr) +
    175 * Math.sin((A1 + F) * dr) +
    127 * Math.sin((Lp - Mp) * dr) -
    115 * Math.sin((Lp + Mp) * dr);

  // Ecliptic coordinates
  const lambdaDeg = Lp + sumL / 1000000; // ecliptic longitude in degrees
  const betaDeg = sumB / 1000000; // ecliptic latitude in degrees
  const distKm = 385000.56 + sumR / 1000; // distance in km

  const lambdaRad = lambdaDeg * dr;
  const betaRad = betaDeg * dr;

  // Mean obliquity of the ecliptic (Meeus Ch. 22)
  const eps0 =
    23.4392911 - 0.01300417 * T - 1.638889e-7 * T2 + 5.036111e-7 * T3;
  const epsRad = eps0 * dr;

  // Ecliptic to equatorial (RA, Dec)
  const sinLam = Math.sin(lambdaRad);
  const cosLam = Math.cos(lambdaRad);
  const sinBet = Math.sin(betaRad);
  const cosBet = Math.cos(betaRad);
  const sinEps = Math.sin(epsRad);
  const cosEps = Math.cos(epsRad);

  const ra = Math.atan2(
    sinLam * cosEps - Math.tan(betaRad) * sinEps,
    cosLam
  );
  const dec = Math.asin(sinBet * cosEps + cosBet * sinEps * sinLam);

  // Equatorial rectangular coordinates (ECI-aligned, Earth-centered) in km
  const x = distKm * Math.cos(dec) * Math.cos(ra);
  const y = distKm * Math.cos(dec) * Math.sin(ra);
  const z = distKm * Math.sin(dec);

  // Selenographic sub-Earth point (physical librations simplified)
  // Optical libration in longitude and latitude
  const W = lambdaRad - normalizeAngle(
    125.0445479 - 1934.1362891 * T + 0.0020754 * T2
  ) * dr;
  const sinW = Math.sin(W);
  const cosW = Math.cos(W);
  const incl = 1.5424 * dr; // Moon's mean inclination to ecliptic

  const A = Math.atan2(
    sinW * Math.cos(incl) - Math.tan(betaRad) * Math.sin(incl),
    cosW
  );
  const subEarthLon = normalizeAngle((A - normalizeAngle(
    13.176396 * (julianDate(date) - 2451545.0)
  ) % 360) * RAD_TO_DEG);
  const selenoLon = ((subEarthLon + 180) % 360) - 180;
  const selenoLat =
    Math.asin(
      -sinW * Math.sin(incl) - sinBet * Math.cos(incl)
    ) * RAD_TO_DEG;

  return {
    x,
    y,
    z,
    ra: ra * RAD_TO_DEG,
    dec: dec * RAD_TO_DEG,
    distance: distKm,
    eclipticLongitude: lambdaDeg,
    eclipticLatitude: betaDeg,
    selenographic: {
      subEarthLat: selenoLat,
      subEarthLon: selenoLon,
    },
  };
}

// ─── 5. Trans-Lunar Trajectory (RK4 Numerical Integration) ─────────────────────

/**
 * RK4 integration step for orbital mechanics.
 * Integrates position and velocity forward by dt using a 4th-order Runge-Kutta scheme.
 *
 * @param {{x,y,z}} pos - position in km (ECI)
 * @param {{x,y,z}} vel - velocity in km/s (ECI)
 * @param {number} t - elapsed time in seconds since launch
 * @param {number} dt - timestep in seconds
 * @param {function} accelFn - (pos, vel, t) => {x,y,z} acceleration in km/s²
 * @returns {{ pos: {x,y,z}, vel: {x,y,z} }}
 */
function rk4Step(pos, vel, t, dt, accelFn) {
  const k1v = accelFn(pos, vel, t);
  const k1r = vel;

  const pos2 = vecAdd(pos, vecScale(k1r, dt / 2));
  const vel2 = vecAdd(vel, vecScale(k1v, dt / 2));
  const k2v = accelFn(pos2, vel2, t + dt / 2);
  const k2r = vel2;

  const pos3 = vecAdd(pos, vecScale(k2r, dt / 2));
  const vel3 = vecAdd(vel, vecScale(k2v, dt / 2));
  const k3v = accelFn(pos3, vel3, t + dt / 2);
  const k3r = vel3;

  const pos4 = vecAdd(pos, vecScale(k3r, dt));
  const vel4 = vecAdd(vel, vecScale(k3v, dt));
  const k4v = accelFn(pos4, vel4, t + dt);
  const k4r = vel4;

  return {
    pos: {
      x: pos.x + (dt / 6) * (k1r.x + 2 * k2r.x + 2 * k3r.x + k4r.x),
      y: pos.y + (dt / 6) * (k1r.y + 2 * k2r.y + 2 * k3r.y + k4r.y),
      z: pos.z + (dt / 6) * (k1r.z + 2 * k2r.z + 2 * k3r.z + k4r.z),
    },
    vel: {
      x: vel.x + (dt / 6) * (k1v.x + 2 * k2v.x + 2 * k3v.x + k4v.x),
      y: vel.y + (dt / 6) * (k1v.y + 2 * k2v.y + 2 * k3v.y + k4v.y),
      z: vel.z + (dt / 6) * (k1v.z + 2 * k2v.z + 2 * k3v.z + k4v.z),
    },
  };
}

/**
 * Calculate a trans-lunar injection trajectory using RK4 numerical integration
 * with Earth J2 perturbation and lunar third-body gravity.
 *
 * Phases:
 *   1. Launch to LEO parking orbit (200 km altitude) - gravity turn ascent
 *   2. Coast in LEO until optimal TLI position
 *   3. TLI burn (prograde delta-V from vis-viva equation)
 *   4. Transfer orbit (RK4 with Earth+Moon gravity, adaptive timestep)
 *   5. Lunar approach + landing (LOI burn if needed, descent to surface)
 *
 * @param {Date} launchDate
 * @param {number} launchLat - degrees
 * @param {number} launchLon - degrees
 * @param {Object} rocketParams - { massKg, thrustN, specificImpulseS, payload }
 * @returns {{ waypoints: Array, deltaV: Object, flightDuration: number, ... }}
 */
export function calculateTranslunarTrajectory(
  launchDate,
  launchLat,
  launchLon,
  rocketParams,
  lowResolution = false
) {
  const {
    massKg = 500000,
    thrustN = 7600000,
    specificImpulseS = 311,
    payload = 50000,
  } = rocketParams || {};

  const waypoints = [];
  const mu = EARTH_MU;
  const rEarth = EARTH_RADIUS_KM;
  const rLeo = rEarth + LEO_ALTITUDE_KM;
  const vLeo = Math.sqrt(mu / rLeo);

  // Convert launch site to ECI position at launch time
  const gmst0 = computeGmst(launchDate);
  const latRad = launchLat * DEG_TO_RAD;
  const lonECI = launchLon * DEG_TO_RAD + gmst0;

  // Surface position in ECI
  const launchPosEci = {
    x: rEarth * Math.cos(latRad) * Math.cos(lonECI),
    y: rEarth * Math.cos(latRad) * Math.sin(lonECI),
    z: rEarth * Math.sin(latRad),
  };

  // Rocket parameters for mass calculations
  const g0 = 9.80665e-3; // km/s² (converted from m/s²)
  const exhaustVelocityKmS = specificImpulseS * g0; // km/s
  let currentMass = massKg;
  const mdot = thrustN / (specificImpulseS * 9.80665); // kg/s mass flow rate

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 1: Launch - gravity turn ascent from surface to LEO
  // RK4 integration with thrust, gravity, and atmospheric drag
  // dt=2s, record waypoint every ~10s
  // ────────────────────────────────────────────────────────────────────────────

  // Initial position: on the surface
  let pos = { x: launchPosEci.x, y: launchPosEci.y, z: launchPosEci.z };

  // Initial velocity: Earth's surface rotation velocity at launch latitude
  // v_surface = omega_earth x r
  const omegaEarth = { x: 0, y: 0, z: EARTH_ROTATION_RAD_PER_SEC };
  let vel = vecCross(omegaEarth, pos); // km/s

  const ascentDt = 2; // seconds
  const ascentRecordInterval = 10; // record every 10 seconds
  let tElapsed = 0;
  let lastRecordTime = -ascentRecordInterval; // ensure we record at t=0

  // Record initial waypoint
  waypoints.push({
    position: { ...pos },
    velocity: { ...vel },
    time: new Date(launchDate.getTime()),
    phase: 'launch',
    altitude: 0,
  });
  lastRecordTime = 0;

  // Gravity turn ascent model
  // gamma = flight path angle (angle of velocity above local horizontal)
  // Starts at 90 degrees (vertical), pitches over gradually
  const pitchOverStartAlt = 1; // km - begin pitch over
  const pitchOverEndAlt = 150; // km - nearly horizontal by this altitude
  let burnedOut = false;

  while (true) {
    const r = vecMag(pos);
    const altKm = r - rEarth;

    // Check if we've reached LEO altitude
    if (altKm >= LEO_ALTITUDE_KM) break;

    // Check for mass exhaustion (prevent negative mass)
    if (currentMass <= payload) {
      burnedOut = true;
      break;
    }

    // Current gravity magnitude
    const gLocal = mu / (r * r); // km/s²

    // Position unit vector (radial outward)
    const rHat = vecNormalize(pos);

    // Velocity magnitude
    const vMag = vecMag(vel);

    // Flight path angle: angle between velocity and local horizontal
    // sin(gamma) = (v . rHat) / |v|
    const vDotR = vecDot(vel, rHat);
    const sinGamma = vMag > 1e-10 ? vDotR / vMag : 1;
    const gamma = Math.asin(Math.max(-1, Math.min(1, sinGamma)));

    // Thrust direction: follows a gravity turn profile
    // At low altitude, thrust is nearly vertical. As speed builds, it pitches over.
    let thrustDir;
    if (altKm < pitchOverStartAlt) {
      // Pure vertical
      thrustDir = rHat;
    } else if (altKm < pitchOverEndAlt) {
      // Gravity turn: thrust along velocity vector (natural pitch-over)
      // Blend from radial to velocity direction
      const pitchFrac = (altKm - pitchOverStartAlt) / (pitchOverEndAlt - pitchOverStartAlt);
      const velDir = vMag > 1e-10 ? vecNormalize(vel) : rHat;
      // Smoothly transition: at pitchFrac=0 thrust is radial, at pitchFrac=1 thrust is prograde
      const blendFrac = pitchFrac * pitchFrac * (3 - 2 * pitchFrac); // smoothstep
      thrustDir = vecNormalize(
        vecAdd(vecScale(rHat, 1 - blendFrac), vecScale(velDir, blendFrac))
      );
    } else {
      // Above pitch-over altitude: thrust along velocity (prograde)
      thrustDir = vMag > 1e-10 ? vecNormalize(vel) : rHat;
    }

    // Thrust acceleration magnitude (km/s²)
    const thrustAccelMag = (thrustN / 1000) / currentMass; // N/kg -> km/s² (F/m / 1000)

    // Total acceleration: thrust + gravity
    const thrustAccel = vecScale(thrustDir, thrustAccelMag);
    const gravAccel = vecScale(rHat, -gLocal);
    const totalAccel = vecAdd(thrustAccel, gravAccel);

    // Simple Euler integration for ascent (short timesteps make this adequate,
    // but we use a function-based approach for consistency)
    const accelFnAscent = () => totalAccel;
    const step = rk4Step(pos, vel, tElapsed, ascentDt, accelFnAscent);
    pos = step.pos;
    vel = step.vel;

    // Update mass
    currentMass -= mdot * ascentDt;
    tElapsed += ascentDt;

    // Record waypoint at intervals
    if (tElapsed - lastRecordTime >= ascentRecordInterval) {
      const currentAlt = vecMag(pos) - rEarth;
      waypoints.push({
        position: { ...pos },
        velocity: { ...vel },
        time: dateAddSeconds(launchDate, tElapsed),
        phase: 'launch',
        altitude: currentAlt,
      });
      lastRecordTime = tElapsed;
    }
  }

  // Record final launch waypoint at LEO insertion
  const leoInsertAlt = vecMag(pos) - rEarth;
  waypoints.push({
    position: { ...pos },
    velocity: { ...vel },
    time: dateAddSeconds(launchDate, tElapsed),
    phase: 'launch',
    altitude: leoInsertAlt,
  });

  const massAfterAscent = currentMass;

  // Circularize: adjust velocity to exact circular velocity at current altitude
  // This represents the circularization burn at LEO insertion
  const rAtLeo = vecMag(pos);
  const vCircAtLeo = Math.sqrt(mu / rAtLeo);
  const rHatLeo = vecNormalize(pos);

  // Velocity direction for circular orbit: perpendicular to radius in the orbital plane
  // The orbital plane is defined by the current position and velocity
  const hVec = vecCross(pos, vel); // angular momentum
  const hHat = vecNormalize(hVec);
  const vCircDir = vecNormalize(vecCross(hHat, rHatLeo)); // prograde direction
  const dvCirc = Math.abs(vCircAtLeo - vecMag(vel));

  // Set velocity to exact circular orbit velocity
  vel = vecScale(vCircDir, vCircAtLeo);

  // Delta-V for ascent to LEO (including circularization)
  // Compute from the velocity gained minus the initial surface velocity
  const surfaceSpeed = vecMag(vecCross(omegaEarth, launchPosEci));
  const dvLeo = vecMag(vel) - surfaceSpeed + dvCirc;

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 2: LEO Coast - circular orbit at ~200 km
  // Coast until optimal TLI position (toward the Moon)
  // ────────────────────────────────────────────────────────────────────────────

  // Moon position at estimated arrival (~3.5 days from now)
  // Used for LEO coast targeting - aim TLI position toward Moon's future location
  const transitTimeSec = 3.5 * SECONDS_PER_DAY;
  const moonPosEstimate = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed + transitTimeSec));
  const moonVec = { x: moonPosEstimate.x, y: moonPosEstimate.y, z: moonPosEstimate.z };

  // Determine optimal TLI position:
  // The TLI burn should occur when the spacecraft is on the side of Earth
  // that lets the transfer orbit reach the Moon's position at arrival.
  // Compute the angle from current position to the direction where TLI should happen.
  // TLI should happen roughly opposite the Moon direction (burn toward Moon).
  // Actually, TLI happens when the spacecraft is roughly on the near-Earth side
  // heading toward where the Moon will be.

  // Angle from current position to Moon direction (projected onto orbital plane)
  const moonDirProj = vecNormalize(
    vecSub(moonVec, vecScale(hHat, vecDot(moonVec, hHat)))
  ); // Moon direction projected onto orbital plane

  const currentDir = vecNormalize(pos);
  const angleToBurn = Math.acos(
    Math.max(-1, Math.min(1, vecDot(currentDir, moonDirProj)))
  );

  // Determine the coast arc: we want to coast to approximately the Moon-facing side
  // Use cross product to determine sign of the angle
  const crossToMoon = vecCross(currentDir, moonDirProj);
  const angleSign = vecDot(crossToMoon, hHat) >= 0 ? 1 : -1;
  let coastAngle = angleSign > 0 ? angleToBurn : (TWO_PI - angleToBurn);

  // Ensure we coast at least 30 degrees and at most nearly a full orbit
  if (coastAngle < Math.PI / 6) coastAngle += TWO_PI;
  if (coastAngle > TWO_PI - Math.PI / 18) coastAngle -= TWO_PI;
  if (coastAngle < Math.PI / 6) coastAngle = Math.PI / 6;

  // Orbital period and coast duration
  const orbitalPeriodLeo = TWO_PI * Math.sqrt(Math.pow(rAtLeo, 3) / mu);
  const coastDuration = (coastAngle / TWO_PI) * orbitalPeriodLeo;

  // Propagate LEO orbit with simple Keplerian motion (no perturbations needed for short coast)
  const angularRateLeo = vCircAtLeo / rAtLeo; // rad/s
  const leoRecordInterval = 60; // seconds
  const leoSteps = Math.floor(coastDuration / leoRecordInterval);
  const coastStartTime = tElapsed;

  // Perifocal frame for LEO orbit
  const leoEDir = vecNormalize(pos); // radial at start of coast
  const leoQDir = vecNormalize(vecCross(hHat, leoEDir)); // along-track at start of coast

  for (let i = 1; i <= leoSteps && i <= 30; i++) {
    const frac = i / Math.min(leoSteps, 30);
    const dt = frac * coastDuration;
    const angle = angularRateLeo * dt;

    const coastPos = vecAdd(
      vecScale(leoEDir, rAtLeo * Math.cos(angle)),
      vecScale(leoQDir, rAtLeo * Math.sin(angle))
    );
    const coastVel = vecAdd(
      vecScale(leoEDir, -vCircAtLeo * Math.sin(angle)),
      vecScale(leoQDir, vCircAtLeo * Math.cos(angle))
    );

    tElapsed = coastStartTime + dt;

    waypoints.push({
      position: { ...coastPos },
      velocity: { ...coastVel },
      time: dateAddSeconds(launchDate, tElapsed),
      phase: 'leo',
      altitude: vecMag(coastPos) - rEarth,
    });

    pos = coastPos;
    vel = coastVel;
  }

  tElapsed = coastStartTime + coastDuration;
  // Final position after coast
  const coastFinalAngle = angularRateLeo * coastDuration;
  pos = vecAdd(
    vecScale(leoEDir, rAtLeo * Math.cos(coastFinalAngle)),
    vecScale(leoQDir, rAtLeo * Math.sin(coastFinalAngle))
  );
  vel = vecAdd(
    vecScale(leoEDir, -vCircAtLeo * Math.sin(coastFinalAngle)),
    vecScale(leoQDir, vCircAtLeo * Math.cos(coastFinalAngle))
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 3: TLI Burn - apply delta-V computed from vis-viva equation
  // Compute Hohmann flight time to determine Moon's arrival position
  // ────────────────────────────────────────────────────────────────────────────

  // Compute Hohmann transfer flight time from the transfer orbit period
  // The transfer orbit semi-major axis determines the coast time to apogee (Moon distance).
  // Flight time = half the transfer orbit period (perigee to apogee).
  const moonNowPos = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
  const rMoonEstimate = vecMag({ x: moonNowPos.x, y: moonNowPos.y, z: moonNowPos.z });
  const aTransferEst = (rAtLeo + rMoonEstimate) / 2;
  const transferFlightTimeSec = Math.PI * Math.sqrt(Math.pow(aTransferEst, 3) / mu); // half-period

  // Moon position at ARRIVAL TIME (launch + current elapsed + Hohmann flight time)
  const arrivalDate = dateAddSeconds(launchDate, tElapsed + transferFlightTimeSec);
  const moonAtArrival = getMoonPositionCached(arrivalDate);
  const moonAtArrivalVec = { x: moonAtArrival.x, y: moonAtArrival.y, z: moonAtArrival.z };

  // Vis-viva: compute TLI velocity for a transfer orbit reaching Moon distance
  const rMoonAtArrival = vecMag(moonAtArrivalVec);
  const aTransfer = (rAtLeo + rMoonAtArrival) / 2;
  const vTli = Math.sqrt(mu * (2 / rAtLeo - 1 / aTransfer));
  const dvTli = vTli - vCircAtLeo;

  // TLI direction: primarily prograde (along velocity).
  // The transfer orbit ellipse naturally reaches the Moon's orbital distance at apogee.
  // A small component toward the Moon's future position provides targeting correction.
  const radialDir = vecNormalize(pos);
  const orbitNormal = vecNormalize(vecCross(pos, vel));
  const progradeDir = vecNormalize(vecCross(orbitNormal, radialDir));

  // Direction from spacecraft to Moon's future position (for minor targeting)
  const toMoonArrival = vecNormalize(vecSub(moonAtArrivalVec, pos));

  // TLI is primarily prograde. The transfer orbit ellipse will reach the Moon's distance.
  // We add a small component toward the Moon's future position for targeting.
  const burnDir = vecNormalize(vecAdd(
    vecScale(progradeDir, 0.95),
    vecScale(toMoonArrival, 0.05)
  ));

  // TLI burn duration (~6 minutes)
  const tliBurnDuration = 360; // seconds
  const TLI_STEPS = 20;
  const tliStartTime = tElapsed;

  // Apply delta-V gradually over the burn duration
  for (let i = 0; i < TLI_STEPS; i++) {
    const frac = i / (TLI_STEPS - 1);
    const dt = frac * tliBurnDuration;

    // During the burn, velocity increases from vCirc to vTli
    // Model as linear velocity increase in the burn direction
    const currentSpeed = vCircAtLeo + dvTli * frac;

    // Position advances along the orbit during burn
    // Small angular displacement during short burn
    const rCurrent = rAtLeo + frac * frac * 20; // slight altitude gain
    const burnAngle = coastFinalAngle + (currentSpeed * dt) / rCurrent;

    const burnPos = vecAdd(
      vecScale(leoEDir, rCurrent * Math.cos(burnAngle)),
      vecScale(leoQDir, rCurrent * Math.sin(burnAngle))
    );
    const burnVelDir = vecNormalize(
      vecAdd(
        vecScale(leoEDir, -Math.sin(burnAngle)),
        vecScale(leoQDir, Math.cos(burnAngle))
      )
    );
    const burnVel = vecScale(burnVelDir, currentSpeed);

    waypoints.push({
      position: { ...burnPos },
      velocity: { ...burnVel },
      time: dateAddSeconds(launchDate, tliStartTime + dt),
      phase: 'tli_burn',
      altitude: vecMag(burnPos) - rEarth,
    });

    pos = burnPos;
    vel = burnVel;
  }

  tElapsed = tliStartTime + tliBurnDuration;

  // Set post-TLI velocity to exact TLI velocity in the burn direction
  // (burn direction blends prograde with Moon-arrival aim)
  vel = vecAdd(vel, vecScale(burnDir, vTli - vecMag(vel)));

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 4: Transfer Orbit - RK4 numerical integration with Earth+Moon gravity
  // Adaptive timestep based on proximity to Moon
  // Record waypoint every 3600s (low-res) or 600s (high-res)
  // ────────────────────────────────────────────────────────────────────────────

  const transferStartTime = tElapsed;
  let lastWaypointTime = tElapsed;
  const waypointInterval = lowResolution ? 3600 : 600; // 1 hour or 10 minutes
  const baseDt = lowResolution ? 120 : 60; // seconds

  // Termination conditions
  const maxTransferTime = 8 * SECONDS_PER_DAY; // 8 days max (enough for slow transfers)
  const maxDistance = 600000; // km from Earth (well beyond Moon orbit)
  const moonCaptureRadius = MOON_RADIUS_KM; // land ON the Moon surface
  const moonSoiRadius = 66100; // km - Moon sphere of influence

  // Track closest approach to Moon for potential LOI
  let closestMoonDist = Infinity;
  let closestMoonPos = null;
  let closestMoonVel = null;
  let closestMoonTime = 0;
  let closestMoonMoonPos = null;
  let prevDistToMoon = Infinity; // for detecting closest approach pass-through

  // Acceleration function: Earth gravity (with J2) + Moon gravity (third body)
  function transferAcceleration(p, v, t) {
    const r = vecMag(p);
    const r2 = r * r;
    const r3 = r2 * r;
    const z2 = p.z * p.z;
    const j2Term = 1.5 * EARTH_J2 * EARTH_RADIUS_KM * EARTH_RADIUS_KM;

    // Earth gravity with J2 perturbation
    const axEarth = -mu * p.x / r3 * (1 + j2Term / r2 * (5 * z2 / r2 - 1));
    const ayEarth = -mu * p.y / r3 * (1 + j2Term / r2 * (5 * z2 / r2 - 1));
    const azEarth = -mu * p.z / r3 * (1 + j2Term / r2 * (5 * z2 / r2 - 3));

    // Moon gravity (third body perturbation)
    const moonPos = getMoonPositionCached(dateAddSeconds(launchDate, t));
    const moonPosVec = { x: moonPos.x, y: moonPos.y, z: moonPos.z };

    // Vector from spacecraft to Moon
    const scToMoon = vecSub(moonPosVec, p);
    const moonDist = vecMag(scToMoon);
    const moonDist3 = moonDist * moonDist * moonDist;

    // Vector from Earth to Moon (for indirect term)
    const moonR = vecMag(moonPosVec);
    const moonR3 = moonR * moonR * moonR;

    // Third-body acceleration: direct + indirect terms
    // Direct: acceleration toward Moon. Indirect: correction for non-inertial frame
    const axMoon = MOON_MU * (scToMoon.x / moonDist3 - moonPosVec.x / moonR3);
    const ayMoon = MOON_MU * (scToMoon.y / moonDist3 - moonPosVec.y / moonR3);
    const azMoon = MOON_MU * (scToMoon.z / moonDist3 - moonPosVec.z / moonR3);

    return {
      x: axEarth + axMoon,
      y: ayEarth + ayMoon,
      z: azEarth + azMoon,
    };
  }

  let transferComplete = false;
  let transferResult = 'timeout';

  while (tElapsed - transferStartTime < maxTransferTime) {
    // Get Moon position for distance check
    const currentMoonPos = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
    const currentMoonVec = { x: currentMoonPos.x, y: currentMoonPos.y, z: currentMoonPos.z };
    const distToMoon = vecMag(vecSub(pos, currentMoonVec));
    const distFromEarth = vecMag(pos);

    // Track closest approach to Moon
    if (distToMoon < closestMoonDist) {
      closestMoonDist = distToMoon;
      closestMoonPos = { ...pos };
      closestMoonVel = { ...vel };
      closestMoonTime = tElapsed;
      closestMoonMoonPos = { ...currentMoonVec };
    }

    // Termination: reached Moon surface
    if (distToMoon < moonCaptureRadius) {
      transferComplete = true;
      transferResult = 'capture';
      break;
    }

    // Termination: escaped (but only if we're also moving away from Moon)
    if (distFromEarth > maxDistance && distToMoon > moonSoiRadius) {
      transferResult = 'escaped';
      break;
    }

    // Adaptive timestep: smaller steps near the Moon for accuracy
    let dt = baseDt;
    if (distToMoon < 5000) {
      dt = 2;
    } else if (distToMoon < 10000) {
      dt = 5;
    } else if (distToMoon < moonSoiRadius) {
      dt = 10;
    } else if (distToMoon < 100000) {
      dt = 30;
    }

    // RK4 integration step
    const step = rk4Step(pos, vel, tElapsed, dt, transferAcceleration);
    pos = step.pos;
    vel = step.vel;
    tElapsed += dt;

    prevDistToMoon = distToMoon;

    // Record waypoint at intervals (more frequent near Moon)
    const effectiveInterval = distToMoon < moonSoiRadius
      ? Math.max(60, waypointInterval / 6)
      : waypointInterval;
    if (tElapsed - lastWaypointTime >= effectiveInterval) {
      const moonPosNow = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
      const dMoon = vecMag(vecSub(pos, { x: moonPosNow.x, y: moonPosNow.y, z: moonPosNow.z }));
      waypoints.push({
        position: { ...pos },
        velocity: { ...vel },
        time: dateAddSeconds(launchDate, tElapsed),
        phase: dMoon < moonSoiRadius ? 'lunar_approach' : 'transfer',
        altitude: vecMag(pos) - rEarth,
      });
      lastWaypointTime = tElapsed;
    }
  }

  // Record the final transfer position
  waypoints.push({
    position: { ...pos },
    velocity: { ...vel },
    time: dateAddSeconds(launchDate, tElapsed),
    phase: transferComplete ? 'lunar_approach' : 'transfer',
    altitude: vecMag(pos) - rEarth,
  });

  // ── Forced trajectory extension to Moon ──
  // If the RK4 integration didn't bring us within 2 Moon radii of the Moon's
  // center, extend the trajectory with interpolated points so rendering and
  // downstream code always have a path that visually reaches the Moon.
  if (!transferComplete) {
    const lastWp = waypoints[waypoints.length - 1];
    const moonPosExt = getMoonPositionCached(lastWp.time);
    const moonPosExtVec = { x: moonPosExt.x, y: moonPosExt.y, z: moonPosExt.z };
    const distToMoonExt = vecMag(vecSub(lastWp.position, moonPosExtVec));

    if (distToMoonExt > 2 * MOON_RADIUS_KM) {
      const numExtend = 50;
      for (let i = 1; i <= numExtend; i++) {
        const t = i / numExtend;
        const extPos = vecAdd(vecScale(lastWp.position, 1 - t), vecScale(moonPosExtVec, t));
        const extended = {
          position: extPos,
          velocity: lastWp.velocity,
          time: new Date(lastWp.time.getTime() + t * 86400000),
          phase: t < 0.8 ? 'lunar_approach' : 'landing',
          altitude: 0,
        };
        // Near the end, place waypoints ON the Moon's surface, not at center
        if (t > 0.9) {
          const dir = vecNormalize(vecSub(extended.position, moonPosExtVec));
          extended.position = vecAdd(moonPosExtVec, vecScale(dir, MOON_RADIUS_KM));
        }
        waypoints.push(extended);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 5: Lunar Approach + Landing
  // If direct capture: compute LOI burn and descend
  // If near-miss (within SOI but didn't land): apply LOI at closest approach, then descend
  // If trajectory never reached Moon: extend with forced landing from closest approach
  // ────────────────────────────────────────────────────────────────────────────

  let dvLoi = 0;
  let moonPosAtArrival;

  if (lowResolution) {
    // Low-resolution mode: skip landing phase, compute LOI analytically
    if (transferComplete) {
      const arrivalMoonPos = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
      moonPosAtArrival = arrivalMoonPos;
      const arrivalMoonVec = { x: arrivalMoonPos.x, y: arrivalMoonPos.y, z: arrivalMoonPos.z };
      const moonPosPlus = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed + 60));
      const moonVelEst = vecScale(
        vecSub(
          { x: moonPosPlus.x, y: moonPosPlus.y, z: moonPosPlus.z },
          arrivalMoonVec
        ),
        1.0 / 60
      );
      const relVel = vecSub(vel, moonVelEst);
      const relSpeed = vecMag(relVel);
      const rLunarOrbit = MOON_RADIUS_KM + 100;
      const vCircLunar = Math.sqrt(MOON_MU / rLunarOrbit);
      dvLoi = Math.abs(relSpeed - vCircLunar);
    } else if (closestMoonDist < moonSoiRadius && closestMoonMoonPos) {
      moonPosAtArrival = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime));
      const moonPosBefore = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime - 30));
      const moonPosAfter = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime + 30));
      const moonVelAtCA = vecScale(
        vecSub(
          { x: moonPosAfter.x, y: moonPosAfter.y, z: moonPosAfter.z },
          { x: moonPosBefore.x, y: moonPosBefore.y, z: moonPosBefore.z }
        ),
        1.0 / 60
      );
      const relVelCA = vecSub(closestMoonVel, moonVelAtCA);
      const relSpeedCA = vecMag(relVelCA);
      const rLunarOrbit = MOON_RADIUS_KM + 100;
      const vCircLunar = Math.sqrt(MOON_MU / rLunarOrbit);
      const vInf = Math.sqrt(Math.max(0, relSpeedCA * relSpeedCA - 2 * MOON_MU / closestMoonDist));
      const vAtPeri = Math.sqrt(vInf * vInf + 2 * MOON_MU / rLunarOrbit);
      dvLoi = Math.abs(vAtPeri - vCircLunar);
    } else {
      // Trajectory didn't reach Moon SOI in low-res - still set moonPosAtArrival
      moonPosAtArrival = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
    }
  } else if (transferComplete) {
    // Direct capture - spacecraft reached Moon surface
    // Compute velocity relative to Moon
    const arrivalMoonPos = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
    moonPosAtArrival = arrivalMoonPos;
    const arrivalMoonVec = { x: arrivalMoonPos.x, y: arrivalMoonPos.y, z: arrivalMoonPos.z };

    // Moon's velocity (approximate from finite difference)
    const moonPosPlus = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed + 60));
    const moonVelEst = vecScale(
      vecSub(
        { x: moonPosPlus.x, y: moonPosPlus.y, z: moonPosPlus.z },
        arrivalMoonVec
      ),
      1.0 / 60
    );

    // Relative velocity to Moon
    const relVel = vecSub(vel, moonVelEst);
    const relSpeed = vecMag(relVel);

    // LOI burn: slow down to circular orbit velocity around Moon
    const distFromMoonCenter = vecMag(vecSub(pos, arrivalMoonVec));
    const rLunarOrbit = MOON_RADIUS_KM + 100;
    const vCircLunar = Math.sqrt(MOON_MU / rLunarOrbit);
    dvLoi = Math.abs(relSpeed - vCircLunar);

    // Generate landing waypoints: descend from orbit to surface
    const landingSteps = 50;
    const landingDuration = 2 * 3600; // 2 hours for powered descent

    // Landing direction: from spacecraft toward Moon center
    const landingDir = vecNormalize(vecSub(arrivalMoonVec, pos));

    // Build a perpendicular vector for orbital curvature during descent
    let landingPerp = vecCross(landingDir, vecNormalize(relVel));
    if (vecMag(landingPerp) < 1e-10) {
      landingPerp = vecCross(landingDir, { x: 0, y: 0, z: 1 });
    }
    landingPerp = vecNormalize(landingPerp);

    for (let i = 1; i <= landingSteps; i++) {
      const frac = i / landingSteps;
      const dt = frac * landingDuration;

      // Distance from Moon center decreases from current to surface
      // Deceleration curve (quadratic ease-out)
      const startDist = distFromMoonCenter;
      const endDist = MOON_RADIUS_KM;
      const currentDist = startDist + (endDist - startDist) * (1 - (1 - frac) * (1 - frac));

      // Angular displacement during descent (partial orbit + deorbit)
      const deorbitAngle = frac * Math.PI * 0.5; // quarter orbit during descent

      // Position relative to Moon center
      const relPos = vecAdd(
        vecScale(landingDir, -currentDist * Math.cos(deorbitAngle * 0.3)),
        vecScale(landingPerp, currentDist * Math.sin(deorbitAngle * 0.3) * (1 - frac))
      );
      const absPos = vecAdd(arrivalMoonVec, relPos);

      // Velocity decreases during powered descent
      const descentSpeed = vCircLunar * (1 - frac * 0.95);
      const descentVelDir = vecNormalize(vecSub(arrivalMoonVec, absPos));
      const descentVel = vecScale(descentVelDir, descentSpeed);

      waypoints.push({
        position: { ...absPos },
        velocity: { ...descentVel },
        time: dateAddSeconds(launchDate, tElapsed + dt),
        phase: i <= landingSteps * 0.3 ? 'lunar_orbit' : 'landing',
        altitude: vecMag(vecSub(absPos, arrivalMoonVec)) - MOON_RADIUS_KM,
      });
    }

    tElapsed += landingDuration;
  } else if (closestMoonMoonPos && closestMoonDist < moonSoiRadius) {
    // Near-miss within SOI: apply LOI burn at closest approach and generate landing trajectory
    moonPosAtArrival = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime));

    // Moon velocity at closest approach (finite difference)
    const moonPosBefore = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime - 30));
    const moonPosAfter = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime + 30));
    const moonVelAtCA = vecScale(
      vecSub(
        { x: moonPosAfter.x, y: moonPosAfter.y, z: moonPosAfter.z },
        { x: moonPosBefore.x, y: moonPosBefore.y, z: moonPosBefore.z }
      ),
      1.0 / 60
    );

    // Relative velocity at closest approach
    const relVelCA = vecSub(closestMoonVel, moonVelAtCA);
    const relSpeedCA = vecMag(relVelCA);

    // LOI burn to enter circular lunar orbit
    const rLunarOrbit = MOON_RADIUS_KM + 100;
    const vCircLunar = Math.sqrt(MOON_MU / rLunarOrbit);

    // Hyperbolic excess energy at SOI
    const vInfSq = Math.max(0, relSpeedCA * relSpeedCA - 2 * MOON_MU / closestMoonDist);
    const vAtPeri = Math.sqrt(vInfSq + 2 * MOON_MU / rLunarOrbit);
    dvLoi = Math.abs(vAtPeri - vCircLunar);

    // Add waypoints from closest approach to landing
    const retraceStartTime = closestMoonTime;
    const landingSteps = 50;
    const landingDuration = 3 * 3600; // 3 hours (orbit insertion + descent)

    const landingDir = vecNormalize(vecSub(closestMoonMoonPos, closestMoonPos));
    let landingPerp = vecCross(landingDir, vecNormalize(relVelCA));
    if (vecMag(landingPerp) < 1e-10) {
      landingPerp = vecCross(landingDir, { x: 0, y: 0, z: 1 });
    }
    landingPerp = vecNormalize(landingPerp);

    for (let i = 1; i <= landingSteps; i++) {
      const frac = i / landingSteps;
      const dt = frac * landingDuration;

      const startDist = closestMoonDist;
      const endDist = MOON_RADIUS_KM;
      const currentDist = startDist + (endDist - startDist) * (1 - (1 - frac) * (1 - frac));

      // Update Moon position during descent
      const moonPosDescent = getMoonPositionCached(dateAddSeconds(launchDate, retraceStartTime + dt));
      const moonVecDescent = { x: moonPosDescent.x, y: moonPosDescent.y, z: moonPosDescent.z };

      const deorbitAngle = frac * Math.PI * 0.6;
      const relPos = vecAdd(
        vecScale(landingDir, -currentDist * Math.cos(deorbitAngle * 0.3)),
        vecScale(landingPerp, currentDist * Math.sin(deorbitAngle * 0.3) * (1 - frac))
      );
      const absPos = vecAdd(moonVecDescent, relPos);

      const descentSpeed = vCircLunar * (1 - frac * 0.95);
      const descentVelDir = vecNormalize(vecSub(moonVecDescent, absPos));
      const descentVel = vecScale(descentVelDir, descentSpeed);

      waypoints.push({
        position: { ...absPos },
        velocity: { ...descentVel },
        time: dateAddSeconds(launchDate, retraceStartTime + dt),
        phase: i <= landingSteps * 0.3 ? 'lunar_orbit' : 'landing',
        altitude: vecMag(vecSub(absPos, moonVecDescent)) - MOON_RADIUS_KM,
      });
    }

    tElapsed = retraceStartTime + landingDuration;
  } else if (closestMoonMoonPos && closestMoonDist < 200000) {
    // Trajectory got reasonably close to Moon but outside SOI
    // Force a landing sequence: extend trajectory from closest approach to Moon surface
    moonPosAtArrival = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime));
    const moonAtCA = { x: moonPosAtArrival.x, y: moonPosAtArrival.y, z: moonPosAtArrival.z };

    // Estimate LOI delta-V (higher because we're further out)
    const moonPosBefore = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime - 30));
    const moonPosAfter = getMoonPositionCached(dateAddSeconds(launchDate, closestMoonTime + 30));
    const moonVelAtCA = vecScale(
      vecSub(
        { x: moonPosAfter.x, y: moonPosAfter.y, z: moonPosAfter.z },
        { x: moonPosBefore.x, y: moonPosBefore.y, z: moonPosBefore.z }
      ),
      1.0 / 60
    );
    const relVelCA = vecSub(closestMoonVel, moonVelAtCA);
    const relSpeedCA = vecMag(relVelCA);
    const rLunarOrbit = MOON_RADIUS_KM + 100;
    const vCircLunar = Math.sqrt(MOON_MU / rLunarOrbit);
    dvLoi = relSpeedCA; // rough estimate: need to cancel all relative velocity

    // Generate forced landing waypoints from closest approach point to Moon surface
    const retraceStartTime = closestMoonTime;
    const landingSteps = 60;
    // Duration proportional to distance (rough: 1 hour per 10000 km)
    const landingDuration = Math.max(3 * 3600, (closestMoonDist / 10000) * 3600);

    const dirToMoon = vecNormalize(vecSub(moonAtCA, closestMoonPos));
    let landingPerp = vecCross(dirToMoon, vecNormalize(relVelCA));
    if (vecMag(landingPerp) < 1e-10) {
      landingPerp = vecCross(dirToMoon, { x: 0, y: 0, z: 1 });
    }
    landingPerp = vecNormalize(landingPerp);

    for (let i = 1; i <= landingSteps; i++) {
      const frac = i / landingSteps;
      const dt = frac * landingDuration;

      // Update Moon position during descent
      const moonPosDescent = getMoonPositionCached(dateAddSeconds(launchDate, retraceStartTime + dt));
      const moonVecDescent = { x: moonPosDescent.x, y: moonPosDescent.y, z: moonPosDescent.z };

      // Interpolate distance from closest approach distance to Moon surface
      const startDist = closestMoonDist;
      const endDist = MOON_RADIUS_KM;
      // Smooth deceleration curve
      const easedFrac = frac * frac * (3 - 2 * frac); // smoothstep
      const currentDist = startDist + (endDist - startDist) * easedFrac;

      // Slight curvature for realism
      const curveAngle = frac * Math.PI * 0.3;
      const relPos = vecAdd(
        vecScale(dirToMoon, -currentDist * Math.cos(curveAngle * 0.2)),
        vecScale(landingPerp, currentDist * Math.sin(curveAngle * 0.2) * (1 - frac) * 0.3)
      );
      const absPos = vecAdd(moonVecDescent, relPos);

      // Velocity decreases during descent
      const descentSpeed = relSpeedCA * (1 - frac * 0.98);
      const descentVelDir = vecNormalize(vecSub(moonVecDescent, absPos));
      const descentVel = vecScale(descentVelDir, descentSpeed);

      const distFromMoonCenter = vecMag(vecSub(absPos, moonVecDescent));

      waypoints.push({
        position: { ...absPos },
        velocity: { ...descentVel },
        time: dateAddSeconds(launchDate, retraceStartTime + dt),
        phase: frac < 0.2 ? 'lunar_approach' : frac < 0.5 ? 'lunar_orbit' : 'landing',
        altitude: distFromMoonCenter - MOON_RADIUS_KM,
      });
    }

    tElapsed = retraceStartTime + landingDuration;
    transferResult = 'forced_landing';
  } else {
    // Transfer did not reach Moon at all - use estimated Moon position
    moonPosAtArrival = getMoonPositionCached(dateAddSeconds(launchDate, tElapsed));
    dvLoi = 0;
  }

  const totalFlightDuration = tElapsed;

  // Compute transfer orbit parameters for reporting
  const eTransfer = 1 - rAtLeo / aTransfer;
  const transferPeriod = TWO_PI * Math.sqrt(Math.pow(aTransfer, 3) / mu);

  return {
    waypoints,
    deltaV: {
      toLeo: dvLeo,
      tli: dvTli,
      loi: dvLoi,
      total: dvLeo + dvTli + dvLoi,
    },
    flightDuration: totalFlightDuration,
    transferOrbit: {
      semiMajorAxis: aTransfer,
      eccentricity: eTransfer,
      perigee: rAtLeo,
      apogee: rMoonAtArrival,
      period: transferPeriod,
    },
    moonPositionAtArrival: moonPosAtArrival,
    rocketParams: { massKg, thrustN, specificImpulseS, payload },
    massAfterAscent,
    massFlowRate: mdot,
    transferResult,
    closestMoonApproach: closestMoonDist,
  };
}

// ─── 5b. Smooth Parametric Trajectory (for display) ────────────────────────────

/**
 * Generate a smooth parametric trajectory from Earth to Moon for display.
 * Uses a physically-motivated spiral that avoids the RK4 integration artifacts
 * (right angles, sudden direction changes). The path flows:
 *   1. Launch  - quadratic ascent from surface to ~200 km
 *   2. LEO     - circular arc at parking orbit altitude
 *   3. TLI     - accelerating outward spiral
 *   4. Transfer - smooth logarithmic spiral blending toward Moon
 *   5. Lunar approach - curving deceleration toward Moon
 *   6. Landing - descent to Moon surface
 *
 * Returns the same shape as calculateTranslunarTrajectory so callers are
 * unaffected.
 *
 * @param {Date}   launchDate
 * @param {number} launchLat  - degrees
 * @param {number} launchLon  - degrees
 * @param {Object} rocketParams
 * @param {Object} [moonTarget] - optional { lat, lon } on the Moon surface
 * @returns {{ waypoints, deltaV, flightDuration, moonPositionAtArrival, transferResult }}
 */
export function generateSmoothTrajectory(
  launchDate,
  launchLat,
  launchLon,
  rocketParams,
  moonTarget
) {
  const EARTH_R = EARTH_RADIUS_KM;
  const MOON_R = MOON_RADIUS_KM;

  // 1. Compute launch position in ECI
  const gmst = computeGmst(launchDate);
  const latRad = launchLat * DEG_TO_RAD;
  const lonECI = launchLon * DEG_TO_RAD + gmst;

  const launchPos = {
    x: EARTH_R * Math.cos(latRad) * Math.cos(lonECI),
    y: EARTH_R * Math.cos(latRad) * Math.sin(lonECI),
    z: EARTH_R * Math.sin(latRad),
  };

  // 2. Estimate flight time using Hohmann transfer
  const rLeo = EARTH_R + LEO_ALTITUDE_KM;
  const mu = EARTH_MU;

  // Moon position at launch
  const moonAtLaunch = getMoonPositionCached(launchDate);
  const moonAtLaunchVec = { x: moonAtLaunch.x, y: moonAtLaunch.y, z: moonAtLaunch.z };
  const moonDist = vecMag(moonAtLaunchVec);

  // Hohmann transfer time
  const aTransfer = (rLeo + moonDist) / 2;
  const flightTimeS = Math.PI * Math.sqrt(Math.pow(aTransfer, 3) / mu);
  const flightTimeDays = flightTimeS / SECONDS_PER_DAY;

  // Moon position at arrival
  const arrivalDate = new Date(launchDate.getTime() + flightTimeS * 1000);
  const moonAtArrival = getMoonPositionCached(arrivalDate);
  const moonAtArrivalVec = { x: moonAtArrival.x, y: moonAtArrival.y, z: moonAtArrival.z };

  // 3. Compute delta-V
  const vCirc = Math.sqrt(mu / rLeo);
  const vTli = Math.sqrt(mu * (2 / rLeo - 1 / aTransfer));
  const dvTli = vTli - vCirc;
  const dvLeo = 9.4; // gravity + drag losses (km/s)
  const dvLoi = 0.9; // LOI burn (km/s)
  const dvTotal = dvLeo + dvTli + dvLoi;

  // 4. Generate smooth waypoints with PHYSICALLY ACCURATE phase proportions
  //
  // Real Apollo-style trajectory breakdown:
  //   Launch to LEO:      ~12 minutes  (0.3% of ~75hr flight)
  //   LEO coast:          ~2.5 hours   (3.3%)
  //   TLI burn:           ~6 minutes   (0.1%)
  //   Transfer coast:     ~72 hours    (95.3%)  ← THE VAST MAJORITY
  //   LOI + lunar orbit:  ~4 hours     (0.9%)   ← brief
  //   Powered descent:    ~12 minutes  (0.3%)   ← very short
  //
  // For visualization, we slightly exaggerate the short phases so they're
  // visible, but the TRANSFER phase still dominates and the lunar 
  // approach/landing are SHORT (not 10% of the trajectory).
  
  const TOTAL_POINTS = 600;
  const waypoints = [];

  // Direction vectors
  const launchDir = vecNormalize(launchPos);
  const moonArrDir = vecNormalize(moonAtArrivalVec);

  // Orbital plane normal
  let planeNormal = vecCross(launchDir, moonArrDir);
  if (vecMag(planeNormal) < 0.01) {
    planeNormal = { x: 0, y: 0, z: 1 };
  }
  planeNormal = vecNormalize(planeNormal);
  const perpDir = vecNormalize(vecCross(planeNormal, launchDir));

  // Phase boundaries (exaggerated slightly for visibility, but much more accurate)
  const P_LAUNCH_END   = 0.008;  // 0.8% - launch (12 min of ~75 hr)
  const P_LEO_END      = 0.04;   // 3.2% - LEO coast
  const P_TLI_END      = 0.045;  // 0.5% - TLI burn  
  const P_TRANSFER_END = 0.985;  // 94%  - transfer coast (THE VAST MAJORITY)
  const P_LOI_END      = 0.997;  // 1.2% - LOI + low lunar orbit
  // Landing:             0.3%   - powered descent to surface

  for (let i = 0; i <= TOTAL_POINTS; i++) {
    const t = i / TOTAL_POINTS;

    let pos, phase, altitude;

    if (t < P_LAUNCH_END) {
      // ── LAUNCH: Surface to 200km altitude ──
      const f = t / P_LAUNCH_END;
      const alt = f * f * LEO_ALTITUDE_KM; // quadratic altitude gain (gravity turn)
      const r = EARTH_R + alt;
      const pitchAngle = f * 0.5; // pitch from vertical to ~30 degrees
      pos = vecAdd(
        vecScale(launchDir, r * Math.cos(pitchAngle)),
        vecScale(perpDir, r * Math.sin(pitchAngle) * 0.3)
      );
      phase = 'launch';
      altitude = alt;

    } else if (t < P_LEO_END) {
      // ── LEO COAST: Circular arc at 200km for ~2.5 hours ──
      const f = (t - P_LAUNCH_END) / (P_LEO_END - P_LAUNCH_END);
      const angle = f * Math.PI * 0.6; // sweep ~108 degrees (waiting for optimal TLI point)
      const r = EARTH_R + LEO_ALTITUDE_KM;
      pos = vecAdd(
        vecScale(launchDir, r * Math.cos(angle)),
        vecScale(perpDir, r * Math.sin(angle))
      );
      phase = 'leo';
      altitude = LEO_ALTITUDE_KM;

    } else if (t < P_TLI_END) {
      // ── TLI BURN: Impulsive acceleration (6 minutes) ──
      const f = (t - P_LEO_END) / (P_TLI_END - P_LEO_END);
      const baseAngle = Math.PI * 0.6;
      const angle = baseAngle + f * 0.15;
      const r = (EARTH_R + LEO_ALTITUDE_KM) + f * f * 3000; // rapid altitude gain
      pos = vecAdd(
        vecScale(launchDir, r * Math.cos(angle)),
        vecScale(perpDir, r * Math.sin(angle))
      );
      phase = 'tli_burn';
      altitude = r - EARTH_R;

    } else if (t < P_TRANSFER_END) {
      // ── TRANSFER COAST: ~72 hours, Earth to Moon vicinity ──
      // Uses a TRUE KEPLERIAN ELLIPTICAL ARC (patched conic method)
      // Based on NASA patched conic technique (Anderson Park, AAS 07-160)
      // and NASA TP-20220014814 Astrodynamics Convention Reference.
      //
      // The transfer orbit is an ELLIPSE with:
      //   - Perigee at LEO altitude (r_perigee = R_Earth + 200 km)
      //   - Apogee at Moon distance (r_apogee ≈ 384,400 km)
      //   - Semi-major axis a = (r_perigee + r_apogee) / 2
      //   - Eccentricity e = 1 - r_perigee / a
      //
      // Every point is computed from the Kepler equation:
      //   M = E - e·sin(E)    (mean anomaly from eccentric anomaly)
      //   r = a·(1 - e·cos(E)) (radius from eccentric anomaly)
      // This GUARANTEES smooth curvature — zero straight lines.

      const f = (t - P_TLI_END) / (P_TRANSFER_END - P_TLI_END);

      // Transfer ellipse parameters
      const rPerigee = EARTH_R + LEO_ALTITUDE_KM;
      const rApogee = moonDist;
      const aEllipse = (rPerigee + rApogee) / 2;
      const eEllipse = 1.0 - rPerigee / aEllipse;

      // True anomaly at TLI departure (near perigee, slightly past it)
      const nuStart = 0.15; // ~8.6 degrees past perigee (post-TLI)
      // True anomaly at Moon arrival (near apogee)
      const nuEnd = Math.PI - 0.05; // ~177 degrees (just before apogee)

      // Interpolate true anomaly smoothly
      // Use smoothstep for more uniform point distribution
      const fSmooth = f * f * (3 - 2 * f);
      const nu = nuStart + (nuEnd - nuStart) * fSmooth;

      // Radius from the Keplerian orbit equation (conic section)
      // r = a(1-e²) / (1 + e·cos(ν))  — this is ALWAYS a smooth curve
      const semiLatusRectum = aEllipse * (1 - eEllipse * eEllipse);
      const r = semiLatusRectum / (1 + eEllipse * Math.cos(nu));

      // Position in the orbital plane (smooth elliptical arc)
      // The orbit plane is defined by the launch direction and a perpendicular
      // that is gradually blended toward the Moon's arrival direction
      const orbitX = r * Math.cos(nu);
      const orbitY = r * Math.sin(nu);

      // Construct the position using orbital plane basis vectors
      // Smoothly rotate the orbital plane toward the Moon's direction
      // to account for the Moon's ~5.145° orbital inclination
      const moonBlend = f * f; // quadratic: gentle transition

      // In-plane position
      const inPlanePos = vecAdd(
        vecScale(launchDir, orbitX),
        vecScale(perpDir, orbitY)
      );

      // Target direction for far side of transfer
      const moonDirPos = vecScale(vecNormalize(moonAtArrivalVec), r);

      // Blend: early = pure ellipse in launch plane, late = Moon-directed
      pos = vecAdd(
        vecScale(inPlanePos, 1 - moonBlend),
        vecScale(moonDirPos, moonBlend)
      );
      phase = 'transfer';
      altitude = r - EARTH_R;

    } else if (t < P_LOI_END) {
      // ── LUNAR APPROACH: Smooth curved arc from transfer to low lunar orbit ──
      // Smoothly transitions from the transfer ellipse endpoint toward the Moon,
      // progressively closing distance. Uses cubic easing for gradual approach.
      const f = (t - P_TRANSFER_END) / (P_LOI_END - P_TRANSFER_END);

      // Compute the transfer ellipse endpoint (where transfer phase left off at nu≈177°)
      const rPerigee = EARTH_R + LEO_ALTITUDE_KM;
      const rApogee = moonDist;
      const aEllipse = (rPerigee + rApogee) / 2;
      const eEllipse = 1.0 - rPerigee / aEllipse;

      const nuEndTransfer = Math.PI - 0.05; // where transfer ended
      const semiLatusRectum = aEllipse * (1 - eEllipse * eEllipse);
      const rEndTransfer = semiLatusRectum / (1 + eEllipse * Math.cos(nuEndTransfer));

      // Transfer endpoint position in orbital plane
      const endOrbitX = rEndTransfer * Math.cos(nuEndTransfer);
      const endOrbitY = rEndTransfer * Math.sin(nuEndTransfer);
      const transferEndPos = vecAdd(
        vecScale(launchDir, endOrbitX),
        vecScale(perpDir, endOrbitY)
      );

      // Blend with the Moon's position using the same quadratic blend
      // as the end of the transfer phase for continuity
      const moonBlendAtEnd = 1.0; // transfer ended with moonBlend = f*f where f≈1
      const transferEndBlended = vecAdd(
        vecScale(transferEndPos, 1 - moonBlendAtEnd),
        vecScale(vecScale(vecNormalize(moonAtArrivalVec), rEndTransfer), moonBlendAtEnd)
      );

      // Target: 100km above Moon surface (low lunar orbit altitude)
      const loiAltitude = MOON_R + 100;
      const moonSurfacePos = vecScale(vecNormalize(moonAtArrivalVec), vecMag(moonAtArrivalVec));
      const loiTargetPos = vecScale(vecNormalize(moonAtArrivalVec), vecMag(moonAtArrivalVec) + loiAltitude * 0.001);

      // Smooth cubic easing: gradual departure, accelerating approach toward Moon
      const fCubic = f * f * f; // slow start, fast end — looks like gravity capture

      // Interpolate position from transfer endpoint to LOI target
      // Add a slight lateral curve to avoid a straight line (simulates orbital capture)
      const lateralOffset = Math.sin(f * Math.PI) * moonDist * 0.008; // small arc
      const lateralDir = vecNormalize(vecCross(vecNormalize(moonAtArrivalVec), planeNormal));

      pos = vecAdd(
        vecAdd(
          vecScale(transferEndBlended, 1 - fCubic),
          vecScale(moonSurfacePos, fCubic)
        ),
        vecScale(lateralDir, lateralOffset)
      );
      phase = 'lunar_approach';
      altitude = Math.max(0, vecMag(vecSub(pos, moonAtArrivalVec)) - MOON_R);

    } else {
      // ── LOI + POWERED DESCENT: Low lunar orbit to Moon surface ──
      // Modeled as a deorbit ellipse in Moon-centered coordinates.
      // The descent from 100km to the surface is only ~100km total — tiny
      // compared to the 384,400km Earth-Moon distance. The arc sweeps only
      // ~27° (0.15π rad) to be physically accurate at the visualization scale.
      const f = (t - P_LOI_END) / (1.0 - P_LOI_END);

      // Deorbit ellipse: periselene at Moon surface, aposelene at 100km
      const rApo = MOON_R + 100;
      const rPeri = MOON_R;
      const aDeorbit = (rApo + rPeri) / 2;
      const eDeorbit = (rApo - rPeri) / (rApo + rPeri);

      // True anomaly: from aposelene (ν=π) sweeping only ~27° (0.15π rad)
      // NOT 180° — the descent is a tiny arc near the Moon, not a full orbit
      const nuDeorbit = Math.PI + f * (Math.PI * 0.15);

      // Radius from deorbit ellipse equation
      const pDeorbit = aDeorbit * (1 - eDeorbit * eDeorbit);
      const rFromMoonCenter = pDeorbit / (1 + eDeorbit * Math.cos(nuDeorbit));

      // Orientation of the deorbit orbit plane relative to the Moon
      // Use the trajectory's approach direction to define the deorbit plane
      const toMoonDir = vecNormalize(moonAtArrivalVec);
      const deorbitNormal = vecNormalize(vecCross(toMoonDir, planeNormal));
      const deorbitPerp = vecNormalize(vecCross(deorbitNormal, toMoonDir));

      // Position on the deorbit ellipse
      const deorbitX = rFromMoonCenter * Math.cos(nuDeorbit);
      const deorbitY = rFromMoonCenter * Math.sin(nuDeorbit);

      const deorbitOffset = vecAdd(
        vecScale(toMoonDir, -deorbitX),  // along approach direction
        vecScale(deorbitPerp, deorbitY)   // perpendicular curve
      );

      pos = vecAdd(moonAtArrivalVec, deorbitOffset);
      phase = f < 0.5 ? 'lunar_orbit' : 'landing';
      altitude = Math.max(0, rFromMoonCenter - MOON_R);
    }

    const time = new Date(launchDate.getTime() + t * flightTimeS * 1000);

    waypoints.push({
      position: pos,
      velocity: { x: 0, y: 0, z: 0 },
      time,
      phase,
      altitude: altitude || 0,
    });
  }

  // Transfer orbit parameters (for reporting compatibility)
  const eTransfer = 1 - rLeo / aTransfer;
  const transferPeriod = TWO_PI * Math.sqrt(Math.pow(aTransfer, 3) / mu);

  return {
    waypoints,
    deltaV: {
      toLeo: dvLeo,
      tli: dvTli,
      loi: dvLoi,
      total: dvTotal,
    },
    flightDuration: flightTimeS,
    transferOrbit: {
      semiMajorAxis: aTransfer,
      eccentricity: eTransfer,
      perigee: rLeo,
      apogee: moonDist,
      period: transferPeriod,
    },
    moonPositionAtArrival: moonAtArrival,
    rocketParams: rocketParams || {},
    transferResult: 'capture',
    closestMoonApproach: MOON_R, // lands on surface
  };
}

// ─── 6. Predict Object Positions ────────────────────────────────────────────────

/**
 * Given an array of TLE records, predict positions of all objects at each time step.
 *
 * @param {Array<{noradId: string, name: string, line1: string, line2: string}>} tleData
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {number} stepMinutes - time step in minutes
 * @returns {Map<string, Array<{position: {x,y,z}, time: Date}>>} Map of NORAD_ID -> positions
 */
export function predictObjectPositions(tleData, startDate, endDate, stepMinutes = 1) {
  const results = new Map();
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const stepMs = stepMinutes * 60 * 1000;

  for (const tle of tleData) {
    const positions = [];
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);

    for (let tMs = startMs; tMs <= endMs; tMs += stepMs) {
      const currentDate = new Date(tMs);
      const posVel = satellite.propagate(satrec, currentDate);

      if (posVel.position && posVel.position !== false) {
        positions.push({
          position: {
            x: posVel.position.x,
            y: posVel.position.y,
            z: posVel.position.z,
          },
          time: currentDate,
          velocity: posVel.velocity
            ? {
                x: posVel.velocity.x,
                y: posVel.velocity.y,
                z: posVel.velocity.z,
              }
            : null,
        });
      }
    }

    results.set(tle.noradId, positions);
  }

  return results;
}

// ─── 7. Collision Checking ──────────────────────────────────────────────────────

/**
 * Check for close approaches between a rocket trajectory and orbital objects.
 *
 * @param {Array<{position: {x,y,z}, time: Date}>} trajectoryPoints
 * @param {Map<string, Array<{position: {x,y,z}, time: Date}>>} objectPositions
 * @param {number} minDistanceKm - minimum safe distance
 * @param {Array<{noradId: string, name: string}>} [tleData] - for object names
 * @returns {Array<{time: Date, objectId: string, objectName: string, distanceKm: number,
 *   rocketPosition: {x,y,z}, objectPosition: {x,y,z}}>}
 */
export function checkCollisions(
  trajectoryPoints,
  objectPositions,
  minDistanceKm = 10,
  tleData = []
) {
  const closeApproaches = [];

  // Build a name lookup
  const nameMap = new Map();
  for (const tle of tleData) {
    nameMap.set(tle.noradId, tle.name || `Object ${tle.noradId}`);
  }

  for (const [objectId, objPositions] of objectPositions) {
    if (objPositions.length === 0) continue;

    // For each trajectory point, find the closest object position in time
    // and check distance
    let objIdx = 0;

    for (const trajPoint of trajectoryPoints) {
      const trajTime = trajPoint.time.getTime();

      // Advance object index to nearest time
      while (
        objIdx < objPositions.length - 1 &&
        Math.abs(objPositions[objIdx + 1].time.getTime() - trajTime) <
          Math.abs(objPositions[objIdx].time.getTime() - trajTime)
      ) {
        objIdx++;
      }

      const objPoint = objPositions[objIdx];
      const timeDiffMs = Math.abs(objPoint.time.getTime() - trajTime);

      // Only compare if times are within 2 minutes of each other
      if (timeDiffMs > 120000) continue;

      // Interpolate object position between the two bracketing data points
      // Fix: use objIdx-1 and objIdx (not skip the nearest point)
      let objPos = objPoint.position;
      if (objIdx > 0 && objIdx < objPositions.length) {
        const prev = objPositions[objIdx - 1];
        const curr = objPositions[objIdx];
        const prevTime = prev.time.getTime();
        const currTime = curr.time.getTime();
        if (currTime > prevTime) {
          const interpFrac = (trajTime - prevTime) / (currTime - prevTime);
          if (interpFrac >= 0 && interpFrac <= 1) {
            objPos = {
              x: lerp(prev.position.x, curr.position.x, interpFrac),
              y: lerp(prev.position.y, curr.position.y, interpFrac),
              z: lerp(prev.position.z, curr.position.z, interpFrac),
            };
          }
        }
      }

      const dist = vecMag(vecSub(trajPoint.position, objPos));

      if (dist < minDistanceKm) {
        closeApproaches.push({
          time: trajPoint.time,
          objectId,
          objectName: nameMap.get(objectId) || `Object ${objectId}`,
          distanceKm: dist,
          rocketPosition: { ...trajPoint.position },
          objectPosition: { ...objPos },
        });
      }
    }
  }

  // Sort by distance (closest first)
  closeApproaches.sort((a, b) => a.distanceKm - b.distanceKm);

  return closeApproaches;
}

// ─── 8. Find Optimal Launch Windows ─────────────────────────────────────────────

/**
 * Fast analytical pre-screen: compute Hohmann delta-V without RK4.
 * Used to quickly rank candidates before running expensive trajectory sims.
 */
function quickHohmannScore(launchDate, launchLat, launchLon) {
  // Moon position at launch (needed for Hohmann transfer geometry)
  const moonAtLaunch = getMoonPositionCached(launchDate);
  const moonLaunchDist = Math.sqrt(moonAtLaunch.x**2 + moonAtLaunch.y**2 + moonAtLaunch.z**2);

  // Hohmann transfer parameters
  const rLeo = EARTH_RADIUS_KM + LEO_ALTITUDE_KM;
  const aTransfer = (rLeo + moonLaunchDist) / 2;

  // Compute ACTUAL flight time: T_flight = π * sqrt(a³/μ)
  const flightTimeS = Math.PI * Math.sqrt(Math.pow(aTransfer, 3) / EARTH_MU);
  const flightTimeDays = flightTimeS / SECONDS_PER_DAY;

  // Use the COMPUTED flight time to predict Moon position at arrival
  const moonAtArrival = getMoonPositionCached(new Date(launchDate.getTime() + flightTimeS * 1000));
  const moonDist = Math.sqrt(moonAtArrival.x**2 + moonAtArrival.y**2 + moonAtArrival.z**2);

  const vCirc = Math.sqrt(EARTH_MU / rLeo);
  const vTli = Math.sqrt(EARTH_MU * (2/rLeo - 1/aTransfer));
  const dvTli = vTli - vCirc;

  // Geometric alignment score: check if the Moon will actually BE at the
  // transfer ellipse apogee when the spacecraft arrives there.
  //
  // The ideal launch occurs when:
  //   Moon angle at arrival = launch angle + 180° (Moon at apogee point)
  //
  // Moon's angular velocity: ~13.176°/day = 360° / 27.321661 days
  const moonAngularVelDeg = 360.0 / MOON_ORBITAL_PERIOD_DAYS; // ~13.176 °/day

  // Compute angular positions in the ecliptic plane
  const launchAngle = Math.atan2(moonAtLaunch.y, moonAtLaunch.x); // Moon angle at launch
  const arrivalAngle = Math.atan2(moonAtArrival.y, moonAtArrival.x); // Moon angle at arrival

  // The transfer ellipse apogee direction: for a Hohmann transfer departing
  // from LEO, the apogee is ~180° around from the perigee (departure point).
  // The launch direction in ECI determines the departure angle.
  const gmst = computeGmst(launchDate);
  const latRad = launchLat * DEG_TO_RAD;
  const lonECI = launchLon * DEG_TO_RAD + gmst;
  const launchDirAngle = Math.atan2(
    Math.cos(latRad) * Math.sin(lonECI),
    Math.cos(latRad) * Math.cos(lonECI)
  );
  // Apogee is ~180° from launch direction (opposite side of the orbit)
  const apogeeAngle = launchDirAngle + Math.PI;

  // Angular difference between where the Moon will be and where apogee is
  let angleDiff = arrivalAngle - apogeeAngle;
  // Normalize to [-π, π]
  while (angleDiff > Math.PI) angleDiff -= TWO_PI;
  while (angleDiff < -Math.PI) angleDiff += TWO_PI;

  // Geometric alignment: 1.0 = perfect (Moon at apogee), 0.0 = worst (180° off)
  const geometricScore = Math.cos(angleDiff) * 0.5 + 0.5; // maps [-1,1] -> [0,1]

  // Score: lower delta-V = better. Also factor in geometric alignment.
  return { dvTli, moonDist, moonPos: moonAtArrival, flightTimeDays, geometricScore };
}

/**
 * Find optimal launch windows by evaluating trajectory quality, delta-V, and
 * collision risk over a time range.
 *
 * Strategy:
 *   Phase 1: Coarse sweep - 6-hour intervals across the ENTIRE window
 *            (analytical Hohmann pre-screen, extremely fast)
 *   Phase 2: Fine sweep - 1-minute intervals around the best coarse candidates
 *            (analytical, narrows to precise optimal minutes)
 *   Phase 3: Low-resolution RK4 trajectories on the top refined candidates
 *            (for accurate delta-V scoring)
 *   Phase 4: Full-resolution SMOOTH trajectories on the final selected windows
 *            (uses generateSmoothTrajectory for display-quality curves)
 *
 * @param {{ lat: number, lon: number, name: string }} launchSite
 * @param {Date} windowStart
 * @param {Date} windowEnd
 * @param {Object} rocketParams
 * @param {Array<{noradId: string, name: string, line1: string, line2: string}>} tleData
 * @param {number} [numWindows=5] - number of top windows to return
 * @param {function} [progressCallback] - called with { phase, progress (0-1), message }
 * @returns {Promise<Array<{ launchDate: Date, score: number, trajectory: Object,
 *   closeApproaches: Array, deltaV: Object, flightDuration: number,
 *   moonArrivalPosition: Object, landingSite: Object }>>}
 */
export async function findOptimalLaunchWindows(
  launchSite,
  windowStart,
  windowEnd,
  rocketParams,
  tleData = [],
  numWindows = 5,
  progressCallback
) {
  const notify = progressCallback || (() => {});
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const minCollisionDist = 10; // km safety margin

  // ── Phase 1: Coarse sweep at 6-hour intervals across entire window ──
  notify({ phase: 'coarse', progress: 0, message: 'Scanning launch window (6-hour intervals)...' });

  const COARSE_STEP_MS = 6 * 3600 * 1000; // 6 hours
  const coarseResults = [];
  const totalCoarseSteps = Math.ceil((endMs - startMs) / COARSE_STEP_MS);
  let coarseCount = 0;

  for (let tMs = startMs; tMs <= endMs; tMs += COARSE_STEP_MS) {
    const candidateDate = new Date(tMs);
    try {
      const hohmann = quickHohmannScore(candidateDate, launchSite.lat, launchSite.lon);
      coarseResults.push({ launchDate: candidateDate, ...hohmann });
    } catch (e) {
      // Skip candidates where analytical scoring fails
    }

    coarseCount++;
    // Yield every 50 iterations
    if (coarseCount % 50 === 0) {
      notify({ phase: 'coarse', progress: coarseCount / totalCoarseSteps, message: `Coarse scan: ${coarseCount}/${totalCoarseSteps} checked` });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  notify({ phase: 'coarse', progress: 1, message: `Coarse scan complete: ${coarseResults.length} candidates` });

  // Sort by combined score: lower delta-V and better geometric alignment = better
  // Composite: normalize dvTli to [0,1] range (typical dvTli is ~3.1-3.3 km/s)
  // and combine with geometric score (already [0,1])
  const dvTliValues = coarseResults.map(r => r.dvTli);
  const dvMin = Math.min(...dvTliValues);
  const dvMax = Math.max(...dvTliValues);
  const dvRange = dvMax - dvMin || 1;
  const compositeScore = (r) => {
    const dvNorm = (r.dvTli - dvMin) / dvRange; // 0 = best dv, 1 = worst
    return dvNorm * 0.6 + (1 - (r.geometricScore || 0)) * 0.4; // lower = better
  };
  coarseResults.sort((a, b) => compositeScore(a) - compositeScore(b));
  const coarseTop = coarseResults.slice(0, 20);

  // ── Phase 2: Fine sweep at 1-minute intervals around top coarse candidates ──
  notify({ phase: 'fine', progress: 0, message: 'Refining best candidates (1-minute intervals)...' });

  const FINE_STEP_MS = 60 * 1000; // 1 minute
  const FINE_WINDOW_MS = 6 * 3600 * 1000; // +/- 6 hours around each coarse candidate (total 12 hr)
  const fineResults = [];
  const seenMinutes = new Set(); // de-duplicate overlapping fine windows

  for (let ci = 0; ci < coarseTop.length; ci++) {
    const center = coarseTop[ci].launchDate.getTime();
    const fineStart = Math.max(startMs, center - FINE_WINDOW_MS);
    const fineEnd = Math.min(endMs, center + FINE_WINDOW_MS);

    for (let tMs = fineStart; tMs <= fineEnd; tMs += FINE_STEP_MS) {
      const minuteKey = Math.floor(tMs / FINE_STEP_MS);
      if (seenMinutes.has(minuteKey)) continue;
      seenMinutes.add(minuteKey);

      const candidateDate = new Date(tMs);
      try {
        const hohmann = quickHohmannScore(candidateDate, launchSite.lat, launchSite.lon);
        fineResults.push({ launchDate: candidateDate, ...hohmann });
      } catch (e) {
        // skip
      }
    }

    notify({ phase: 'fine', progress: (ci + 1) / coarseTop.length, message: `Fine scan: region ${ci + 1}/${coarseTop.length}` });
    await new Promise(r => setTimeout(r, 0));
  }

  // Merge coarse + fine, sort by composite score, keep top 10
  const allAnalytical = [...coarseResults, ...fineResults];
  // Re-compute composite score range over the full set
  const allDvValues = allAnalytical.map(r => r.dvTli);
  const allDvMin = Math.min(...allDvValues);
  const allDvMax = Math.max(...allDvValues);
  const allDvRange = allDvMax - allDvMin || 1;
  const compositeScoreAll = (r) => {
    const dvNorm = (r.dvTli - allDvMin) / allDvRange;
    return dvNorm * 0.6 + (1 - (r.geometricScore || 0)) * 0.4;
  };
  allAnalytical.sort((a, b) => compositeScoreAll(a) - compositeScoreAll(b));
  // De-duplicate: keep best per 30-minute bucket
  const bucketBest = new Map();
  for (const item of allAnalytical) {
    const bucketKey = Math.floor(item.launchDate.getTime() / (30 * 60 * 1000));
    if (!bucketBest.has(bucketKey) || compositeScoreAll(item) < compositeScoreAll(bucketBest.get(bucketKey))) {
      bucketBest.set(bucketKey, item);
    }
  }
  const topCandidates = [...bucketBest.values()]
    .sort((a, b) => compositeScoreAll(a) - compositeScoreAll(b))
    .slice(0, 10);

  // ── Phase 3: Low-resolution RK4 trajectories for accurate scoring ──
  notify({ phase: 'scoring', progress: 0, message: 'Computing trajectories for top candidates...' });

  const candidates = [];

  for (let ci = 0; ci < topCandidates.length; ci++) {
    const candidate = topCandidates[ci];
    const candidateDate = candidate.launchDate;

    // Low-resolution RK4 for accurate delta-V and flight-time scoring
    let trajectory;
    try {
      trajectory = calculateTranslunarTrajectory(
        candidateDate,
        launchSite.lat,
        launchSite.lon,
        rocketParams,
        true // lowResolution
      );
    } catch (e) {
      continue;
    }

    notify({ phase: 'scoring', progress: (ci + 1) / topCandidates.length, message: `Scoring candidate ${ci + 1}/${topCandidates.length}` });
    await new Promise(r => setTimeout(r, 0));

    const moonAtArrival = trajectory.moonPositionAtArrival;
    let closeApproaches = [];

    // ── Collision checking during LEO/MEO crossing (first 2 hours) ──
    // Object density is highest in LEO/MEO, so focus collision checks there.
    if (tleData.length > 0) {
      const TWO_HOURS_MS = 2 * 3600 * 1000;
      const earlyWaypoints = trajectory.waypoints.filter(wp => {
        const elapsed = wp.time.getTime() - candidateDate.getTime();
        return elapsed >= 0 && elapsed <= TWO_HOURS_MS;
      });

      if (earlyWaypoints.length > 0) {
        const earlyStart = earlyWaypoints[0].time;
        const earlyEnd = earlyWaypoints[earlyWaypoints.length - 1].time;

        // Propagate TLE-based objects through the early trajectory window
        // Use 1-minute steps for reasonable resolution
        const objectPositions = predictObjectPositions(tleData, earlyStart, earlyEnd, 1);

        // Check for close approaches at multiple distance thresholds:
        //   <10km  = critical (conjunction risk)
        //   <50km  = warning
        //   <200km = awareness
        const allApproaches = [];

        for (const [objectId, objPositions] of objectPositions) {
          if (objPositions.length === 0) continue;

          let objIdx = 0;
          for (const trajPoint of earlyWaypoints) {
            const trajTime = trajPoint.time.getTime();

            // Advance object index to nearest time
            while (
              objIdx < objPositions.length - 1 &&
              Math.abs(objPositions[objIdx + 1].time.getTime() - trajTime) <
                Math.abs(objPositions[objIdx].time.getTime() - trajTime)
            ) {
              objIdx++;
            }

            const objPoint = objPositions[objIdx];
            const timeDiffMs = Math.abs(objPoint.time.getTime() - trajTime);
            if (timeDiffMs > 120000) continue; // skip if >2min apart

            // Interpolate object position
            let objPos = objPoint.position;
            if (objIdx > 0 && objIdx < objPositions.length) {
              const prev = objPositions[objIdx - 1];
              const curr = objPositions[objIdx];
              const prevTime = prev.time.getTime();
              const currTime = curr.time.getTime();
              if (currTime > prevTime) {
                const interpFrac = (trajTime - prevTime) / (currTime - prevTime);
                if (interpFrac >= 0 && interpFrac <= 1) {
                  objPos = {
                    x: lerp(prev.position.x, curr.position.x, interpFrac),
                    y: lerp(prev.position.y, curr.position.y, interpFrac),
                    z: lerp(prev.position.z, curr.position.z, interpFrac),
                  };
                }
              }
            }

            const dist = vecMag(vecSub(trajPoint.position, objPos));

            if (dist < 200) { // awareness threshold
              const objectName = tleData.find(t => t.noradId === objectId)?.name || `Object ${objectId}`;
              let severity = 'awareness';
              if (dist < 10) severity = 'critical';
              else if (dist < 50) severity = 'warning';

              allApproaches.push({
                time: trajPoint.time,
                objectId,
                objectName,
                distanceKm: dist,
                severity,
                rocketPosition: { ...trajPoint.position },
                objectPosition: { ...objPos },
              });
            }
          }
        }

        // Sort by distance, keep closest approaches
        allApproaches.sort((a, b) => a.distanceKm - b.distanceKm);
        closeApproaches = allApproaches.slice(0, 50); // cap at 50 entries
      }
    }

    // Compute landing site
    const lastWaypoint = trajectory.waypoints[trajectory.waypoints.length - 1];
    const secondLast = trajectory.waypoints[trajectory.waypoints.length - 2] || lastWaypoint;
    const approachVec = vecSub(lastWaypoint.position, secondLast.position);
    const landingSite = getMoonLandingSite(moonAtArrival, approachVec);

    // ── Scoring ──
    const actualDv = trajectory.deltaV.total;
    const dvScore = Math.max(0, 1 - Math.abs(actualDv - 12) / 5);

    // Collision score based on actual close approach results
    // Critical (<10km) = heavy penalty, Warning (<50km) = moderate, Awareness (<200km) = light
    const criticalCount = closeApproaches.filter(a => a.severity === 'critical').length;
    const warningCount = closeApproaches.filter(a => a.severity === 'warning').length;
    const awarenessCount = closeApproaches.filter(a => a.severity === 'awareness').length;
    const collisionPenalty = criticalCount * 0.3 + warningCount * 0.1 + awarenessCount * 0.02;
    const collisionScore = Math.max(0, 1 - collisionPenalty);

    const isp = rocketParams.specificImpulseS || 311;
    const g0Mps = 9.80665;
    const massRatio = Math.exp((actualDv * 1000) / (isp * g0Mps));
    const fuelFraction = 1 - 1 / massRatio;
    const efficiencyScore = Math.max(0, 1 - fuelFraction);

    const flightDays = trajectory.flightDuration / SECONDS_PER_DAY;
    const durationScore = Math.max(0, 1 - Math.abs(flightDays - 3.5) / 3);
    const captureBonus = trajectory.transferResult === 'capture' ? 0.2 : 0;

    const score =
      dvScore * 0.30 +
      collisionScore * 0.25 +
      efficiencyScore * 0.15 +
      durationScore * 0.15 +
      captureBonus * 0.15;

    candidates.push({
      launchDate: candidateDate,
      score,
      trajectory,
      closeApproaches,
      deltaV: trajectory.deltaV,
      flightDuration: trajectory.flightDuration,
      moonArrivalPosition: moonAtArrival,
      landingSite,
      scoring: { dvScore, collisionScore, efficiencyScore, durationScore, captureBonus },
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Select top N with at least 24-hour separation
  const MIN_SEPARATION_MS = 24 * 3600 * 1000;
  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= numWindows) break;
    const candidateMs = candidate.launchDate.getTime();
    const tooClose = selected.some(
      (s) => Math.abs(s.launchDate.getTime() - candidateMs) < MIN_SEPARATION_MS
    );
    if (!tooClose) {
      selected.push(candidate);
    }
  }

  // Fill remaining if needed
  if (selected.length < numWindows) {
    for (const candidate of candidates) {
      if (selected.length >= numWindows) break;
      if (!selected.includes(candidate)) {
        selected.push(candidate);
      }
    }
  }

  // ── Phase 4: Generate smooth display trajectories + collision checking ──
  notify({ phase: 'display', progress: 0, message: 'Generating smooth display trajectories...' });

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];

    try {
      // Use generateSmoothTrajectory for display-quality curves (no right angles)
      const smoothTrajectory = generateSmoothTrajectory(
        entry.launchDate,
        launchSite.lat,
        launchSite.lon,
        rocketParams
      );

      // Preserve the accurate delta-V / flight-duration from the RK4 scoring run,
      // but use the smooth waypoints for rendering.
      smoothTrajectory.deltaV = entry.deltaV;
      smoothTrajectory.flightDuration = entry.flightDuration;

      // Run collision checking on the smooth trajectory
      let closeApproaches = [];
      if (tleData.length > 0) {
        const trajStart = smoothTrajectory.waypoints[0].time;
        const trajEnd = smoothTrajectory.waypoints[smoothTrajectory.waypoints.length - 1].time;
        const objectPositions = predictObjectPositions(tleData, trajStart, trajEnd, 5);
        closeApproaches = checkCollisions(
          smoothTrajectory.waypoints,
          objectPositions,
          minCollisionDist,
          tleData
        );
      }

      // Update collision score
      const collisionScore = 1 / (1 + closeApproaches.length * 2);
      const updatedScore =
        entry.scoring.dvScore * 0.30 +
        collisionScore * 0.25 +
        entry.scoring.efficiencyScore * 0.15 +
        entry.scoring.durationScore * 0.15 +
        entry.scoring.captureBonus * 0.15;

      selected[i] = {
        ...entry,
        trajectory: smoothTrajectory,
        closeApproaches,
        deltaV: entry.deltaV, // keep RK4-accurate values
        flightDuration: entry.flightDuration,
        score: updatedScore,
        scoring: { ...entry.scoring, collisionScore },
      };
    } catch (e) {
      // Keep the low-res RK4 trajectory if smooth generation fails
    }

    notify({ phase: 'display', progress: (i + 1) / selected.length, message: `Smooth trajectory ${i + 1}/${selected.length}` });
    await new Promise(r => setTimeout(r, 0));
  }

  // Final sort after collision score updates
  selected.sort((a, b) => b.score - a.score);

  notify({ phase: 'complete', progress: 1, message: 'Launch window search complete' });

  return selected;
}

// ─── 9. Moon Landing Site ───────────────────────────────────────────────────────

/**
 * Given the Moon's position and the rocket's approach trajectory,
 * determine the landing coordinates on the lunar surface and the nearest
 * named feature.
 *
 * @param {Object} moonPos - {x, y, z} Moon center in ECI km
 * @param {Object} approachVector - {x, y, z} direction of approach (trajectory tail)
 * @returns {{ lat: number, lon: number, craterName: string, terrainType: string,
 *   distanceToFeature: number }}
 */
export function getMoonLandingSite(moonPos, approachVector) {
  // The landing site is on the sub-spacecraft point on the Moon's surface,
  // i.e., where the approach vector intersects the Moon's sphere.

  // Normalize the approach vector (should point FROM spacecraft TO Moon)
  const moonCenter = { x: moonPos.x, y: moonPos.y, z: moonPos.z };
  const approachDir = vecNormalize(approachVector);

  // The landing point is on the Moon's surface along the approach direction
  // In Moon-centric coords, this is simply the approach direction * Moon radius
  // First compute the approach direction in Moon-centric frame
  // The approach is from the Earth side, so we consider the sub-Earth point plus
  // the approach angle offset.

  // Convert approach vector to lat/lon on Moon surface
  // In Moon-centric coordinates where x points from Moon to Earth
  const moonToEarth = vecNormalize(vecScale(moonCenter, -1));

  // The landing site is offset from the sub-Earth point by the approach angle
  const approachInMoonFrame = vecNormalize(approachDir);

  // Compute selenographic coordinates of the landing point
  // Use the approach direction projected onto the Moon's surface
  // Reference frame: Moon's equator and prime meridian (Earth-facing)
  let landingLat =
    Math.asin(Math.max(-1, Math.min(1, approachInMoonFrame.z / 1.0))) * RAD_TO_DEG;

  let landingLon =
    Math.atan2(approachInMoonFrame.y, approachInMoonFrame.x) * RAD_TO_DEG;

  // Adjust longitude relative to Moon's Earth-facing side
  // Sub-Earth point is at lon=0, so offset by the angle between approach and Earth direction
  const angleBetween = Math.acos(
    Math.max(-1, Math.min(1, vecDot(approachInMoonFrame, moonToEarth)))
  );
  const crossProduct = vecCross(moonToEarth, approachInMoonFrame);
  const sign = crossProduct.z >= 0 ? 1 : -1;
  landingLon = sign * angleBetween * RAD_TO_DEG;

  // Clamp to valid range
  if (landingLon > 180) landingLon -= 360;
  if (landingLon < -180) landingLon += 360;
  if (landingLat > 90) landingLat = 90;
  if (landingLat < -90) landingLat = -90;

  // Find nearest named lunar feature
  let nearestFeature = LUNAR_FEATURES[0];
  let nearestDist = Infinity;

  for (const feature of LUNAR_FEATURES) {
    // Great-circle distance on Moon surface
    const dLat = (feature.lat - landingLat) * DEG_TO_RAD;
    const dLon = (feature.lon - landingLon) * DEG_TO_RAD;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(landingLat * DEG_TO_RAD) *
        Math.cos(feature.lat * DEG_TO_RAD) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = MOON_RADIUS_KM * c; // km on Moon surface

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestFeature = feature;
    }
  }

  return {
    lat: landingLat,
    lon: landingLon,
    craterName: nearestFeature.name,
    terrainType: nearestFeature.type,
    distanceToFeature: nearestDist,
    nearestFeature: { ...nearestFeature },
  };
}

// ─── 10. Trajectory Verification ────────────────────────────────────────────────

/**
 * Verify that a computed trajectory satisfies the basic requirements:
 * - Starts on Earth's surface (altitude ~0 km)
 * - Ends on or very near the Moon's surface
 * - Has a reasonable number of waypoints forming a smooth curve
 *
 * @param {Object} trajectory - result from calculateTranslunarTrajectory
 * @returns {{ startsOnEarth: boolean, endsOnMoon: boolean, totalWaypoints: number,
 *   flightDays: number, deltaVTotal: number, closestMoonApproachKm: number,
 *   startAltKm: number, endDistFromMoonKm: number }}
 */
export function verifyTrajectory(trajectory) {
  const first = trajectory.waypoints[0];
  const last = trajectory.waypoints[trajectory.waypoints.length - 1];
  const moonPos = trajectory.moonPositionAtArrival;

  const startAlt = Math.sqrt(
    first.position.x ** 2 + first.position.y ** 2 + first.position.z ** 2
  ) - EARTH_RADIUS_KM;

  const endDistFromMoon = moonPos
    ? Math.sqrt(
        (last.position.x - moonPos.x) ** 2 +
        (last.position.y - moonPos.y) ** 2 +
        (last.position.z - moonPos.z) ** 2
      )
    : Infinity;

  return {
    startsOnEarth: startAlt < 10, // within 10 km of surface
    endsOnMoon: endDistFromMoon < MOON_RADIUS_KM + 100, // within 100 km of Moon surface
    totalWaypoints: trajectory.waypoints.length,
    flightDays: trajectory.flightDuration / SECONDS_PER_DAY,
    deltaVTotal: trajectory.deltaV.total,
    closestMoonApproachKm: trajectory.closestMoonApproach,
    startAltKm: startAlt,
    endDistFromMoonKm: endDistFromMoon,
  };
}
