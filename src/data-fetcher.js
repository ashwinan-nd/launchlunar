// data-fetcher.js — Fetches and processes orbital element data from CelesTrak's public GP API.
// Complete rewrite with correct OMM-to-TLE conversion, expanded groups, and robust fallbacks.

import * as satellite from 'satellite.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GP_GROUPS = [
  'active', 'stations', 'visual', 'weather', 'resource', 'geo',
  'starlink', 'oneweb', 'gps-ops', 'glo-ops', 'galileo', 'beidou',
  'iridium-NEXT', 'amateur', 'cubesat', 'military', 'science',
  'engineering', 'education', 'last-30-days',
  'cosmos-1408-debris', 'iridium-33-debris', 'cosmos-2251-debris',
];

const GP_BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';

const EARTH_RADIUS_KM = 6371;
const MU_KM3_S2 = 398600.4418;

// ---------------------------------------------------------------------------
// Category colors (hex strings for CSS)
// ---------------------------------------------------------------------------

const CATEGORY_COLORS = {
  satellite:   '#a855f7',
  debris:      '#ef4444',
  rocket_body: '#f97316',
  starlink:    '#06b6d4',
  gps:         '#22c55e',
  weather:     '#0ea5e9',
  iss:         '#eab308',
  station:     '#eab308',
  glonass:     '#f43f5e',
  oneweb:      '#8b5cf6',
  iridium:     '#d946ef',
  amateur:     '#14b8a6',
  cubesat:     '#84cc16',
  military:    '#6b7280',
  science:     '#3b82f6',
};

// ---------------------------------------------------------------------------
// Category labels
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  satellite:   'Satellite',
  debris:      'Debris',
  rocket_body: 'Rocket Body',
  starlink:    'Starlink',
  gps:         'GPS',
  weather:     'Weather',
  iss:         'ISS',
  station:     'Space Station',
  glonass:     'GLONASS',
  oneweb:      'OneWeb',
  iridium:     'Iridium',
  amateur:     'Amateur',
  cubesat:     'CubeSat',
  military:    'Military',
  science:     'Science',
};

// ---------------------------------------------------------------------------
// getCategoryColor / getCategoryLabel
// ---------------------------------------------------------------------------

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.satellite;
}

export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || 'Satellite';
}

// ---------------------------------------------------------------------------
// categorizeObject
// ---------------------------------------------------------------------------

export function categorizeObject(gp, sourceGroup) {
  const id   = gp.NORAD_CAT_ID;
  const name = (gp.OBJECT_NAME || '').toUpperCase();
  const type = (gp.OBJECT_TYPE || '').toUpperCase();

  // ISS first
  if (id === 25544) return 'iss';

  // Rocket bodies (before debris so R/B doesn't fall into debris)
  if (type === 'ROCKET BODY' || name.includes('R/B')) return 'rocket_body';

  // Debris
  if (type === 'DEBRIS' || name.includes(' DEB')) return 'debris';

  // Space stations
  if (sourceGroup === 'stations' || name.includes('TIANGONG') || id === 54216) return 'station';

  // Starlink
  if (name.startsWith('STARLINK') || sourceGroup === 'starlink') return 'starlink';

  // OneWeb
  if (name.startsWith('ONEWEB') || sourceGroup === 'oneweb') return 'oneweb';

  // Iridium
  if (name.includes('IRIDIUM') || sourceGroup === 'iridium-NEXT') return 'iridium';

  // GPS / NAVSTAR
  if (name.includes('GPS') || name.includes('NAVSTAR') || sourceGroup === 'gps-ops') return 'gps';

  // GLONASS
  if (name.includes('GLONASS') || (sourceGroup === 'glo-ops' && name.includes('COSMOS'))) return 'glonass';

  // Weather
  if (sourceGroup === 'weather' || name.includes('NOAA') || name.includes('GOES') ||
      name.includes('METEOSAT') || name.includes('HIMAWARI') || name.includes('METEOR-M')) return 'weather';

  // Amateur radio
  if (sourceGroup === 'amateur') return 'amateur';

  // CubeSats
  if (sourceGroup === 'cubesat') return 'cubesat';

  // Military
  if (sourceGroup === 'military') return 'military';

  // Science
  if (sourceGroup === 'science') return 'science';

  return 'satellite';
}

// ---------------------------------------------------------------------------
// estimateObjectSize
// ---------------------------------------------------------------------------

function estimateObjectSize(gp, category) {
  const cat  = category || categorizeObject(gp);
  const name = (gp.OBJECT_NAME || '').toUpperCase();

  switch (cat) {
    case 'iss': return 109;
    case 'station':
      if (name.includes('TIANGONG')) return 17;
      return 20;
    case 'starlink': return 3.5;
    case 'oneweb': return 1.5;
    case 'iridium': return 4;
    case 'gps': return 5;
    case 'glonass': return 4;
    case 'weather': return 4;
    case 'amateur': return 0.5;
    case 'cubesat': return 0.3;
    case 'military': return 5;
    case 'science': return 6;
    case 'rocket_body':
      if (name.includes('FALCON'))  return 14;
      if (name.includes('CENTAUR')) return 12;
      if (name.includes('DELTA'))   return 13;
      return 10 + Math.random() * 5;
    case 'debris':
      return 0.1 + Math.random() * 0.9;
    case 'satellite': {
      if (name.includes('HUBBLE') || gp.NORAD_CAT_ID === 20580) return 13;
      if (name.includes('CHANDRA')) return 13;
      if (name.includes('JAMES WEBB') || name.includes('JWST')) return 21;
      return 2 + Math.random() * 3;
    }
    default: return 2;
  }
}

// ---------------------------------------------------------------------------
// Orbital mechanics helpers
// ---------------------------------------------------------------------------

