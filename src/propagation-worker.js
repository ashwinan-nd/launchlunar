// propagation-worker.js
// -----------------------------------------------------------------------------
// Off-main-thread SGP4 propagation of the full real catalog. Builds a satrec for
// every catalog object from its real TLE lines, then propagates all objects on a
// fixed tick and posts back a Float32Array of Three.js-frame positions (index i =
// catalog index i). The main thread scatters these into per-category geometries.
// -----------------------------------------------------------------------------

import * as satellite from 'satellite.js';

const EARTH_RADIUS_KM = 6371;

// Keep in exact sync with orbital.js eciToThreeJs (right-handed rotation).
function eciToThree(p, out, o) {
  const s = 1.0 / EARTH_RADIUS_KM;
  out[o] = p.x * s;
  out[o + 1] = p.z * s;
  out[o + 2] = -p.y * s;
}

let satrecs = [];      // parallel to catalog order; null for un-parseable
let count = 0;
let timeScale = 1;     // simulated seconds per real second
let simStartMs = 0;    // sim clock anchor (ms)
let realStartMs = 0;   // wall clock anchor (ms)
let tickHandle = null;
const TICK_MS = 250;   // 4 Hz propagation

function simNow() {
  return new Date(simStartMs + (Date.now() - realStartMs) * timeScale);
}

function tick() {
  if (count === 0) return;
  const now = simNow();
  const buf = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const sr = satrecs[i];
    if (!sr) { buf[i * 3] = 1e6; continue; } // park invalid far away
    try {
      const pv = satellite.propagate(sr, now);
      if (pv && pv.position) eciToThree(pv.position, buf, i * 3);
      else buf[i * 3] = 1e6;
    } catch {
      buf[i * 3] = 1e6;
    }
  }
  postMessage({ type: 'positions', buf }, [buf.buffer]);
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const catalog = msg.catalog;
    count = catalog.length;
    timeScale = msg.timeScale || 1;
    simStartMs = msg.simStartMs || Date.now();
    realStartMs = Date.now();
    satrecs = new Array(count);
    let ok = 0;
    for (let i = 0; i < count; i++) {
      try {
        const sr = satellite.twoline2satrec(catalog[i].l1, catalog[i].l2);
        if (sr && !sr.error) { satrecs[i] = sr; ok++; }
        else satrecs[i] = null;
      } catch {
        satrecs[i] = null;
      }
    }
    postMessage({ type: 'ready', total: count, ok });
    tick(); // immediate first frame
    tickHandle = setInterval(tick, TICK_MS);
  } else if (msg.type === 'setTimeScale') {
    // Re-anchor so the sim clock is continuous across a rate change.
    simStartMs = simNow().getTime();
    realStartMs = Date.now();
    timeScale = msg.timeScale;
  } else if (msg.type === 'stop') {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }
};
