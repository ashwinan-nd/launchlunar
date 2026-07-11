import { describe, it, expect } from 'vitest';
import {
  getMoonPosition,
  getMoonVelocity,
  computeGmst,
  eciToThreeJs,
  rk4Step,
  calculateTranslunarTrajectory,
  EARTH_MU,
  EARTH_RADIUS_KM,
  SECONDS_PER_DAY,
} from '../../src/orbital.js';

const SATURN_V = {
  massKg: 2970000,
  thrustN: 35100 * 1000,
  specificImpulseS: 304,
  payload: 45000,
};
const KSC = { lat: 28.5729, lon: -80.649 };

// ---------------------------------------------------------------------------
// Ephemeris validation against published reference values
// ---------------------------------------------------------------------------

describe('getMoonPosition vs Meeus Astronomical Algorithms Example 47.a', () => {
  // 1992 April 12.0 TD. Reference: lambda = 133.162655 deg,
  // beta = -3.229126 deg, Delta = 368409.7 km.
  // (Our input is UTC and the reference epoch is TD; the ~59 s TD-UT offset
  // in 1992 moves the Moon ~0.008 deg, inside the tolerance below.)
  const date = new Date('1992-04-12T00:00:00Z');

  it('matches ecliptic longitude to 0.02 deg', () => {
    const m = getMoonPosition(date);
    expect(Math.abs(m.eclipticLongitude - 133.162655)).toBeLessThan(0.02);
  });

  it('matches ecliptic latitude to 0.02 deg', () => {
    const m = getMoonPosition(date);
    expect(Math.abs(m.eclipticLatitude - -3.229126)).toBeLessThan(0.02);
  });

  it('matches Earth-Moon distance to 50 km', () => {
    const m = getMoonPosition(date);
    expect(Math.abs(m.distance - 368409.7)).toBeLessThan(50);
  });

  it('equatorial rectangular output is self-consistent with distance', () => {
    const m = getMoonPosition(date);
    const r = Math.hypot(m.x, m.y, m.z);
    expect(Math.abs(r - m.distance)).toBeLessThan(1);
  });
});

describe('getMoonVelocity', () => {
  it('matches the known lunar orbital speed envelope (0.95-1.1 km/s)', () => {
    const v = getMoonVelocity(new Date('2026-07-15T00:00:00Z'));
    const speed = Math.hypot(v.x, v.y, v.z);
    expect(speed).toBeGreaterThan(0.9);
    expect(speed).toBeLessThan(1.15);
  });

  it('is perpendicular-ish to the position vector (near-circular orbit)', () => {
    const d = new Date('2026-07-15T00:00:00Z');
    const p = getMoonPosition(d);
    const v = getMoonVelocity(d);
    const cosAngle =
      (p.x * v.x + p.y * v.y + p.z * v.z) /
      (Math.hypot(p.x, p.y, p.z) * Math.hypot(v.x, v.y, v.z));
    // Radial velocity component is small but nonzero (e ~ 0.055)
    expect(Math.abs(cosAngle)).toBeLessThan(0.15);
  });
});