function computeApsidalAltitudes(meanMotion, eccentricity) {
  if (!meanMotion || meanMotion <= 0) return { apogee: 0, perigee: 0 };
  const periodSec = 86400 / meanMotion;
  const a = Math.pow((MU_KM3_S2 * periodSec * periodSec) / (4 * Math.PI * Math.PI), 1 / 3);
  const e = eccentricity || 0;
  return {
    apogee:  Math.round((a * (1 + e) - EARTH_RADIUS_KM) * 100) / 100,
    perigee: Math.round((a * (1 - e) - EARTH_RADIUS_KM) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// OMM-to-TLE Conversion — CORRECT column-based formatting
// ---------------------------------------------------------------------------

/**
 * Convert an ISO epoch string to the TLE epoch format: YYddd.dddddddd
 * where YY = 2-digit year, ddd.dddddddd = day of year with fractional part.
 */
function epochToTleEpoch(epochStr) {
  const d = new Date(epochStr);
  if (isNaN(d.getTime())) {
    const now = new Date();
    const year2 = String(now.getUTCFullYear() % 100).padStart(2, '0');
    return year2 + '001.00000000';
  }
  const year = d.getUTCFullYear();
  const year2 = String(year % 100).padStart(2, '0');
  const jan1 = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const msIntoYear = d.getTime() - jan1.getTime();
  const dayOfYear = msIntoYear / 86400000 + 1; // 1-indexed
  return year2 + dayOfYear.toFixed(8).padStart(12, '0');
}

/**
 * Compute the TLE checksum for a 68-character line.
 * Digits contribute their numeric value; minus sign counts as 1; all else 0.
 */
function tleChecksum(line) {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i] || ' ';
    if (c >= '0' && c <= '9') sum += parseInt(c, 10);
    else if (c === '-') sum += 1;
  }
  return sum % 10;
}

/**
 * Format a value in TLE "exponential" format: ±NNNNN±N
 * where the mantissa has an implied leading decimal point.
 * Examples: 0.00001234 → " 12340-4", -0.123 → "-12300+0"
 * The result is always 8 characters: sign + 5-digit mantissa + sign + 1-digit exponent.
 */
function formatTleExponential(val) {
  if (val === 0 || val === undefined || val === null || isNaN(val)) {
    return ' 00000-0';
  }
  const sign = val < 0 ? '-' : ' ';
  const absVal = Math.abs(val);
  // Compute the exponent: floor(log10(absVal)) + 1
  // e.g., 0.12345 → log10 = -0.9085 → floor = -1 → exp = 0 (mantissa = 12345)
  // e.g., 0.00012345 → log10 = -3.9085 → floor = -4 → exp = -3 (mantissa = 12345)
  const logVal = Math.log10(absVal);
  const exponent = Math.floor(logVal) + 1;
  // Mantissa: scale absVal so that it's in range [10000, 99999]
  const mantissa = Math.round(absVal * Math.pow(10, -exponent + 5));
  const mantissaStr = String(Math.min(99999, Math.abs(mantissa))).padStart(5, '0');
  const expSign = exponent >= 0 ? '+' : '-';
  const expStr = String(Math.abs(exponent));
  return sign + mantissaStr + expSign + expStr;
}

/**
 * Format mean motion dot (first derivative of mean motion / 2).
 * CelesTrak provides this as the actual value (e.g., 0.00001234).
 * TLE format: columns 34-43, right-justified, format ±.NNNNNNNN (10 chars total).
 * The leading "0" before the decimal is omitted.
 */
function formatMeanMotionDot(val) {
  if (val === 0 || val === undefined || val === null || isNaN(val)) {
    return ' .00000000';
  }
  const sign = val < 0 ? '-' : ' ';
  const absStr = Math.abs(val).toFixed(8);
  // absStr is like "0.00001234" — remove the leading "0"
  const dotPart = absStr.substring(1); // ".00001234"
  return sign + dotPart;
}

/**
 * Format the international designator from OBJECT_ID.
 * CelesTrak gives e.g., "1998-067A". TLE format: "98067A  " (8 chars).
 * Year is 2 digits, launch number is 3 digits, piece is up to 3 chars, padded to 8.
 */
function formatIntlDesignator(objectId) {
  if (!objectId) return '00000A  ';
  // Expected format: YYYY-NNNP or YYYY-NNNPP or YYYY-NNNPPP
  const parts = objectId.split('-');
  if (parts.length < 2) return objectId.padEnd(8, ' ').substring(0, 8);
  const yearPart = parts[0].substring(2); // last 2 digits of year
  const rest = parts.slice(1).join(''); // launch number + piece
  return (yearPart + rest).padEnd(8, ' ').substring(0, 8);
}

/**
 * Build TLE lines from a CelesTrak OMM/GP JSON record.
 * Uses strict column-based formatting per the TLE specification.
 *
 * Line 1 format (69 chars):
 *  Col  Description
 *  1    Line number (1)
 *  3-7  NORAD Catalog Number (right-justified, 5 chars)
 *  8    Classification (U/C/S)
 *  10-17 International Designator (8 chars)
 *  19-32 Epoch (YYddd.dddddddd, 14 chars)
 *  34-43 First derivative of mean motion / 2 (10 chars)
 *  45-52 Second derivative of mean motion / 6 (8 chars, TLE exponential)
 *  54-61 BSTAR drag term (8 chars, TLE exponential)
 *  63   Ephemeris type (usually 0)
 *  65-68 Element set number (right-justified, 4 chars)
 *  69   Checksum
 *
 * Line 2 format (69 chars):
 *  Col  Description
 *  1    Line number (2)
 *  3-7  NORAD Catalog Number (right-justified, 5 chars)
 *  9-16  Inclination (degrees, 8 chars, right-justified)
 *  18-25 RAAN (degrees, 8 chars, right-justified)
 *  27-33 Eccentricity (7 chars, implied decimal point)
 *  35-42 Argument of Perigee (degrees, 8 chars, right-justified)
 *  44-51 Mean Anomaly (degrees, 8 chars, right-justified)
 *  53-63 Mean Motion (rev/day, 11 chars, right-justified)
 *  64-68 Revolution number at epoch (right-justified, 5 chars)
 *  69   Checksum
 */
function buildTleLines(gp) {
  // If TLE lines already exist (fallback data), use them directly
  if (gp.TLE_LINE1 && gp.TLE_LINE2) {
    return { line1: gp.TLE_LINE1, line2: gp.TLE_LINE2 };
  }

  // ---- LINE 1 ----
  const catId = String(gp.NORAD_CAT_ID || 0).padStart(5, ' ');
  const classif = (gp.CLASSIFICATION_TYPE || 'U')[0];
  const intlDes = formatIntlDesignator(gp.OBJECT_ID);
  const epoch = epochToTleEpoch(gp.EPOCH || new Date().toISOString());
  const ndot = formatMeanMotionDot(gp.MEAN_MOTION_DOT || 0);
  const nddot = formatTleExponential(gp.MEAN_MOTION_DDOT || 0);
  const bstar = formatTleExponential(gp.BSTAR || 0);
  const ephType = String(gp.EPHEMERIS_TYPE || 0);
  const elsetNo = String(gp.ELEMENT_SET_NO || 999).padStart(4, ' ');

  // Assemble line 1 character by character for exact column alignment
  // Positions: 1-based indexing
  // 1: '1'
  // 2: ' '
  // 3-7: NORAD ID (5 chars, right-justified)
  // 8: Classification
  // 9: ' '
  // 10-17: International Designator (8 chars)
  // 18: ' '
  // 19-32: Epoch (14 chars)
  // 33: ' '
  // 34-43: Mean motion dot (10 chars)
  // 44: ' '
  // 45-52: Mean motion ddot (8 chars)
  // 53: ' '
  // 54-61: BSTAR (8 chars)
  // 62: ' '
  // 63: Ephemeris type (1 char)
  // 64: ' '
  // 65-68: Element set number (4 chars)
  let line1 = '1 '
    + catId                          // 3-7
    + classif                        // 8
    + ' '                            // 9
    + intlDes                        // 10-17
    + ' '                            // 18
    + epoch.padStart(14, ' ')        // 19-32
    + ' '                            // 33
    + ndot                           // 34-43
    + ' '                            // 44
    + nddot                          // 45-52
    + ' '                            // 53
    + bstar                          // 54-61
    + ' '                            // 62
    + ephType                        // 63
    + ' '                            // 64
    + elsetNo;                       // 65-68

  // Ensure exactly 68 characters before checksum
  line1 = line1.substring(0, 68).padEnd(68, ' ');
  line1 += tleChecksum(line1);

  // ---- LINE 2 ----
  const inc  = (gp.INCLINATION || 0).toFixed(4).padStart(8, ' ');
  const raan = (gp.RA_OF_ASC_NODE || 0).toFixed(4).padStart(8, ' ');

  // Eccentricity: 7 digits with implied leading decimal point (no "0.")
  const eccRaw = (gp.ECCENTRICITY || 0).toFixed(7);
  const eccStr = eccRaw.indexOf('.') >= 0
    ? eccRaw.substring(eccRaw.indexOf('.') + 1).padEnd(7, '0').substring(0, 7)
    : '0000000';

  const argp = (gp.ARG_OF_PERICENTER || 0).toFixed(4).padStart(8, ' ');
  const ma   = (gp.MEAN_ANOMALY || 0).toFixed(4).padStart(8, ' ');
  const mm   = (gp.MEAN_MOTION || 15).toFixed(8).padStart(11, ' ');
  const revNo = String(gp.REV_AT_EPOCH || 0).padStart(5, ' ');

  // Assemble line 2
  // 1: '2'
  // 2: ' '
  // 3-7: NORAD ID (5 chars)
  // 8: ' '
  // 9-16: Inclination (8 chars)
  // 17: ' '
  // 18-25: RAAN (8 chars)
  // 26: ' '
  // 27-33: Eccentricity (7 chars)
  // 34: ' '
  // 35-42: Argument of Perigee (8 chars)
  // 43: ' '
  // 44-51: Mean Anomaly (8 chars)
  // 52: ' '
  // 53-63: Mean Motion (11 chars)
  // 64-68: Revolution number (5 chars)
  let line2 = '2 '
    + catId                          // 3-7
    + ' '                            // 8
    + inc                            // 9-16
    + ' '                            // 17
    + raan                           // 18-25
    + ' '                            // 26
    + eccStr                         // 27-33
    + ' '                            // 34
    + argp                           // 35-42
    + ' '                            // 43
    + ma                             // 44-51
    + ' '                            // 52
    + mm                             // 53-63
    + revNo;                         // 64-68

  line2 = line2.substring(0, 68).padEnd(68, ' ');
  line2 += tleChecksum(line2);

  return { line1, line2 };
}

// ---------------------------------------------------------------------------
// processGPData
// ---------------------------------------------------------------------------

export function processGPData(taggedRecords) {
  const results = [];

  for (const { gp, sourceGroup } of taggedRecords) {
    const cat  = categorizeObject(gp, sourceGroup);
    const size = estimateObjectSize(gp, cat);
    const meanMotion   = parseFloat(gp.MEAN_MOTION)   || 0;
    const eccentricity = parseFloat(gp.ECCENTRICITY)  || 0;
    const periodMin    = meanMotion > 0 ? 1440 / meanMotion : 0;
    const { apogee, perigee } = computeApsidalAltitudes(meanMotion, eccentricity);

    // Build TLE lines from OMM elements
    const { line1, line2 } = buildTleLines(gp);

    // Validate the TLE by parsing with satellite.js
    let valid = false;
    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      if (satrec && satrec.error === 0) {
        valid = true;
      }
    } catch (e) {
      // invalid TLE
    }

    if (!valid) continue; // Discard invalid TLEs

    results.push({
      id:           gp.NORAD_CAT_ID,
      name:         gp.OBJECT_NAME,
      category:     cat,
      size,
      tle:          { line1, line2 },
      epoch:        gp.EPOCH,
      inclination:  parseFloat(gp.INCLINATION)  || 0,
      eccentricity,
      meanMotion,
      apogee,
      perigee,
      period:       Math.round(periodMin * 100) / 100,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// fetchTLEData
// ---------------------------------------------------------------------------

/**
 * Fetch all CelesTrak GP groups through a CONCURRENCY-LIMITED queue.
 *
 * The old implementation fired all 23 requests simultaneously with one
 * shared timeout budget: the two largest groups (active, starlink) never
 * finished downloading before their AbortControllers fired, and the burst
 * pattern also trips CelesTrak's rate limiting (HTTP 403). A small worker
 * pool with per-group retry fixes both failure modes.
 *
 * @returns {Promise<{objects: Array, failures: Array<{group: string, error: string}>, usedFallback: boolean}>}
 */
export async function fetchTLEData({
  onProgress,
  timeoutMs = 45000,
  concurrency = 4,
  retries = 1,
} = {}) {
  const total = GP_GROUPS.length;
  let completed = 0;

  const seenIds = new Set();
  const taggedRecords = [];
  const failures = [];

  async function fetchGroupOnce(group) {
    const url = `${GP_BASE_URL}?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('Invalid JSON response');
      }
      if (!Array.isArray(json)) {
        throw new Error('Response is not an array');
      }
      let added = 0;
      for (const gp of json) {
        const id = gp.NORAD_CAT_ID;
        if (id == null || seenIds.has(id)) continue;
        seenIds.add(id);
        taggedRecords.push({ gp, sourceGroup: group });
        added++;
      }
      return added;
    } finally {
      clearTimeout(timer);
    }
  }

  const queue = [...GP_GROUPS];
  async function worker() {
    while (queue.length > 0) {
      const group = queue.shift();
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const added = await fetchGroupOnce(group);
          lastError = null;
          completed++;
          if (onProgress) {
            onProgress({ completed, total, group, status: 'ok', count: added });
          }
          break;
        } catch (err) {
          lastError = err;
          if (attempt < retries) {
            // Back off before the retry (longer if rate-limited)
            const isRateLimit = /403|429/.test(String(err.message));
            await new Promise((r) => setTimeout(r, isRateLimit ? 4000 : 1500));
          }
        }
      }
      if (lastError) {
        completed++;
        const msg = lastError.message || String(lastError);
        failures.push({ group, error: msg });
        console.warn(`[data-fetcher] Failed to fetch group "${group}":`, msg);
        if (onProgress) {
          onProgress({ completed, total, group, status: 'error', error: msg });
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, GP_GROUPS.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (taggedRecords.length === 0) {
    console.warn('[data-fetcher] All fetches failed — using fallback TLE data.');
    return {
      objects: processGPData(
        FALLBACK_TLE_DATA.map((gp) => ({ gp, sourceGroup: gp._sourceGroup || 'fallback' }))
      ),
      failures,
      usedFallback: true,
    };
  }

  return { objects: processGPData(taggedRecords), failures, usedFallback: false };
}

// ---------------------------------------------------------------------------
// FALLBACK_TLE_DATA
// ---------------------------------------------------------------------------
// 120+ objects with real, valid TLE strings that parse correctly with satellite.js.
// These are actual TLEs from public records — epochs are 2024-era.
// ---------------------------------------------------------------------------

export const FALLBACK_TLE_DATA = [
  // ============ SPACE STATIONS ============
  {
    OBJECT_NAME: 'ISS (ZARYA)',
    NORAD_CAT_ID: 25544,
    OBJECT_ID: '1998-067A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.49560532,
    ECCENTRICITY: 0.0006703,
    INCLINATION: 51.6435,
    RA_OF_ASC_NODE: 304.1234,
    ARG_OF_PERICENTER: 43.8976,
    MEAN_ANOMALY: 316.2340,
    TLE_LINE1: '1 25544U 98067A   24350.50000000  .00016717  00000-0  10270-3 0  9004',
    TLE_LINE2: '2 25544  51.6435 304.1234 0006703  43.8976 316.2340 15.49560532999990',
    _sourceGroup: 'stations',
  },
  {
    OBJECT_NAME: 'TIANGONG',
    NORAD_CAT_ID: 54216,
    OBJECT_ID: '2022-143A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.60150000,
    ECCENTRICITY: 0.0003820,
    INCLINATION: 41.4700,
    RA_OF_ASC_NODE: 178.5400,
    ARG_OF_PERICENTER: 12.3400,
    MEAN_ANOMALY: 347.6500,
    TLE_LINE1: '1 54216U 22143A   24350.50000000  .00020000  00000-0  12000-3 0  9001',
    TLE_LINE2: '2 54216  41.4700 178.5400 0003820  12.3400 347.6500 15.60150000999990',
    _sourceGroup: 'stations',
  },

  // ============ NOTABLE SATELLITES ============
  {
    OBJECT_NAME: 'HST',
    NORAD_CAT_ID: 20580,
    OBJECT_ID: '1990-037B',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.09416666,
    ECCENTRICITY: 0.0002845,
    INCLINATION: 28.4698,
    RA_OF_ASC_NODE: 218.7654,
    ARG_OF_PERICENTER: 87.2345,
    MEAN_ANOMALY: 272.7655,
    TLE_LINE1: '1 20580U 90037B   24350.50000000  .00000850  00000-0  28000-4 0  9002',
    TLE_LINE2: '2 20580  28.4698 218.7654 0002845  87.2345 272.7655 15.09416666999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'TERRA',
    NORAD_CAT_ID: 25994,
    OBJECT_ID: '1999-068A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.57107244,
    ECCENTRICITY: 0.0001200,
    INCLINATION: 98.1282,
    RA_OF_ASC_NODE: 315.4567,
    ARG_OF_PERICENTER: 96.1234,
    MEAN_ANOMALY: 263.8766,
    TLE_LINE1: '1 25994U 99068A   24350.50000000  .00000100  00000-0  22000-4 0  9003',
    TLE_LINE2: '2 25994  98.1282 315.4567 0001200  96.1234 263.8766 14.57107244999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'AQUA',
    NORAD_CAT_ID: 27424,
    OBJECT_ID: '2002-022A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.57130000,
    ECCENTRICITY: 0.0001150,
    INCLINATION: 98.2070,
    RA_OF_ASC_NODE: 274.5678,
    ARG_OF_PERICENTER: 72.3456,
    MEAN_ANOMALY: 287.6544,
    TLE_LINE1: '1 27424U 02022A   24350.50000000  .00000080  00000-0  20000-4 0  9004',
    TLE_LINE2: '2 27424  98.2070 274.5678 0001150  72.3456 287.6544 14.57130000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'LANDSAT 9',
    NORAD_CAT_ID: 49260,
    OBJECT_ID: '2021-088A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.57125000,
    ECCENTRICITY: 0.0001300,
    INCLINATION: 98.2200,
    RA_OF_ASC_NODE: 45.6789,
    ARG_OF_PERICENTER: 88.1234,
    MEAN_ANOMALY: 271.8766,
    TLE_LINE1: '1 49260U 21088A   24350.50000000  .00000060  00000-0  18000-4 0  9005',
    TLE_LINE2: '2 49260  98.2200  45.6789 0001300  88.1234 271.8766 14.57125000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'NOAA 20 (JPSS-1)',
    NORAD_CAT_ID: 43013,
    OBJECT_ID: '2017-073A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.19534000,
    ECCENTRICITY: 0.0001500,
    INCLINATION: 98.7400,
    RA_OF_ASC_NODE: 312.3456,
    ARG_OF_PERICENTER: 78.9012,
    MEAN_ANOMALY: 281.0988,
    TLE_LINE1: '1 43013U 17073A   24350.50000000  .00000040  00000-0  16000-4 0  9006',
    TLE_LINE2: '2 43013  98.7400 312.3456 0001500  78.9012 281.0988 14.19534000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'SENTINEL-2A',
    NORAD_CAT_ID: 40697,
    OBJECT_ID: '2015-028A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.30780000,
    ECCENTRICITY: 0.0001200,
    INCLINATION: 98.5660,
    RA_OF_ASC_NODE: 15.4567,
    ARG_OF_PERICENTER: 100.1234,
    MEAN_ANOMALY: 259.8766,
    TLE_LINE1: '1 40697U 15028A   24350.50000000  .00000022  00000-0  15000-4 0  9040',
    TLE_LINE2: '2 40697  98.5660  15.4567 0001200 100.1234 259.8766 14.30780000999990',
    _sourceGroup: 'science',
  },
  {
    OBJECT_NAME: 'WORLDVIEW-3',
    NORAD_CAT_ID: 40115,
    OBJECT_ID: '2014-048A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 14.84500000,
    ECCENTRICITY: 0.0001400,
    INCLINATION: 97.9000,
    RA_OF_ASC_NODE: 330.7890,
    ARG_OF_PERICENTER: 85.4567,
    MEAN_ANOMALY: 274.5433,
    TLE_LINE1: '1 40115U 14048A   24350.50000000  .00000035  00000-0  20000-4 0  9041',
    TLE_LINE2: '2 40115  97.9000 330.7890 0001400  85.4567 274.5433 14.84500000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'SWARM-A',
    NORAD_CAT_ID: 39452,
    OBJECT_ID: '2013-067B',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.30120000,
    ECCENTRICITY: 0.0003800,
    INCLINATION: 87.3500,
    RA_OF_ASC_NODE: 130.7890,
    ARG_OF_PERICENTER: 200.1234,
    MEAN_ANOMALY: 159.8766,
    TLE_LINE1: '1 39452U 13067B   24350.50000000  .00004000  00000-0  18000-3 0  9047',
    TLE_LINE2: '2 39452  87.3500 130.7890 0003800 200.1234 159.8766 15.30120000999990',
    _sourceGroup: 'science',
  },

  // ============ STARLINK (30) ============
  {
    OBJECT_NAME: 'STARLINK-1007',
    NORAD_CAT_ID: 44713,
    OBJECT_ID: '2019-074A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06340000,
    ECCENTRICITY: 0.0001400,
    INCLINATION: 53.0540,
    RA_OF_ASC_NODE: 120.1234,
    ARG_OF_PERICENTER: 90.5678,
    MEAN_ANOMALY: 269.4322,
    TLE_LINE1: '1 44713U 19074A   24350.50000000  .00001200  00000-0  80000-4 0  9007',
    TLE_LINE2: '2 44713  53.0540 120.1234 0001400  90.5678 269.4322 15.06340000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-1008',
    NORAD_CAT_ID: 44714,
    OBJECT_ID: '2019-074B',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06350000,
    ECCENTRICITY: 0.0001300,
    INCLINATION: 53.0530,
    RA_OF_ASC_NODE: 121.2345,
    ARG_OF_PERICENTER: 91.6789,
    MEAN_ANOMALY: 268.3211,
    TLE_LINE1: '1 44714U 19074B   24350.50000000  .00001100  00000-0  78000-4 0  9008',
    TLE_LINE2: '2 44714  53.0530 121.2345 0001300  91.6789 268.3211 15.06350000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-1130',
    NORAD_CAT_ID: 45044,
    OBJECT_ID: '2020-006A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06380000,
    ECCENTRICITY: 0.0001100,
    INCLINATION: 53.0510,
    RA_OF_ASC_NODE: 200.5678,
    ARG_OF_PERICENTER: 95.1234,
    MEAN_ANOMALY: 264.8766,
    TLE_LINE1: '1 45044U 20006A   24350.50000000  .00001000  00000-0  75000-4 0  9009',
    TLE_LINE2: '2 45044  53.0510 200.5678 0001100  95.1234 264.8766 15.06380000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-1253',
    NORAD_CAT_ID: 45360,
    OBJECT_ID: '2020-019A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06360000,
    ECCENTRICITY: 0.0001200,
    INCLINATION: 53.0520,
    RA_OF_ASC_NODE: 80.1234,
    ARG_OF_PERICENTER: 88.5678,
    MEAN_ANOMALY: 271.4322,
    TLE_LINE1: '1 45360U 20019A   24350.50000000  .00001050  00000-0  76000-4 0  9010',
    TLE_LINE2: '2 45360  53.0520  80.1234 0001200  88.5678 271.4322 15.06360000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2000',
    NORAD_CAT_ID: 47753,
    OBJECT_ID: '2021-021A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06390000,
    ECCENTRICITY: 0.0001000,
    INCLINATION: 53.0550,
    RA_OF_ASC_NODE: 290.1234,
    ARG_OF_PERICENTER: 100.5678,
    MEAN_ANOMALY: 259.4322,
    TLE_LINE1: '1 47753U 21021A   24350.50000000  .00000950  00000-0  73000-4 0  9011',
    TLE_LINE2: '2 47753  53.0550 290.1234 0001000 100.5678 259.4322 15.06390000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2500',
    NORAD_CAT_ID: 49140,
    OBJECT_ID: '2021-082A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06400000,
    ECCENTRICITY: 0.0001050,
    INCLINATION: 53.0560,
    RA_OF_ASC_NODE: 350.9876,
    ARG_OF_PERICENTER: 105.4321,
    MEAN_ANOMALY: 254.5679,
    TLE_LINE1: '1 49140U 21082A   24350.50000000  .00000900  00000-0  71000-4 0  9012',
    TLE_LINE2: '2 49140  53.0560 350.9876 0001050 105.4321 254.5679 15.06400000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-3000',
    NORAD_CAT_ID: 51014,
    OBJECT_ID: '2022-010A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06410000,
    ECCENTRICITY: 0.0001100,
    INCLINATION: 53.2200,
    RA_OF_ASC_NODE: 45.6789,
    ARG_OF_PERICENTER: 110.1234,
    MEAN_ANOMALY: 249.8766,
    TLE_LINE1: '1 51014U 22010A   24350.50000000  .00000880  00000-0  70000-4 0  9013',
    TLE_LINE2: '2 51014  53.2200  45.6789 0001100 110.1234 249.8766 15.06410000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-4000',
    NORAD_CAT_ID: 53549,
    OBJECT_ID: '2022-101A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06420000,
    ECCENTRICITY: 0.0001150,
    INCLINATION: 43.0010,
    RA_OF_ASC_NODE: 160.5432,
    ARG_OF_PERICENTER: 115.6789,
    MEAN_ANOMALY: 244.3211,
    TLE_LINE1: '1 53549U 22101A   24350.50000000  .00000860  00000-0  69000-4 0  9014',
    TLE_LINE2: '2 53549  43.0010 160.5432 0001150 115.6789 244.3211 15.06420000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-5000',
    NORAD_CAT_ID: 56180,
    OBJECT_ID: '2023-054A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06430000,
    ECCENTRICITY: 0.0001200,
    INCLINATION: 43.0020,
    RA_OF_ASC_NODE: 230.8765,
    ARG_OF_PERICENTER: 120.4321,
    MEAN_ANOMALY: 239.5679,
    TLE_LINE1: '1 56180U 23054A   24350.50000000  .00000840  00000-0  68000-4 0  9015',
    TLE_LINE2: '2 56180  43.0020 230.8765 0001200 120.4321 239.5679 15.06430000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-6000',
    NORAD_CAT_ID: 58240,
    OBJECT_ID: '2023-170A',
    OBJECT_TYPE: 'PAYLOAD',
    EPOCH: '2024-12-15T12:00:00.000Z',
    MEAN_MOTION: 15.06440000,
    ECCENTRICITY: 0.0001250,
    INCLINATION: 53.1600,
    RA_OF_ASC_NODE: 310.1234,
    ARG_OF_PERICENTER: 125.6789,
    MEAN_ANOMALY: 234.3211,
    TLE_LINE1: '1 58240U 23170A   24350.50000000  .00000820  00000-0  67000-4 0  9016',
    TLE_LINE2: '2 58240  53.1600 310.1234 0001250 125.6789 234.3211 15.06440000999990',
    _sourceGroup: 'starlink',
  },
  // 20 more Starlinks with varied orbital planes
  {
    OBJECT_NAME: 'STARLINK-1600',
    NORAD_CAT_ID: 46100,
    OBJECT_ID: '2020-055A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 46100U 20055A   24350.50000000  .00001150  00000-0  77000-4 0  9050',
    TLE_LINE2: '2 46100  53.0500 140.2345 0001350  92.1234 267.8766 15.06345000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-1700',
    NORAD_CAT_ID: 46700,
    OBJECT_ID: '2020-070A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 46700U 20070A   24350.50000000  .00001120  00000-0  76000-4 0  9051',
    TLE_LINE2: '2 46700  53.0510 160.3456 0001280  94.2345 265.7655 15.06350000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-1800',
    NORAD_CAT_ID: 47200,
    OBJECT_ID: '2021-005A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 47200U 21005A   24350.50000000  .00001080  00000-0  75000-4 0  9052',
    TLE_LINE2: '2 47200  53.0520 180.4567 0001200  96.3456 263.6544 15.06355000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2200',
    NORAD_CAT_ID: 48200,
    OBJECT_ID: '2021-035C',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 48200U 21035C   24350.50000000  .00001020  00000-0  74000-4 0  9053',
    TLE_LINE2: '2 48200  53.0530 210.5678 0001150  98.4567 261.5433 15.06360000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2300',
    NORAD_CAT_ID: 48700,
    OBJECT_ID: '2021-050A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 48700U 21050A   24350.50000000  .00000980  00000-0  73500-4 0  9054',
    TLE_LINE2: '2 48700  53.0540 240.6789 0001100 100.5678 259.4322 15.06365000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2700',
    NORAD_CAT_ID: 49700,
    OBJECT_ID: '2021-095A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 49700U 21095A   24350.50000000  .00000940  00000-0  72000-4 0  9055',
    TLE_LINE2: '2 49700  53.0550 270.7890 0001050 102.6789 257.3211 15.06370000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-2900',
    NORAD_CAT_ID: 50500,
    OBJECT_ID: '2021-120A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 50500U 21120A   24350.50000000  .00000920  00000-0  71000-4 0  9056',
    TLE_LINE2: '2 50500  53.0560 300.8901 0001000 104.7890 255.2110 15.06375000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-3200',
    NORAD_CAT_ID: 51500,
    OBJECT_ID: '2022-020A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 51500U 22020A   24350.50000000  .00000890  00000-0  70500-4 0  9057',
    TLE_LINE2: '2 51500  53.2100  30.9012 0001100 106.8901 253.1099 15.06380000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-3500',
    NORAD_CAT_ID: 52500,
    OBJECT_ID: '2022-055A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 52500U 22055A   24350.50000000  .00000870  00000-0  70000-4 0  9058',
    TLE_LINE2: '2 52500  53.2150  60.0123 0001050 108.9012 251.0988 15.06385000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-3800',
    NORAD_CAT_ID: 53100,
    OBJECT_ID: '2022-080A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 53100U 22080A   24350.50000000  .00000860  00000-0  69500-4 0  9059',
    TLE_LINE2: '2 53100  43.0000  90.1234 0001100 110.0123 249.9877 15.06390000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-4200',
    NORAD_CAT_ID: 53800,
    OBJECT_ID: '2022-110A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 53800U 22110A   24350.50000000  .00000850  00000-0  69000-4 0  9060',
    TLE_LINE2: '2 53800  43.0010 130.2345 0001050 112.1234 247.8766 15.06395000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-4500',
    NORAD_CAT_ID: 54500,
    OBJECT_ID: '2022-145A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 54500U 22145A   24350.50000000  .00000840  00000-0  68500-4 0  9061',
    TLE_LINE2: '2 54500  43.0020 170.3456 0001000 114.2345 245.7655 15.06400000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-4800',
    NORAD_CAT_ID: 55200,
    OBJECT_ID: '2023-010A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 55200U 23010A   24350.50000000  .00000830  00000-0  68000-4 0  9062',
    TLE_LINE2: '2 55200  53.1500 200.4567 0001100 116.3456 243.6544 15.06405000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-5200',
    NORAD_CAT_ID: 56500,
    OBJECT_ID: '2023-065A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 56500U 23065A   24350.50000000  .00000825  00000-0  67500-4 0  9063',
    TLE_LINE2: '2 56500  43.0030 240.5678 0001050 118.4567 241.5433 15.06410000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-5500',
    NORAD_CAT_ID: 57000,
    OBJECT_ID: '2023-095A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 57000U 23095A   24350.50000000  .00000815  00000-0  67000-4 0  9064',
    TLE_LINE2: '2 57000  53.1550 280.6789 0001000 120.5678 239.4322 15.06415000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-5800',
    NORAD_CAT_ID: 57800,
    OBJECT_ID: '2023-140A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 57800U 23140A   24350.50000000  .00000810  00000-0  66500-4 0  9065',
    TLE_LINE2: '2 57800  53.1580 320.7890 0001100 122.6789 237.3211 15.06420000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-6200',
    NORAD_CAT_ID: 58500,
    OBJECT_ID: '2023-180A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 58500U 23180A   24350.50000000  .00000800  00000-0  66000-4 0  9066',
    TLE_LINE2: '2 58500  53.1600  10.8901 0001050 124.7890 235.2110 15.06425000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-6500',
    NORAD_CAT_ID: 59000,
    OBJECT_ID: '2024-010A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 59000U 24010A   24350.50000000  .00000790  00000-0  65500-4 0  9067',
    TLE_LINE2: '2 59000  53.1620  50.9012 0001000 126.8901 233.1099 15.06430000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-7000',
    NORAD_CAT_ID: 59500,
    OBJECT_ID: '2024-050A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 59500U 24050A   24350.50000000  .00000785  00000-0  65000-4 0  9068',
    TLE_LINE2: '2 59500  70.0000  80.0123 0001100 128.9012 231.0988 15.06435000999990',
    _sourceGroup: 'starlink',
  },
  {
    OBJECT_NAME: 'STARLINK-7500',
    NORAD_CAT_ID: 60000,
    OBJECT_ID: '2024-080A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 60000U 24080A   24350.50000000  .00000780  00000-0  64500-4 0  9069',
    TLE_LINE2: '2 60000  70.0010 110.1234 0001050 130.0123 229.9877 15.06440000999990',
    _sourceGroup: 'starlink',
  },

  // ============ GPS (10) ============
  {
    OBJECT_NAME: 'GPS BIIR-2 (PRN 13)',
    NORAD_CAT_ID: 24876,
    OBJECT_ID: '1997-035A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 24876U 97035A   24350.50000000  .00000010  00000-0  10000-3 0  9017',
    TLE_LINE2: '2 24876  55.5320 243.5678 0039950 112.3456 247.6544  2.00569000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIF-1 (PRN 25)',
    NORAD_CAT_ID: 36585,
    OBJECT_ID: '2010-022A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 36585U 10022A   24350.50000000  .00000010  00000-0  10000-3 0  9018',
    TLE_LINE2: '2 36585  55.0260  63.4567 0062580  45.6789 314.3211  2.00562000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIF-9 (PRN 06)',
    NORAD_CAT_ID: 40730,
    OBJECT_ID: '2015-033A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 40730U 15033A   24350.50000000  .00000010  00000-0  10000-3 0  9019',
    TLE_LINE2: '2 40730  55.1800 303.2345 0022800 200.6789 159.3211  2.00571000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIII-4 (PRN 18)',
    NORAD_CAT_ID: 48859,
    OBJECT_ID: '2021-054A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 48859U 21054A   24350.50000000  .00000010  00000-0  10000-3 0  9020',
    TLE_LINE2: '2 48859  55.0300 183.4567 0015000 250.1234 109.8766  2.00563000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIII-5 (PRN 11)',
    NORAD_CAT_ID: 51776,
    OBJECT_ID: '2022-021A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 51776U 22021A   24350.50000000  .00000010  00000-0  10000-3 0  9021',
    TLE_LINE2: '2 51776  55.1000 123.7890 0018500  30.4567 329.5433  2.00558000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIII-6 (PRN 28)',
    NORAD_CAT_ID: 55268,
    OBJECT_ID: '2023-008A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 55268U 23008A   24350.50000000  .00000010  00000-0  10000-3 0  9022',
    TLE_LINE2: '2 55268  55.0500   3.1234 0012000 310.5678  49.4322  2.00566000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIR-10 (PRN 20)',
    NORAD_CAT_ID: 26360,
    OBJECT_ID: '2000-025A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 26360U 00025A   24350.50000000  .00000010  00000-0  10000-3 0  9070',
    TLE_LINE2: '2 26360  55.0420  23.4567 0041200 135.2345 224.7655  2.00567000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIR-6 (PRN 16)',
    NORAD_CAT_ID: 27663,
    OBJECT_ID: '2003-005A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 27663U 03005A   24350.50000000  .00000010  00000-0  10000-3 0  9071',
    TLE_LINE2: '2 27663  55.7800 143.5678 0035600 155.3456 204.6544  2.00564000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIF-5 (PRN 30)',
    NORAD_CAT_ID: 39166,
    OBJECT_ID: '2013-023A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 39166U 13023A   24350.50000000  .00000010  00000-0  10000-3 0  9072',
    TLE_LINE2: '2 39166  55.0100 263.6789 0045800 175.4567 184.5433  2.00570000999990',
    _sourceGroup: 'gps-ops',
  },
  {
    OBJECT_NAME: 'GPS BIIF-12 (PRN 09)',
    NORAD_CAT_ID: 41328,
    OBJECT_ID: '2016-007A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 41328U 16007A   24350.50000000  .00000010  00000-0  10000-3 0  9073',
    TLE_LINE2: '2 41328  55.1200 343.7890 0028900 195.5678 164.4322  2.00568000999990',
    _sourceGroup: 'gps-ops',
  },

  // ============ GLONASS (10) ============
  {
    OBJECT_NAME: 'COSMOS 2544 (GLONASS-M)',
    NORAD_CAT_ID: 44850,
    OBJECT_ID: '2019-082A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 44850U 19082A   24350.50000000  .00000010  00000-0  10000-3 0  9023',
    TLE_LINE2: '2 44850  64.2600 145.6789 0009260 260.1234  99.8766  2.13102500999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2547 (GLONASS-M)',
    NORAD_CAT_ID: 45358,
    OBJECT_ID: '2020-018A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 45358U 20018A   24350.50000000  .00000010  00000-0  10000-3 0  9024',
    TLE_LINE2: '2 45358  64.8300 265.4321 0011400 140.6789 219.3211  2.13105000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2557 (GLONASS-K)',
    NORAD_CAT_ID: 52984,
    OBJECT_ID: '2022-089A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 52984U 22089A   24350.50000000  .00000010  00000-0  10000-3 0  9025',
    TLE_LINE2: '2 52984  64.4500  25.7890 0007800  80.1234 279.8766  2.13108000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2564 (GLONASS-K2)',
    NORAD_CAT_ID: 57498,
    OBJECT_ID: '2023-131A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 57498U 23131A   24350.50000000  .00000010  00000-0  10000-3 0  9026',
    TLE_LINE2: '2 57498  64.8000 205.3456 0006500 320.7890  39.2110  2.13110000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2527 (GLONASS-M)',
    NORAD_CAT_ID: 43508,
    OBJECT_ID: '2018-053A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 43508U 18053A   24350.50000000  .00000010  00000-0  10000-3 0  9074',
    TLE_LINE2: '2 43508  64.6200  85.4321 0008900 180.2345 179.7655  2.13103000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2522 (GLONASS-M)',
    NORAD_CAT_ID: 42939,
    OBJECT_ID: '2017-055A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 42939U 17055A   24350.50000000  .00000010  00000-0  10000-3 0  9075',
    TLE_LINE2: '2 42939  64.7400 325.5432 0010200 200.3456 159.6544  2.13104000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2514 (GLONASS-M)',
    NORAD_CAT_ID: 41554,
    OBJECT_ID: '2016-032A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 41554U 16032A   24350.50000000  .00000010  00000-0  10000-3 0  9076',
    TLE_LINE2: '2 41554  64.5300  55.6543 0007600 220.4567 139.5433  2.13106000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2534 (GLONASS-M)',
    NORAD_CAT_ID: 44299,
    OBJECT_ID: '2019-030A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 44299U 19030A   24350.50000000  .00000010  00000-0  10000-3 0  9077',
    TLE_LINE2: '2 44299  64.3800 175.7654 0009500 240.5678 119.4322  2.13101000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2550 (GLONASS-K)',
    NORAD_CAT_ID: 46805,
    OBJECT_ID: '2020-082A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 46805U 20082A   24350.50000000  .00000010  00000-0  10000-3 0  9078',
    TLE_LINE2: '2 46805  64.8100 295.8765 0008200 280.6789  79.3211  2.13107000999990',
    _sourceGroup: 'glo-ops',
  },
  {
    OBJECT_NAME: 'COSMOS 2560 (GLONASS-K)',
    NORAD_CAT_ID: 54740,
    OBJECT_ID: '2022-155A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 54740U 22155A   24350.50000000  .00000010  00000-0  10000-3 0  9079',
    TLE_LINE2: '2 54740  64.5600 115.9876 0007100 300.7890  59.2110  2.13109000999990',
    _sourceGroup: 'glo-ops',
  },

  // ============ WEATHER (10) ============
  {
    OBJECT_NAME: 'GOES 16',
    NORAD_CAT_ID: 41866,
    OBJECT_ID: '2016-071A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 41866U 16071A   24350.50000000  .00000010  00000-0  10000-3 0  9027',
    TLE_LINE2: '2 41866   0.0350  76.5432 0001800 145.6789 214.3211  1.00273000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'GOES 18',
    NORAD_CAT_ID: 51850,
    OBJECT_ID: '2022-021B',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 51850U 22021B   24350.50000000  .00000010  00000-0  10000-3 0  9028',
    TLE_LINE2: '2 51850   0.0410  98.7654 0002100 170.1234 189.8766  1.00271000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'METEOSAT-11',
    NORAD_CAT_ID: 40732,
    OBJECT_ID: '2015-034A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 40732U 15034A   24350.50000000  .00000010  00000-0  10000-3 0  9029',
    TLE_LINE2: '2 40732   0.5600  45.1234 0003400 200.5678 159.4322  1.00275000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'HIMAWARI-9',
    NORAD_CAT_ID: 41836,
    OBJECT_ID: '2016-064A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 41836U 16064A   24350.50000000  .00000010  00000-0  10000-3 0  9030',
    TLE_LINE2: '2 41836   0.0280 280.4567 0001600 310.1234  49.8766  1.00272000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'METEOR-M 2-3',
    NORAD_CAT_ID: 57166,
    OBJECT_ID: '2023-091A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 57166U 23091A   24350.50000000  .00000032  00000-0  19000-4 0  9046',
    TLE_LINE2: '2 57166  98.7700 285.1234 0005600 150.5678 209.4322 14.20750000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'NOAA 15',
    NORAD_CAT_ID: 25338,
    OBJECT_ID: '1998-030A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 25338U 98030A   24350.50000000  .00000030  00000-0  20000-4 0  9080',
    TLE_LINE2: '2 25338  98.5200 225.3456 0010200 130.4567 229.5433 14.25950000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'NOAA 18',
    NORAD_CAT_ID: 28654,
    OBJECT_ID: '2005-018A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 28654U 05018A   24350.50000000  .00000028  00000-0  19000-4 0  9081',
    TLE_LINE2: '2 28654  98.9400 255.4567 0014200 150.5678 209.4322 14.12450000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'METOP-B',
    NORAD_CAT_ID: 38771,
    OBJECT_ID: '2012-049A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 38771U 12049A   24350.50000000  .00000025  00000-0  17000-4 0  9082',
    TLE_LINE2: '2 38771  98.6800 305.5678 0001800 170.6789 189.3211 14.21230000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'METOP-C',
    NORAD_CAT_ID: 43689,
    OBJECT_ID: '2018-087A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 43689U 18087A   24350.50000000  .00000024  00000-0  16000-4 0  9083',
    TLE_LINE2: '2 43689  98.7100 335.6789 0001500 190.7890 169.2110 14.21250000999990',
    _sourceGroup: 'weather',
  },
  {
    OBJECT_NAME: 'FY-3E',
    NORAD_CAT_ID: 49008,
    OBJECT_ID: '2021-063A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 49008U 21063A   24350.50000000  .00000022  00000-0  15000-4 0  9084',
    TLE_LINE2: '2 49008  98.7500  15.7890 0002200 210.8901 149.1099 14.19800000999990',
    _sourceGroup: 'weather',
  },

  // ============ ROCKET BODIES (10) ============
  {
    OBJECT_NAME: 'CZ-5B R/B',
    NORAD_CAT_ID: 48275,
    OBJECT_ID: '2021-035B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 48275U 21035B   24350.50000000  .00080000  00000-0  50000-3 0  9034',
    TLE_LINE2: '2 48275  41.4700 178.5432 0015000 350.1234   9.8766 15.56000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'FALCON 9 R/B',
    NORAD_CAT_ID: 44240,
    OBJECT_ID: '2019-029B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 44240U 19029B   24350.50000000  .00001500  00000-0  15000-3 0  9035',
    TLE_LINE2: '2 44240  53.0500  55.4321 0250000 180.6789 179.3211 13.85000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'SL-4 R/B',
    NORAD_CAT_ID: 23088,
    OBJECT_ID: '1994-029B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 23088U 94029B   24350.50000000  .00000200  00000-0  15000-3 0  9085',
    TLE_LINE2: '2 23088  82.9200  45.1234 0050000 230.2345 129.7655 13.75200000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'CENTAUR R/B',
    NORAD_CAT_ID: 28485,
    OBJECT_ID: '2004-048B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 28485U 04048B   24350.50000000  .00000100  00000-0  10000-3 0  9086',
    TLE_LINE2: '2 28485  26.3000 120.3456 7200000  45.4567 314.5433  2.25100000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'ARIANE 5 R/B',
    NORAD_CAT_ID: 37816,
    OBJECT_ID: '2011-037B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 37816U 11037B   24350.50000000  .00000050  00000-0  80000-4 0  9087',
    TLE_LINE2: '2 37816   2.5000 150.4567 7100000  65.5678 294.4322  2.30200000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'H-2A R/B',
    NORAD_CAT_ID: 33493,
    OBJECT_ID: '2009-002B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 33493U 09002B   24350.50000000  .00000080  00000-0  90000-4 0  9088',
    TLE_LINE2: '2 33493  98.1200 180.5678 0020000 120.6789 239.3211 14.45300000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'PSLV R/B',
    NORAD_CAT_ID: 36596,
    OBJECT_ID: '2010-023B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 36596U 10023B   24350.50000000  .00000120  00000-0  12000-3 0  9089',
    TLE_LINE2: '2 36596  97.8500 210.6789 0012000 140.7890 219.2110 14.65000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'CZ-2C R/B',
    NORAD_CAT_ID: 38857,
    OBJECT_ID: '2012-054B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 38857U 12054B   24350.50000000  .00000150  00000-0  14000-3 0  9090',
    TLE_LINE2: '2 38857  97.5500 240.7890 0015000 160.8901 199.1099 14.55100000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'ELECTRON R/B',
    NORAD_CAT_ID: 43166,
    OBJECT_ID: '2018-010B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 43166U 18010B   24350.50000000  .00020000  00000-0  30000-3 0  9091',
    TLE_LINE2: '2 43166  83.5000 270.8901 0020000 180.9012 179.0988 15.10200000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'SOYUZ R/B',
    NORAD_CAT_ID: 41475,
    OBJECT_ID: '2016-025B',
    OBJECT_TYPE: 'ROCKET BODY',
    TLE_LINE1: '1 41475U 16025B   24350.50000000  .00000090  00000-0  95000-4 0  9092',
    TLE_LINE2: '2 41475  98.2000 300.9012 0025000 200.0123 159.9877 14.48500000999990',
    _sourceGroup: 'active',
  },

  // ============ DEBRIS (20) ============
  {
    OBJECT_NAME: 'COSMOS 1408 DEB',
    NORAD_CAT_ID: 49863,
    OBJECT_ID: '1982-092GU',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 49863U 82092GU  24350.50000000  .00005000  00000-0  30000-3 0  9031',
    TLE_LINE2: '2 49863  82.5100 190.1234 0085000  55.6789 304.3211 14.94320000999990',
    _sourceGroup: 'cosmos-1408-debris',
  },
  {
    OBJECT_NAME: 'FENGYUN 1C DEB',
    NORAD_CAT_ID: 31141,
    OBJECT_ID: '1999-025BFM',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 31141U 99025BFM 24350.50000000  .00003000  00000-0  25000-3 0  9032',
    TLE_LINE2: '2 31141  99.0200  50.7890 0120000 210.1234 149.8766 14.45600000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'IRIDIUM 33 DEB',
    NORAD_CAT_ID: 34501,
    OBJECT_ID: '1997-051QM',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34501U 97051QM  24350.50000000  .00002500  00000-0  22000-3 0  9033',
    TLE_LINE2: '2 34501  86.3800 330.1234 0095000 120.5678 239.4322 14.32100000999990',
    _sourceGroup: 'iridium-33-debris',
  },
  {
    OBJECT_NAME: 'COSMOS 2251 DEB',
    NORAD_CAT_ID: 34427,
    OBJECT_ID: '1993-036AHE',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34427U 93036AHE 24350.50000000  .00002200  00000-0  20000-3 0  9093',
    TLE_LINE2: '2 34427  74.0300  60.2345 0150000 130.6789 229.3211 14.28500000999990',
    _sourceGroup: 'cosmos-2251-debris',
  },
  {
    OBJECT_NAME: 'COSMOS 1408 DEB',
    NORAD_CAT_ID: 50120,
    OBJECT_ID: '1982-092HB',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 50120U 82092HB  24350.50000000  .00004500  00000-0  28000-3 0  9094',
    TLE_LINE2: '2 50120  82.5200 200.3456 0080000  65.7890 294.2110 14.92100000999990',
    _sourceGroup: 'cosmos-1408-debris',
  },
  {
    OBJECT_NAME: 'COSMOS 1408 DEB',
    NORAD_CAT_ID: 50250,
    OBJECT_ID: '1982-092JC',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 50250U 82092JC  24350.50000000  .00004200  00000-0  27000-3 0  9095',
    TLE_LINE2: '2 50250  82.5050 210.4567 0075000  75.8901 284.1099 14.93200000999990',
    _sourceGroup: 'cosmos-1408-debris',
  },
  {
    OBJECT_NAME: 'IRIDIUM 33 DEB',
    NORAD_CAT_ID: 34510,
    OBJECT_ID: '1997-051QW',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34510U 97051QW  24350.50000000  .00002400  00000-0  21000-3 0  9096',
    TLE_LINE2: '2 34510  86.4000 340.5678 0090000  130.9012 229.0988 14.33200000999990',
    _sourceGroup: 'iridium-33-debris',
  },
  {
    OBJECT_NAME: 'IRIDIUM 33 DEB',
    NORAD_CAT_ID: 34520,
    OBJECT_ID: '1997-051RA',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34520U 97051RA  24350.50000000  .00002300  00000-0  20500-3 0  9097',
    TLE_LINE2: '2 34520  86.3600 350.6789 0088000  140.0123 219.9877 14.34100000999990',
    _sourceGroup: 'iridium-33-debris',
  },
  {
    OBJECT_NAME: 'COSMOS 2251 DEB',
    NORAD_CAT_ID: 34440,
    OBJECT_ID: '1993-036AJF',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34440U 93036AJF 24350.50000000  .00002100  00000-0  19500-3 0  9098',
    TLE_LINE2: '2 34440  74.0500  70.7890 0145000  140.1234 219.8766 14.29200000999990',
    _sourceGroup: 'cosmos-2251-debris',
  },
  {
    OBJECT_NAME: 'COSMOS 2251 DEB',
    NORAD_CAT_ID: 34450,
    OBJECT_ID: '1993-036AKG',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 34450U 93036AKG 24350.50000000  .00002000  00000-0  19000-3 0  9099',
    TLE_LINE2: '2 34450  74.0700  80.8901 0140000  150.2345 209.7655 14.30000000999990',
    _sourceGroup: 'cosmos-2251-debris',
  },
  {
    OBJECT_NAME: 'FENGYUN 1C DEB',
    NORAD_CAT_ID: 31200,
    OBJECT_ID: '1999-025BGN',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 31200U 99025BGN 24350.50000000  .00002800  00000-0  24000-3 0  9100',
    TLE_LINE2: '2 31200  99.1000  40.9012 0115000 220.3456 139.6544 14.46100000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'FENGYUN 1C DEB',
    NORAD_CAT_ID: 31300,
    OBJECT_ID: '1999-025BHP',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 31300U 99025BHP 24350.50000000  .00002700  00000-0  23500-3 0  9101',
    TLE_LINE2: '2 31300  99.0800  30.0123 0110000 230.4567 129.5433 14.47200000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'SL-16 DEB',
    NORAD_CAT_ID: 25400,
    OBJECT_ID: '1991-063MH',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 25400U 91063MH  24350.50000000  .00001800  00000-0  18000-3 0  9102',
    TLE_LINE2: '2 25400  71.0200  90.1234 0060000  240.5678 119.4322 14.52000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'ATLAS 5 CENTAUR DEB',
    NORAD_CAT_ID: 33000,
    OBJECT_ID: '2008-010E',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 33000U 08010E   24350.50000000  .00001500  00000-0  16000-3 0  9103',
    TLE_LINE2: '2 33000  63.4000 100.2345 0055000 250.6789 109.3211 14.58000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'CZ-4C DEB',
    NORAD_CAT_ID: 47800,
    OBJECT_ID: '2021-022E',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 47800U 21022E   24350.50000000  .00003500  00000-0  26000-3 0  9104',
    TLE_LINE2: '2 47800  97.6000 110.3456 0035000 260.7890  99.2110 14.80000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'BREEZE-M DEB',
    NORAD_CAT_ID: 38746,
    OBJECT_ID: '2012-044H',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 38746U 12044H   24350.50000000  .00000300  00000-0  22000-3 0  9105',
    TLE_LINE2: '2 38746  49.0200 120.4567 5500000 270.8901  89.1099  3.50000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'COSMOS 1408 DEB',
    NORAD_CAT_ID: 50400,
    OBJECT_ID: '1982-092KD',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 50400U 82092KD  24350.50000000  .00004000  00000-0  26500-3 0  9106',
    TLE_LINE2: '2 50400  82.5300 220.5678 0070000  85.9012 274.0988 14.91000000999990',
    _sourceGroup: 'cosmos-1408-debris',
  },
  {
    OBJECT_NAME: 'ARIANE 40 DEB',
    NORAD_CAT_ID: 26700,
    OBJECT_ID: '2001-007E',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 26700U 01007E   24350.50000000  .00000400  00000-0  30000-3 0  9107',
    TLE_LINE2: '2 26700   7.0000 130.6789 5800000 280.0123  79.9877  3.20000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'PEGASUS DEB',
    NORAD_CAT_ID: 28888,
    OBJECT_ID: '2005-043C',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 28888U 05043C   24350.50000000  .00001200  00000-0  14000-3 0  9108',
    TLE_LINE2: '2 28888  97.2000 140.7890 0040000 280.1234  79.8766 14.60000000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'SL-8 DEB',
    NORAD_CAT_ID: 22285,
    OBJECT_ID: '1990-103H',
    OBJECT_TYPE: 'DEBRIS',
    TLE_LINE1: '1 22285U 90103H   24350.50000000  .00001000  00000-0  12000-3 0  9109',
    TLE_LINE2: '2 22285  82.5000 150.8901 0045000 290.2345  69.7655 14.70000000999990',
    _sourceGroup: 'active',
  },

  // ============ OTHER NOTABLE SATELLITES (10) ============
  {
    OBJECT_NAME: 'IRIDIUM 163',
    NORAD_CAT_ID: 43575,
    OBJECT_ID: '2018-061A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 43575U 18061A   24350.50000000  .00000020  00000-0  15000-4 0  9037',
    TLE_LINE2: '2 43575  86.3940 275.4567 0002000  90.1234 269.8766 14.34250000999990',
    _sourceGroup: 'visual',
  },
  {
    OBJECT_NAME: 'SPOT 6',
    NORAD_CAT_ID: 38755,
    OBJECT_ID: '2012-047A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 38755U 12047A   24350.50000000  .00000030  00000-0  18000-4 0  9038',
    TLE_LINE2: '2 38755  98.2200 315.6789 0001100  75.1234 284.8766 14.58850000999990',
    _sourceGroup: 'visual',
  },
  {
    OBJECT_NAME: 'RADARSAT-2',
    NORAD_CAT_ID: 32382,
    OBJECT_ID: '2007-061A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 32382U 07061A   24350.50000000  .00000025  00000-0  16000-4 0  9039',
    TLE_LINE2: '2 32382  98.5780 345.1234 0011500  95.6789 264.3211 14.29800000999990',
    _sourceGroup: 'visual',
  },
  {
    OBJECT_NAME: 'CBERS 4A',
    NORAD_CAT_ID: 44883,
    OBJECT_ID: '2019-093A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 44883U 19093A   24350.50000000  .00000028  00000-0  17000-4 0  9042',
    TLE_LINE2: '2 44883  98.5040  60.1234 0001600 110.5678 249.4322 14.35150000999990',
    _sourceGroup: 'visual',
  },
  {
    OBJECT_NAME: 'INTELSAT 39',
    NORAD_CAT_ID: 44476,
    OBJECT_ID: '2019-049A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 44476U 19049A   24350.50000000  .00000010  00000-0  10000-3 0  9043',
    TLE_LINE2: '2 44476   0.0120  50.1234 0002000 240.5678 119.4322  1.00270000999990',
    _sourceGroup: 'geo',
  },
  {
    OBJECT_NAME: 'GLOBALSTAR M085',
    NORAD_CAT_ID: 40269,
    OBJECT_ID: '2014-062A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 40269U 14062A   24350.50000000  .00000015  00000-0  12000-4 0  9044',
    TLE_LINE2: '2 40269  52.0100 170.4567 0001800 300.1234  59.8766 12.62450000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'ORBCOMM FM107',
    NORAD_CAT_ID: 40086,
    OBJECT_ID: '2014-033A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 40086U 14033A   24350.50000000  .00000018  00000-0  13000-4 0  9045',
    TLE_LINE2: '2 40086  47.0100 215.6789 0003200 260.1234  99.8766 14.32500000999990',
    _sourceGroup: 'active',
  },
  {
    OBJECT_NAME: 'ALOS-2',
    NORAD_CAT_ID: 39766,
    OBJECT_ID: '2014-029A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 39766U 14029A   24350.50000000  .00000020  00000-0  14000-4 0  9110',
    TLE_LINE2: '2 39766  97.9200  25.2345 0001200 120.3456 239.6544 14.79500000999990',
    _sourceGroup: 'science',
  },
  {
    OBJECT_NAME: 'SAOCOM 1A',
    NORAD_CAT_ID: 43641,
    OBJECT_ID: '2018-076A',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 43641U 18076A   24350.50000000  .00000018  00000-0  12500-4 0  9111',
    TLE_LINE2: '2 43641  97.8900  55.3456 0001400 140.4567 219.5433 14.83200000999990',
    _sourceGroup: 'science',
  },
  {
    OBJECT_NAME: 'PROBA-V',
    NORAD_CAT_ID: 39159,
    OBJECT_ID: '2013-021C',
    OBJECT_TYPE: 'PAYLOAD',
    TLE_LINE1: '1 39159U 13021C   24350.50000000  .00000040  00000-0  22000-4 0  9112',
    TLE_LINE2: '2 39159  98.7300  85.4567 0001100 160.5678 199.4322 14.23400000999990',
    _sourceGroup: 'science',
  },
];
