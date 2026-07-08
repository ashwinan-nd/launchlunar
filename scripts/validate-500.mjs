// scripts/validate-500.mjs — 500-simulation validation harness.
//
// Proves the RENDER-side fixes did not touch the physics, and quantifies transfer
// feasibility. For each seeded simulation it asserts:
//   * start on Earth surface (|waypoints[0]| ≈ EARTH_RADIUS_KM)
//   * feasibility (transferResult==='capture' OR closestMoonApproach < SOI)
//   * for feasible: final waypoint on the lunar surface at the ARRIVAL-time Moon
//     position (|finalPos - moonCenter(finalTime)| ≈ MOON_RADIUS_KM) — this proves
//     there is NO straight-line gap and the Moon is genuinely in position.
//   * landing near the requested target lat/lon (when a target is specified)
//   * monotonic waypoint time, and no NaN/Inf anywhere.
//
// Run: node scripts/validate-500.mjs   (exit 0 = arrival-on-surface pass rate ok)

import {
  calculateTranslunarTrajectory,
  getMoonPosition,
  eciToThreeJs,
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
} from '../src/orbital.js';

// ─── Deterministic seeded RNG (mulberry32) ──────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Test-input spread ───────────────────────────────────────────────────────────
const N = 500;
const SOI_KM = 66100;                 // lunar sphere-of-influence radius
const START_TOL_KM = 1.0;             // start-on-surface tolerance
const ARRIVAL_TOL_KM = 15.0;          // arrival-on-surface tolerance (10s Moon cache ≈ ±10 km)
const LANDING_TOL_DEG = 1.0;          // landing lat/lon tolerance

// Multi-month launch-date spread.
const DATE_START = Date.UTC(2026, 0, 1);   // 2026-01-01
const DATE_END = Date.UTC(2026, 6, 1);     // 2026-07-01
const DATE_SPAN_MS = DATE_END - DATE_START;

// Real launch sites (subset).
const REAL_SITES = [
  { lat: 28.5729, lon: -80.6490 },  // Kennedy Space Center
  { lat: 45.9650, lon: 63.3050 },   // Baikonur
  { lat: 40.9606, lon: 100.2914 },  // Jiuquan
  { lat: 5.2360, lon: -52.7686 },   // Guiana (Kourou)
  { lat: 30.4000, lon: 131.0000 },  // Tanegashima
  { lat: 13.7199, lon: 80.2304 },   // Satish Dhawan
];

// A few selenographic target coordinates (plus null = automatic).
const MOON_TARGETS = [
  null,
  { lat: 0.67, lon: 23.47 },    // Apollo 11 — Mare Tranquillitatis
  { lat: -3.01, lon: -23.42 },  // Apollo 12 — Oceanus Procellarum
  { lat: -8.97, lon: 15.50 },   // Apollo 16 — Descartes
  { lat: 26.13, lon: 3.63 },    // near Mare Imbrium / Apollo 15 region
];

const ROCKET = { massKg: 500000, thrustN: 7600000, specificImpulseS: 311, payload: 50000 };

function isFin05(v) { return typeof v === 'number' && Number.isFinite(v); }
function mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

// ─── Run ────────────────────────────────────────────────────────────────────────
let feasibleCount = 0;
let startPass = 0, startTotal = 0;
let arrivalPass = 0, arrivalTotal = 0;     // arrivalTotal = feasible sims
let landingPass = 0, landingTotal = 0;     // landingTotal = feasible sims with a target
let monotonicPass = 0, finitePass = 0;

let arrivalResidualSum = 0, arrivalResidualMax = 0;
const failures = [];

