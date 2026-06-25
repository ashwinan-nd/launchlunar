// n2yo-fetcher.js — Simplified N2YO fetcher using "above" API from multiple observer points.
// Proxied through Vite dev server to handle API key injection.

import * as satellite from 'satellite.js';
import { EARTH_RADIUS_KM } from './orbital.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_PREFIX = '/api/n2yo';

const OBSERVERS = [
  { lat: 0, lng: 0, label: 'Atlantic' },
  { lat: 0, lng: 120, label: 'Pacific' },
  { lat: 0, lng: -120, label: 'Americas' },
  { lat: 50, lng: 10, label: 'Europe' },
  { lat: 35, lng: 100, label: 'Asia' },
  { lat: -30, lng: 25, label: 'Southern' },
];

// Search radius in degrees from observer (90 = full hemisphere)
const SEARCH_RADIUS = 90;
// Category 0 = all satellite categories
const SAT_CATEGORY = 0;
// Observer altitude above sea level in meters
const OBSERVER_ALT = 0;

// N2YO category IDs for broader coverage
const N2YO_CATEGORIES = [
  0,   // All (special)
  15,  // Starlink
  18,  // Amateur Radio
  52,  // Space Stations
];

// ---------------------------------------------------------------------------
// Category classification for N2YO objects
// ---------------------------------------------------------------------------

function categorizeN2YOObject(satName) {
  const name = (satName || '').toUpperCase();

  if (name === 'ISS (ZARYA)' || name === 'ISS' || name.includes('ZARYA')) return 'iss';
  if (name.includes('TIANGONG') || name.includes('CSS ')) return 'station';
  if (name.startsWith('STARLINK')) return 'starlink';
  if (name.startsWith('ONEWEB')) return 'oneweb';
  if (name.includes('IRIDIUM')) return 'iridium';
  if (name.includes('GPS') || name.includes('NAVSTAR')) return 'gps';
  if (name.includes('GLONASS') || name.includes('COSMOS')) return 'glonass';
  if (name.includes('NOAA') || name.includes('GOES') || name.includes('METEOSAT') ||
      name.includes('HIMAWARI') || name.includes('METEOR')) return 'weather';
  if (name.includes(' DEB') || name.includes('DEBRIS')) return 'debris';
  if (name.includes('R/B') || name.includes('ROCKET')) return 'rocket_body';
  if (name.includes('CUBESAT') || name.includes('FLOCK') || name.includes('LEMUR')) return 'cubesat';

  return 'satellite';
}

// ---------------------------------------------------------------------------
// Convert geodetic (lat/lng/alt) to ECI coordinates
// ---------------------------------------------------------------------------

function geodeticToECI(latDeg, lngDeg, altKm, date) {
  const latRad = latDeg * (Math.PI / 180);
  const lngRad = lngDeg * (Math.PI / 180);

  // Use satellite.js for precise GMST
  const gmstRad = satellite.gstime(date);

  // Local sidereal angle
  const theta = gmstRad + lngRad;

  // Distance from Earth center (simplified spherical model)
  const r = EARTH_RADIUS_KM + altKm;

  // ECI coordinates
  const x = r * Math.cos(latRad) * Math.cos(theta);
  const y = r * Math.cos(latRad) * Math.sin(theta);
  const z = r * Math.sin(latRad);

  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Convert ECI to Three.js coordinate system
// Same mapping as orbital.js eciToThreeJs:
//   Three.js X = ECI X / R_earth
//   Three.js Y = ECI Z / R_earth  (up)
//   Three.js Z = ECI Y / R_earth
// ---------------------------------------------------------------------------

function eciToThreeJsLocal(eciPos) {
  const scale = 1.0 / EARTH_RADIUS_KM;
  return {
    x: eciPos.x * scale,
    y: eciPos.z * scale,
    z: eciPos.y * scale,
  };
}

// ---------------------------------------------------------------------------
// Fetch satellites above a single observer point for a single category
// ---------------------------------------------------------------------------

async function fetchAboveObserver(observer, category, timeoutMs) {
  const { lat, lng } = observer;
  const url = `${API_PREFIX}/above/${lat}/${lng}/${OBSERVER_ALT}/${SEARCH_RADIUS}/${category}?`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      return [];
    }

    const json = await response.json();

    if (!json.above || !Array.isArray(json.above)) {
      return [];
    }

    return json.above.map(sat => ({
      satid: sat.satid,
      satname: sat.satname,
      satlat: sat.satlat,
      satlng: sat.satlng,
      satalt: sat.satalt,
    }));
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[n2yo] Timeout for ${observer.label} cat=${category}`);
    } else {
      console.warn(`[n2yo] Fetch failed for ${observer.label} cat=${category}:`, err.message);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main export: fetch all N2YO data, deduplicate, convert coordinates
// ---------------------------------------------------------------------------

/**
 * Fetch satellite positions from all observer points in parallel,
 * using multiple N2YO category IDs for broader coverage.
 * Deduplicates by satid, converts to Three.js coordinates, and categorizes.
 *
 * @param {function} [onProgress] - Optional callback: ({ completed, total, label })
 * @param {number}   [timeoutMs=15000] - Per-request timeout in ms
 * @returns {Promise<Array<{id: number, name: string, category: string,
 *   position: {x:number, y:number, z:number}, altitude: number,
 *   lat: number, lng: number}>>}
 */
export async function fetchN2YOData(onProgress, timeoutMs = 15000) {
  // Handle legacy call signature: fetchN2YOData(timeoutMs)
  if (typeof onProgress === 'number') {
    timeoutMs = onProgress;
    onProgress = null;
  }

  const now = new Date();

  // Build all fetch tasks: each observer × each category
  const tasks = [];
  for (const observer of OBSERVERS) {
    for (const category of N2YO_CATEGORIES) {
      tasks.push({ observer, category });
    }
  }

  const total = tasks.length;
  let completed = 0;

  // Fire all requests in parallel
  const results = await Promise.allSettled(
    tasks.map(async ({ observer, category }) => {
      const sats = await fetchAboveObserver(observer, category, timeoutMs);
      completed++;
      if (onProgress) {
        onProgress({ completed, total, label: observer.label });
      }
      return sats;
    })
  );

  // Collect all satellite records
  const allSats = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allSats.push(...result.value);
    }
  }

  // Deduplicate by satid (first occurrence wins)
  const seen = new Map();
  for (const sat of allSats) {
    if (sat.satid != null && !seen.has(sat.satid)) {
      seen.set(sat.satid, sat);
    }
  }

  // Convert to our internal format with ECI → Three.js coordinate conversion
  const objects = [];
  for (const [satid, sat] of seen) {
    const lat = parseFloat(sat.satlat);
    const lng = parseFloat(sat.satlng);
    const alt = parseFloat(sat.satalt);

    if (isNaN(lat) || isNaN(lng) || isNaN(alt)) continue;
    if (alt < 0 || alt > 100000) continue; // Sanity check altitude

    // Convert geodetic → ECI → Three.js
    const eciPos = geodeticToECI(lat, lng, alt, now);
    const threePos = eciToThreeJsLocal(eciPos);

    const category = categorizeN2YOObject(sat.satname);

    objects.push({
      id: satid,
      name: sat.satname || `SAT-${satid}`,
      category,
      position: threePos,
      altitude: alt,
      lat,
      lng,
    });
  }

  console.log(`[n2yo] Fetched ${objects.length} unique satellites from ${OBSERVERS.length} observers`);
  return objects;
}
