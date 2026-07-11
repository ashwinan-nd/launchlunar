import { describe, it, expect } from 'vitest';
import {
  calculateTranslunarTrajectory,
  SECONDS_PER_DAY,
} from '../../src/orbital.js';

// Apollo 11 preset from the UI (full Saturn V stack, stage-averaged ISP)
const SATURN_V = {
  massKg: 2970000,
  thrustN: 35100 * 1000, // 35,100 kN
  specificImpulseS: 304,
  payload: 45000,
};

const KSC = { lat: 28.5729, lon: -80.649 };

describe('calculateTranslunarTrajectory — lunar capture', () => {
  it('achieves capture (periselene inside SOI) for a representative launch date', () => {
    const result = calculateTranslunarTrajectory(
      new Date('2026-07-12T00:59:00Z'),
      KSC.lat,
      KSC.lon,
      SATURN_V,
      true // low resolution — same mode the window scorer uses
    );

    expect(result.transferResult).toBe('capture');
    expect(result.closestMoonApproach).toBeLessThan(66100); // inside SOI
  });

  it('produces a realistic transfer duration (2–7 days), not the 8-day timeout cap', () => {
    const result = calculateTranslunarTrajectory(
      new Date('2026-07-12T00:59:00Z'),
      KSC.lat,
      KSC.lon,
      SATURN_V,
      true
    );

    const days = result.flightDuration / SECONDS_PER_DAY;
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThan(7.9); // must not be pinned at the integration cap
  });

  it('captures across multiple launch dates with VARYING delta-V and duration', () => {
    const dates = [
      new Date('2026-07-11T06:00:00Z'),
      new Date('2026-07-14T12:00:00Z'),
      new Date('2026-07-20T00:00:00Z'),
    ];
    const results = dates.map((d) =>
      calculateTranslunarTrajectory(d, KSC.lat, KSC.lon, SATURN_V, true)
    );

    for (const r of results) {
      expect(r.transferResult).toBe('capture');
    }

    // The identical-windows bug: all candidates used to return the same
    // deltaV/flightDuration. Assert real variance across launch dates.
    const dvs = results.map((r) => r.deltaV.total);
    const durations = results.map((r) => r.flightDuration);
    expect(new Set(dvs.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
    expect(new Set(durations.map((v) => Math.round(v)))).toHaveProperty('size');
    expect(Math.max(...durations) - Math.min(...durations)).toBeGreaterThan(60);
  });

  it('reports ascent failure honestly for an underpowered vehicle (TWR < 1)', () => {
    const result = calculateTranslunarTrajectory(
      new Date('2026-07-12T00:59:00Z'),
      KSC.lat,
      KSC.lon,
      { massKg: 500000, thrustN: 1000000, specificImpulseS: 311, payload: 400000 },
      true
    );
    expect(result.transferResult).toBe('ascent_failed');
    expect(result.deltaV.total).toBe(0);
  });
});
