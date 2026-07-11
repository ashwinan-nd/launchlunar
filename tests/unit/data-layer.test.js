import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchN2YOData } from '../../src/n2yo-fetcher.js';
import { fetchTLEData } from '../../src/data-fetcher.js';
import {
  quickHohmannScore,
  calculateTranslunarTrajectory,
} from '../../src/orbital.js';

const SATURN_V = {
  massKg: 2970000,
  thrustN: 35100 * 1000,
  specificImpulseS: 304,
  payload: 45000,
};
const KSC = { lat: 28.5729, lon: -80.649 };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// N2YO: HTTP 200 error bodies must be reported, not parsed as "0 satellites"
// ---------------------------------------------------------------------------

describe('fetchN2YOData error-body detection', () => {
  it('reports quota/key errors delivered as HTTP 200 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ error: 'Invalid API Key!' }),
    })));

    const { objects, failureSummary } = await fetchN2YOData(1000);
    expect(objects).toEqual([]);
    expect(failureSummary).toContain('Invalid API Key!');
  });

  it('reports missing-above bodies with a diagnostic reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ info: { transactionscount: 42 } }),
    })));

    const { objects, failureSummary } = await fetchN2YOData(1000);
    expect(objects).toEqual([]);
    expect(failureSummary).toContain('no "above" array');
  });

  it('parses a healthy above response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        above: [
          { satid: 25544, satname: 'ISS (ZARYA)', satlat: 10, satlng: 20, satalt: 420 },
        ],
      }),
    })));

    const { objects, failureSummary } = await fetchN2YOData(1000);
    expect(failureSummary).toBeNull();
    expect(objects.length).toBe(1);
    expect(objects[0].id).toBe(25544);
    expect(objects[0].category).toBe('iss');
  });
});

// ---------------------------------------------------------------------------
// CelesTrak fetch queue: bounded concurrency + retry + failure reporting
// ---------------------------------------------------------------------------

describe('fetchTLEData queue behavior', () => {
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, text: async () => '[]' };
    }));

    const result = await fetchTLEData({ concurrency: 4, retries: 0, timeoutMs: 5000 });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    // All groups returned empty arrays -> fallback snapshot kicks in
    expect(result.usedFallback).toBe(true);
    expect(result.objects.length).toBeGreaterThan(50);
  });

  it('retries failed groups once and reports persistent failures', async () => {
    const callsPerUrl = new Map();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      callsPerUrl.set(url, (callsPerUrl.get(url) || 0) + 1);
      if (url.includes('GROUP=starlink')) {
        return { ok: false, status: 403, statusText: '' };
      }
      return { ok: true, text: async () => '[]' };
    }));

    const result = await fetchTLEData({ concurrency: 6, retries: 1, timeoutMs: 5000 });
    const starlinkUrl = [...callsPerUrl.keys()].find((u) => u.includes('GROUP=starlink'));
    expect(callsPerUrl.get(starlinkUrl)).toBe(2); // original + 1 retry
    expect(result.failures.some((f) => f.group === 'starlink')).toBe(true);
    expect(result.failures.find((f) => f.group === 'starlink').error).toContain('403');
  }, 20000);
});

// ---------------------------------------------------------------------------
// Coarse analytic filter vs full RK4: ordering must correlate
// ---------------------------------------------------------------------------

describe('quickHohmannScore coarse filter', () => {
  it('analytic TLI dv ordering matches the RK4 result for extreme dates', () => {
    // Perigee vs apogee of the lunar orbit changes dvTli; the coarse filter
    // must rank a near-perigee date cheaper than a near-apogee date, in the
    // same direction as the full integration.
    const dates = [
      new Date('2026-07-12T00:00:00Z'),
      new Date('2026-07-18T00:00:00Z'),
      new Date('2026-07-24T00:00:00Z'),
      new Date('2026-07-30T00:00:00Z'),
      new Date('2026-08-05T00:00:00Z'),
      new Date('2026-08-11T00:00:00Z'),
    ];
    const analytic = dates.map((d) => quickHohmannScore(d, KSC.lat, KSC.lon).dvTli);

    const iMin = analytic.indexOf(Math.min(...analytic));
    const iMax = analytic.indexOf(Math.max(...analytic));
    expect(iMin).not.toBe(iMax);

    const rkMin = calculateTranslunarTrajectory(dates[iMin], KSC.lat, KSC.lon, SATURN_V, true);
    const rkMax = calculateTranslunarTrajectory(dates[iMax], KSC.lat, KSC.lon, SATURN_V, true);

    // Same ordering: the analytically-cheapest date is also cheaper (or equal
    // within 5 m/s) under full integration.
    expect(rkMin.deltaV.tli).toBeLessThanOrEqual(rkMax.deltaV.tli + 0.005);
  });
});
