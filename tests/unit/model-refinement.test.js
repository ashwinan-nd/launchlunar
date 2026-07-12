import { describe, it, expect } from 'vitest';
import {
  calculateTranslunarTrajectory,
  getSunPosition,
  collisionProbability,
  hardBodyRadiusKm,
  assessCola,
  COLA_PC_THRESHOLD,
  AU_KM,
  SECONDS_PER_DAY,
} from '../../src/orbital.js';

const SATURN_V = {
  massKg: 2970000, thrustN: 35100 * 1000, specificImpulseS: 304,
  payload: 45000, heightM: 110.6,
};
const KSC = { lat: 28.5729, lon: -80.649 };

// ---------------------------------------------------------------------------
// Ascent aerodynamic drag (MIT 16.unified ascent ODE)
// ---------------------------------------------------------------------------
describe('ascent drag', () => {
  it('reported LEO ΔV includes integrated gravity + drag losses (9–10 km/s)', () => {
    const r = calculateTranslunarTrajectory(
      new Date('2026-07-20T00:00:00Z'), KSC.lat, KSC.lon, SATURN_V, true);
    // Ideal LEO ~7.4 km/s over surface speed + ~1.5–2 km/s losses.
    expect(r.deltaV.toLeo).toBeGreaterThan(9.0);
    expect(r.deltaV.toLeo).toBeLessThan(10.2);
  });

  it('a draggier (larger frontal-area) vehicle pays a larger LEO ΔV', () => {
    // Frontal area scales with height in the model (radius = height/20), so a
    // taller/wider vehicle presents more area and eats more drag loss.
    const base = new Date('2026-07-20T00:00:00Z');
    const narrow = calculateTranslunarTrajectory(
      base, KSC.lat, KSC.lon, { ...SATURN_V, heightM: 40 }, true);  // radius 2 m
    const wide = calculateTranslunarTrajectory(
      base, KSC.lat, KSC.lon, { ...SATURN_V, heightM: 200 }, true); // radius 10 m
    expect(wide.deltaV.toLeo).toBeGreaterThan(narrow.deltaV.toLeo);
  });
});

// ---------------------------------------------------------------------------
// Solar ephemeris + perturbation
// ---------------------------------------------------------------------------
describe('solar ephemeris', () => {
  it('Sun sits ~1 AU from Earth (0.98–1.02 AU across the year)', () => {
    for (const iso of ['2026-01-03T00:00:00Z', '2026-07-04T00:00:00Z']) {
      const s = getSunPosition(new Date(iso));
      const au = Math.hypot(s.x, s.y, s.z) / AU_KM;
      expect(au).toBeGreaterThan(0.98);
      expect(au).toBeLessThan(1.02);
    }
  });

  it('perihelion (Jan) is nearer than aphelion (Jul)', () => {
    const jan = getSunPosition(new Date('2026-01-03T00:00:00Z'));
    const jul = getSunPosition(new Date('2026-07-04T00:00:00Z'));
    const dJan = Math.hypot(jan.x, jan.y, jan.z);
    const dJul = Math.hypot(jul.x, jul.y, jul.z);
    expect(dJan).toBeLessThan(dJul);
  });

  it('capture still holds with the solar third-body term active', () => {
    const r = calculateTranslunarTrajectory(
      new Date('2026-07-20T00:00:00Z'), KSC.lat, KSC.lon, SATURN_V, true);
    expect(r.transferResult).toBe('capture');
  });
});

// ---------------------------------------------------------------------------
// COLA collision probability + blackout
// ---------------------------------------------------------------------------
describe('COLA collision probability', () => {
  it('Pc decreases monotonically with miss distance', () => {
    const hbr = hardBodyRadiusKm('LARGE');
    let prev = Infinity;
    for (const d of [0.1, 0.5, 1, 2, 5, 10]) {
      const pc = collisionProbability(d, hbr);
      expect(pc).toBeLessThanOrEqual(prev);
      prev = pc;
    }
  });

  it('a sub-km pass of a large object exceeds the blackout threshold', () => {
    const pc = collisionProbability(0.4, hardBodyRadiusKm('LARGE'));
    expect(pc).toBeGreaterThan(COLA_PC_THRESHOLD);
  });

  it('a multi-km miss is far below the threshold', () => {
    const pc = collisionProbability(5, hardBodyRadiusKm('LARGE'));
    expect(pc).toBeLessThan(COLA_PC_THRESHOLD);
  });

  it('larger hard-body radius raises Pc at equal miss distance', () => {
    const d = 0.5;
    expect(collisionProbability(d, hardBodyRadiusKm('LARGE')))
      .toBeGreaterThan(collisionProbability(d, hardBodyRadiusKm('SMALL')));
  });

  it('assessCola blocks a window with a close large-object conjunction', () => {
    const cola = assessCola([
      { distanceKm: 0.3, rcs: 'LARGE' },
      { distanceKm: 120, rcs: 'SMALL' },
    ]);
    expect(cola.blocked).toBe(true);
    expect(cola.maxPc).toBeGreaterThan(COLA_PC_THRESHOLD);
    expect(cola.worstMissKm).toBeCloseTo(0.3, 6);
    expect(cola.screenedCount).toBe(2);
  });

  it('assessCola clears a window with only distant approaches', () => {
    const cola = assessCola([
      { distanceKm: 40, rcs: 'LARGE' },
      { distanceKm: 200, rcs: 'MEDIUM' },
    ]);
    expect(cola.blocked).toBe(false);
    expect(cola.maxPc).toBeLessThan(COLA_PC_THRESHOLD);
  });

  it('an empty screen is unblocked with zero probability', () => {
    const cola = assessCola([]);
    expect(cola.blocked).toBe(false);
    expect(cola.maxPc).toBe(0);
    expect(cola.screenedCount).toBe(0);
  });
});