for (let i = 0; i < N; i++) {
  const rng = mulberry32(0x1000 + i * 2654435761);
  const seed = i;

  // Launch date.
  const launchDate = new Date(DATE_START + Math.floor(rng() * DATE_SPAN_MS));

  // Launch site: half from real sites, half random.
  let lat, lon;
  if (rng() < 0.5) {
    const s = REAL_SITES[Math.floor(rng() * REAL_SITES.length)];
    lat = s.lat; lon = s.lon;
  } else {
    lat = (rng() * 120) - 60;     // [-60, 60]
    lon = (rng() * 360) - 180;    // [-180, 180]
  }

  // Moon target.
  const moonTarget = MOON_TARGETS[Math.floor(rng() * MOON_TARGETS.length)];

  let traj;
  try {
    traj = calculateTranslunarTrajectory(launchDate, lat, lon, ROCKET, false, moonTarget);
  } catch (e) {
    failures.push({ seed, reason: `threw: ${e.message}` });
    continue;
  }

  const wps = traj.waypoints;
  if (!wps || wps.length < 2) {
    failures.push({ seed, reason: 'fewer than 2 waypoints' });
    continue;
  }

  // ── finite + monotonic ──
  let finite = true, monotonic = true;
  let prevT = -Infinity;
  for (const wp of wps) {
    const p = wp.position, v = wp.velocity || { x: 0, y: 0, z: 0 };
    if (!isFin05(p.x) || !isFin05(p.y) || !isFin05(p.z) ||
        !isFin05(v.x) || !isFin05(v.y) || !isFin05(v.z)) { finite = false; break; }
    const t = wp.time.getTime();
    if (t < prevT - 1) { monotonic = false; }
    prevT = t;
  }
  if (finite) finitePass++;
  if (monotonic) monotonicPass++;
  if (!finite) failures.push({ seed, reason: 'NaN/Inf in a waypoint' });
  else if (!monotonic) failures.push({ seed, reason: 'non-monotonic waypoint time' });

  // ── start on surface ──
  startTotal++;
  const startMag = mag(wps[0].position);
  const startOk = Math.abs(startMag - EARTH_RADIUS_KM) <= START_TOL_KM;
  if (startOk) startPass++;
  else if (finite) failures.push({ seed, reason: `start off-surface: |r0|=${startMag.toFixed(3)} km` });

  // ── feasibility ──
  const feasible = traj.transferResult === 'capture' ||
                   (isFin05(traj.closestMoonApproach) && traj.closestMoonApproach < SOI_KM);
  if (feasible) feasibleCount++;

  // ── arrival on surface (feasible only) ──
  if (feasible && finite) {
    arrivalTotal++;
    const finalWp = wps[wps.length - 1];
    const moonCenter = getMoonPosition(finalWp.time); // independent recompute at arrival time
    const d = mag({
      x: finalWp.position.x - moonCenter.x,
      y: finalWp.position.y - moonCenter.y,
      z: finalWp.position.z - moonCenter.z,
    });
    const residual = Math.abs(d - MOON_RADIUS_KM);
    arrivalResidualSum += residual;
    if (residual > arrivalResidualMax) arrivalResidualMax = residual;
    if (residual <= ARRIVAL_TOL_KM) arrivalPass++;
    else failures.push({ seed, reason: `arrival off-surface: |final-moon|=${d.toFixed(1)} km (residual ${residual.toFixed(1)} km)` });

    // ── landing accuracy (feasible + explicit target) ──
    if (moonTarget) {
      landingTotal++;
      // Recover selenographic lat/lon from the surface offset, matching the physics'
      // ECI offset convention (y negated).
      const off = {
        x: finalWp.position.x - moonCenter.x,
        y: finalWp.position.y - moonCenter.y,
        z: finalWp.position.z - moonCenter.z,
      };
      const r = mag(off);
      const gotLat = Math.asin(Math.max(-1, Math.min(1, off.z / r))) * 180 / Math.PI;
      const gotLon = Math.atan2(-off.y, off.x) * 180 / Math.PI;
      let dLon = Math.abs(gotLon - moonTarget.lon) % 360;
      if (dLon > 180) dLon = 360 - dLon;
      const dLat = Math.abs(gotLat - moonTarget.lat);
      if (dLat <= LANDING_TOL_DEG && dLon <= LANDING_TOL_DEG) landingPass++;
      else failures.push({ seed, reason: `landing off-target: got (${gotLat.toFixed(2)}, ${gotLon.toFixed(2)}) want (${moonTarget.lat}, ${moonTarget.lon})` });
    }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────────
const pct = (n, d) => d === 0 ? 'n/a  ' : `${(100 * n / d).toFixed(1)}%`;

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  500-SIMULATION VALIDATION  (Earth→Moon translunar transfer)`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  total simulations .................. ${N}`);
console.log(`  feasible transfers ................. ${feasibleCount}/${N}  (${pct(feasibleCount, N)})`);
console.log('  ---------------------------------------------------------------');
console.log(`  start-on-surface pass ............. ${startPass}/${startTotal}  (${pct(startPass, startTotal)})`);
console.log(`  arrival-on-surface pass (feasible)  ${arrivalPass}/${arrivalTotal}  (${pct(arrivalPass, arrivalTotal)})`);
console.log(`  landing-accuracy pass (targeted) .. ${landingPass}/${landingTotal}  (${pct(landingPass, landingTotal)})`);
console.log(`  monotonic-time pass ............... ${monotonicPass}/${N}  (${pct(monotonicPass, N)})`);
console.log(`  finite (no NaN/Inf) pass .......... ${finitePass}/${N}  (${pct(finitePass, N)})`);
console.log('  ---------------------------------------------------------------');
console.log(`  arrival residual mean/max ......... ${arrivalTotal ? (arrivalResidualSum / arrivalTotal).toFixed(2) : 'n/a'} / ${arrivalResidualMax.toFixed(2)} km`);
console.log('═══════════════════════════════════════════════════════════════');

if (failures.length) {
  console.log(`\n  ${failures.length} failing check(s). First 10:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`    seed ${f.seed}: ${f.reason}`);
  }
} else {
  console.log('\n  No failing checks.');
}
console.log('');

// Exit non-zero only if a physics-integrity invariant regressed. Feasibility fraction
// is expected to be moderate (not every random date has a good window) and is NOT a
// pass/fail gate.
const arrivalRate = arrivalTotal ? arrivalPass / arrivalTotal : 0;
const startRate = startTotal ? startPass / startTotal : 0;
const ok = startRate >= 0.99 &&
           finitePass === N &&
           monotonicPass === N &&
           (arrivalTotal === 0 || arrivalRate >= 0.95);
process.exit(ok ? 0 : 1);