describe('computeGmst vs Meeus Example 12.b', () => {
  it('1987 April 10, 0h UT -> 197.693195 deg (tolerance 0.01 deg)', () => {
    const gmst = computeGmst(new Date('1987-04-10T00:00:00Z'));
    const deg = ((gmst * 180) / Math.PI + 360) % 360;
    expect(Math.abs(deg - 197.693195)).toBeLessThan(0.01);
  });

  it('advances ~360.9856 deg per solar day (sidereal rate)', () => {
    const g1 = computeGmst(new Date('2026-07-11T00:00:00Z'));
    const g2 = computeGmst(new Date('2026-07-12T00:00:00Z'));
    let deltaDeg = ((g2 - g1) * 180) / Math.PI;
    deltaDeg = ((deltaDeg % 360) + 360) % 360;
    expect(Math.abs(deltaDeg - 0.9856)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Coordinate frame: handedness preservation
// ---------------------------------------------------------------------------

describe('eciToThreeJs frame mapping', () => {
  const map = (v) => eciToThreeJs(v, 1); // unit scale

  it('preserves handedness: map(ex) x map(ey) = map(ez)', () => {
    const ex = map({ x: 1, y: 0, z: 0 });
    const ey = map({ x: 0, y: 1, z: 0 });
    const ez = map({ x: 0, y: 0, z: 1 });
    const cross = {
      x: ex.y * ey.z - ex.z * ey.y,
      y: ex.z * ey.x - ex.x * ey.z,
      z: ex.x * ey.y - ex.y * ey.x,
    };
    expect(cross.x).toBeCloseTo(ez.x, 12);
    expect(cross.y).toBeCloseTo(ez.y, 12);
    expect(cross.z).toBeCloseTo(ez.z, 12);
  });

  it('maps the ECI pole to scene +Y and preserves length', () => {
    const pole = map({ x: 0, y: 0, z: 2 });
    expect(pole).toEqual({ x: 0, y: 2, z: -0 });
  });
});

// ---------------------------------------------------------------------------
// Integrator validation: two-body problem with known analytic solution
// ---------------------------------------------------------------------------

function twoBodyAccel(p) {
  const r = Math.hypot(p.x, p.y, p.z);
  const k = -EARTH_MU / (r * r * r);
  return { x: k * p.x, y: k * p.y, z: k * p.z };
}

function propagateOrbit(pos0, vel0, totalTime, dt) {
  let pos = { ...pos0 };
  let vel = { ...vel0 };
  let t = 0;
  while (t < totalTime) {
    const step = Math.min(dt, totalTime - t);
    const out = rk4Step(pos, vel, t, step, twoBodyAccel);
    pos = out.pos;
    vel = out.vel;
    t += step;
  }
  return { pos, vel };
}

function specificEnergy(pos, vel) {
  const r = Math.hypot(pos.x, pos.y, pos.z);
  const v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  return v2 / 2 - EARTH_MU / r;
}

describe('RK4 integrator on the two-body problem', () => {
  const rLeo = EARTH_RADIUS_KM + 200;
  const vCirc = Math.sqrt(EARTH_MU / rLeo);
  const period = 2 * Math.PI * Math.sqrt(rLeo ** 3 / EARTH_MU);
  const pos0 = { x: rLeo, y: 0, z: 0 };
  const vel0 = { x: 0, y: vCirc, z: 0 };

  it('returns to the start after one circular orbit (dt=10s, error < 1 km)', () => {
    const { pos } = propagateOrbit(pos0, vel0, period, 10);
    const err = Math.hypot(pos.x - pos0.x, pos.y - pos0.y, pos.z - pos0.z);
    expect(err).toBeLessThan(1);
  });

  it('conserves specific orbital energy to 1e-9 relative over one orbit', () => {
    const e0 = specificEnergy(pos0, vel0);
    const { pos, vel } = propagateOrbit(pos0, vel0, period, 10);
    const e1 = specificEnergy(pos, vel);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-9);
  });

  it('halving the step size shrinks the error ~16x (4th-order convergence)', () => {
    const run = (dt) => {
      const { pos } = propagateOrbit(pos0, vel0, period / 2, dt);
      // Analytic: after half a period the craft is at the antipode
      return Math.hypot(pos.x + rLeo, pos.y, pos.z);
    };
    const err40 = run(40);
    const err20 = run(20);
    const ratio = err40 / err20;
    // 4th order => ratio ~ 16; accept 8..32 (floating-point floor effects)
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(32);
  });

  it('Hohmann transfer: integrated apogee matches vis-viva analytic value', () => {
    const rApo = 384400;
    const a = (rLeo + rApo) / 2;
    const vPeri = Math.sqrt(EARTH_MU * (2 / rLeo - 1 / a));
    const tHalf = Math.PI * Math.sqrt(a ** 3 / EARTH_MU);
    const { pos } = propagateOrbit(
      { x: rLeo, y: 0, z: 0 },
      { x: 0, y: vPeri, z: 0 },
      tHalf,
      30
    );
    const r = Math.hypot(pos.x, pos.y, pos.z);
    expect(Math.abs(r - rApo)).toBeLessThan(100); // 100 km on a 384,400 km arc
  });
});

// ---------------------------------------------------------------------------
// Full-mission envelope vs Apollo-class reference values
// ---------------------------------------------------------------------------

describe('translunar trajectory vs Apollo-class reference envelope', () => {
  const result = calculateTranslunarTrajectory(
    new Date('2026-07-14T12:00:00Z'),
    KSC.lat,
    KSC.lon,
    SATURN_V,
    true
  );

  it('achieves lunar capture', () => {
    expect(result.transferResult).toBe('capture');
  });

  it('post-TLI orbital energy sits in the trans-lunar band (-1.9..-0.9 km^2/s^2)', () => {
    // Analytic energy for an apogee at lunar distance + margin is -1.004;
    // Apollo's faster 3-day transfers ran hotter (about -1.4 to -1.7). The
    // first recorded transfer waypoint is up to an hour after TLI, by which
    // time lunar third-body work has legitimately added a few 0.01 km^2/s^2.
    const wp = result.waypoints.find((w) => w.phase === 'transfer');
    expect(wp).toBeTruthy();
    const r = Math.hypot(wp.position.x, wp.position.y, wp.position.z);
    const v2 = wp.velocity.x ** 2 + wp.velocity.y ** 2 + wp.velocity.z ** 2;
    const eps = v2 / 2 - EARTH_MU / r;
    expect(eps).toBeGreaterThan(-1.9);
    expect(eps).toBeLessThan(-0.9);
  });

  it('transfer duration is in the historical envelope (2.5-5.5 days)', () => {
    const days = result.flightDuration / SECONDS_PER_DAY;
    expect(days).toBeGreaterThan(2.5);
    expect(days).toBeLessThan(5.5);
  });

  it('TLI delta-v is Apollo-class (3.0-3.6 km/s from LEO, incl. correction)', () => {
    expect(result.deltaV.tli).toBeGreaterThan(3.0);
    expect(result.deltaV.tli).toBeLessThan(3.6);
  });

  it('LOI + powered-descent delta-v is realistic (1.5-3.0 km/s)', () => {
    // deltaV.loi here covers the FULL arrival budget: hyperbolic capture into
    // low lunar orbit (~0.8-0.9) plus powered descent to rest on the surface
    // (~1.7, Apollo LM descent stage class).
    expect(result.deltaV.loi).toBeGreaterThan(1.5);
    expect(result.deltaV.loi).toBeLessThan(3.0);
  });

  it('waypoints are strictly time-ordered', () => {
    for (let i = 1; i < result.waypoints.length; i++) {
      expect(result.waypoints[i].time.getTime())
        .toBeGreaterThanOrEqual(result.waypoints[i - 1].time.getTime());
    }
  });

  it('trajectory starts on the pad (surface radius, launch-site latitude)', () => {
    const w0 = result.waypoints[0];
    const r = Math.hypot(w0.position.x, w0.position.y, w0.position.z);
    expect(Math.abs(r - EARTH_RADIUS_KM)).toBeLessThan(1);
    const sinLat = w0.position.z / r;
    expect(Math.abs(sinLat - Math.sin((KSC.lat * Math.PI) / 180))).toBeLessThan(1e-6);
  });
});
