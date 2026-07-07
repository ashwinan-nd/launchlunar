// scripts/test-physics.mjs — lightweight physics + data sanity tests.
// Run: node scripts/test-physics.mjs   (exit 0 = pass)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as satellite from 'satellite.js';
import {
  calculateTranslunarTrajectory, verifyTrajectory, findOptimalLaunchWindows,
  monteCarloSuccess, eciToThreeJs, EARTH_MU, EARTH_RADIUS_KM,
} from '../src/orbital.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('Physics sanity:');
// 1. LEO circular velocity at 200 km.
const vLeo = Math.sqrt(EARTH_MU / (EARTH_RADIUS_KM + 200));
check('LEO circular velocity ≈ 7.79 km/s', Math.abs(vLeo - 7.79) < 0.05, vLeo.toFixed(3));

// 2. ECI→Three mapping is a right-handed rotation (preserves orientation).
const e1 = eciToThreeJs({ x: EARTH_RADIUS_KM, y: 0, z: 0 });
const e2 = eciToThreeJs({ x: 0, y: EARTH_RADIUS_KM, z: 0 });
const e3 = eciToThreeJs({ x: 0, y: 0, z: EARTH_RADIUS_KM });
const det =
  e1.x * (e2.y * e3.z - e2.z * e3.y) -
  e1.y * (e2.x * e3.z - e2.z * e3.x) +
  e1.z * (e2.x * e3.y - e2.y * e3.x);
check('eciToThreeJs is right-handed (det ≈ +1)', Math.abs(det - 1) < 1e-6, `det=${det.toFixed(3)}`);

// 3. Full trajectory to the Moon for a searched Apollo-11-style window.
console.log('Trajectory:');
const rp = { massKg: 50000, thrustN: 1e6, specificImpulseS: 421, payload: 28800 };
const windows = await findOptimalLaunchWindows(
  { lat: 28.5729, lon: -80.649, name: 'KSC' },
  new Date('2026-07-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z'),
  rp, [], 3, null, { lat: 0.67, lon: 23.47 });
check('search returns ≥1 window', windows.length >= 1, `${windows.length}`);
const w = windows[0];
const v = verifyTrajectory(w.trajectory);
check('trajectory starts on Earth surface', v.startsOnEarth, `alt=${v.startAltKm.toFixed(1)} km`);
check('trajectory ends on Moon surface', v.endsOnMoon, `endDist=${v.endDistFromMoonKm.toFixed(0)} km`);
check('flight time 2.5–6 days', v.flightDays >= 2.5 && v.flightDays <= 6, `${v.flightDays.toFixed(2)} d`);
check('total ΔV 12–20 km/s (Earth→lunar surface)', v.deltaVTotal > 12 && v.deltaVTotal < 20, `${v.deltaVTotal.toFixed(1)} km/s`);
check('closest Moon approach < SOI (66,100 km)', w.trajectory.closestMoonApproach < 66100, `${w.trajectory.closestMoonApproach.toFixed(0)} km`);
check('P(success) computed in [0,1]', w.pSuccess >= 0 && w.pSuccess <= 1, `${(w.pSuccess * 100).toFixed(1)}%`);
check('best window P(success) ≥ 90%', w.pSuccess >= 0.9, `${(w.pSuccess * 100).toFixed(1)}%`);

// 4. Monte-Carlo determinism sanity (returns a probability).
const mc = monteCarloSuccess(w.trajectory.tliState, w.launchDate, 20);
check('Monte-Carlo returns a probability', mc >= 0 && mc <= 1, `${(mc * 100).toFixed(1)}%`);

// 5. Catalog parses and SGP4 propagates for ≥95% of objects.
console.log('Catalog / SGP4:');
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/catalog.json'), 'utf8'));
check('catalog has ≥ 30,000 objects', cat.length >= 30000, `${cat.length}`);
const now = new Date();
let ok = 0, n = Math.min(cat.length, 5000);
for (let i = 0; i < n; i++) {
  try {
    const sr = satellite.twoline2satrec(cat[i].l1, cat[i].l2);
    if (sr && !sr.error) { const pv = satellite.propagate(sr, now); if (pv && pv.position) ok++; }
  } catch (e) { /* count as fail */ }
}
check('SGP4 success ≥ 95% (sample of 5000)', ok / n >= 0.95, `${(ok / n * 100).toFixed(1)}%`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
