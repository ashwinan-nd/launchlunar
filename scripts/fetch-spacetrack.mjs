#!/usr/bin/env node
// scripts/fetch-spacetrack.mjs
// -----------------------------------------------------------------------------
// Build the real orbital catalog for LaunchLunar from Space-Track.
//
// Source of truth: Space-Track GP class (SGP4 mean elements + real TLE lines) and
// cdm_public (real Conjunction Data Messages). Credentials come from env/CLI, never
// committed. If a fresh cache already exists under .cache-spacetrack/ we reuse it so
// the pipeline can run fully offline.
//
// Outputs:
//   public/data/catalog.json      — [{id,name,cat,rcs,intl,epoch,l1,l2}]  (all on-orbit objects)
//   public/data/conjunctions.json — [{id,tca,minRng,pc,a:{...},b:{...}}]  (upcoming conjunctions)
//
// Usage:
//   node scripts/fetch-spacetrack.mjs            # reuse cache if present, else fetch
//   node scripts/fetch-spacetrack.mjs --refresh  # force re-fetch from Space-Track
//   ST_USER=... ST_PASS=... node scripts/fetch-spacetrack.mjs --refresh
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache-spacetrack');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const GP_CACHE = path.join(CACHE_DIR, 'gp_all.json');
const CDM_CACHE = path.join(CACHE_DIR, 'cdm_all.json');
const CDM_SAMPLE = path.join(CACHE_DIR, 'cdm_sample.json');

const ST_BASE = 'https://www.space-track.org';
const REFRESH = process.argv.includes('--refresh');

// ---- credentials (env or .env.local) --------------------------------------
function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const envLocal = loadEnvLocal();
const ST_USER = process.env.ST_USER || envLocal.ST_USER;
const ST_PASS = process.env.ST_PASS || envLocal.ST_PASS;

// ---- Space-Track auth + query ---------------------------------------------
async function spaceTrackLogin() {
  if (!ST_USER || !ST_PASS) throw new Error('ST_USER / ST_PASS not set (env or .env.local)');
  const body = new URLSearchParams({ identity: ST_USER, password: ST_PASS });
  const resp = await fetch(`${ST_BASE}/ajaxauth/login`, { method: 'POST', body });
  if (!resp.ok) throw new Error(`Space-Track login failed: ${resp.status}`);
  const cookie = resp.headers.get('set-cookie');
  if (!cookie) throw new Error('Space-Track login returned no cookie');
  return cookie.split(';')[0];
}

async function spaceTrackQuery(cookie, query) {
  const resp = await fetch(`${ST_BASE}/basicspacedata/query/${query}`, {
    headers: { Cookie: cookie },
  });
  if (!resp.ok) throw new Error(`Space-Track query failed: ${resp.status} ${query}`);
  return resp.json();
}

// ---- categorization (single source of truth, mirrors data-fetcher) --------
export function categorize(rec) {
  const id = Number(rec.NORAD_CAT_ID);
  const name = (rec.OBJECT_NAME || '').toUpperCase();
  const type = (rec.OBJECT_TYPE || '').toUpperCase();

  if (id === 25544) return 'iss';
  if (type === 'ROCKET BODY' || name.includes('R/B')) return 'rocket_body';
  if (type === 'DEBRIS' || name.includes(' DEB') || name.includes('DEBRIS') ||
      name.includes('COOLANT') || name.includes('WESTFORD NEEDLES')) return 'debris';
  if (name.includes('TIANGONG') || name.includes('CSS (') || id === 54216 ||
      name.includes('ISS (') || name.includes('MIR')) return 'station';
  if (name.startsWith('STARLINK')) return 'starlink';
  if (name.startsWith('ONEWEB')) return 'oneweb';
  if (name.includes('IRIDIUM')) return 'iridium';
  if (name.includes('GPS') || name.includes('NAVSTAR')) return 'gps';
  if (name.includes('GLONASS')) return 'glonass';
  if (name.includes('GALILEO')) return 'galileo';
  if (name.includes('BEIDOU')) return 'beidou';
  if (name.includes('NOAA') || name.includes('GOES') || name.includes('METEOSAT') ||
      name.includes('HIMAWARI') || name.includes('METEOR-M') || name.includes('DMSP')) return 'weather';
  return 'satellite';
}

// ---- transforms ------------------------------------------------------------
function buildCatalog(gp) {
  const out = [];
  for (const rec of gp) {
    const l1 = rec.TLE_LINE1;
    const l2 = rec.TLE_LINE2;
    if (!l1 || !l2) continue; // need real TLE for SGP4
    out.push({
      id: String(rec.NORAD_CAT_ID),
      name: rec.OBJECT_NAME || `OBJECT ${rec.NORAD_CAT_ID}`,
      cat: categorize(rec),
      rcs: rec.RCS_SIZE || null,
      intl: rec.OBJECT_ID || null,
      cc: rec.COUNTRY_CODE || null,
      epoch: rec.EPOCH || null,
      l1,
      l2,
    });
  }
  return out;
}

function buildConjunctions(cdm) {
  // Deduplicate by unordered pair (each CDM appears twice with SAT_1/SAT_2 swapped).
  const seen = new Set();
  const out = [];
  for (const c of cdm) {
    const a = String(c.SAT_1_ID), b = String(c.SAT_2_ID);
    const key = [a, b].sort().join('-') + '@' + c.TCA;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: c.CDM_ID,
      tca: c.TCA,
      minRng: Number(c.MIN_RNG),
      pc: Number(c.PC),
      a: { id: a, name: c.SAT_1_NAME, type: c.SAT1_OBJECT_TYPE, rcs: c.SAT1_RCS },
      b: { id: b, name: c.SAT_2_NAME, type: c.SAT2_OBJECT_TYPE, rcs: c.SAT2_RCS },
    });
  }
  out.sort((x, y) => y.pc - x.pc);
  return out;
}

// ---- main ------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  let gp, cdm;

  if (!REFRESH && fs.existsSync(GP_CACHE)) {
    console.log(`[spacetrack] using cached GP: ${GP_CACHE}`);
    gp = JSON.parse(fs.readFileSync(GP_CACHE, 'utf8'));
  } else {
    console.log('[spacetrack] logging in + fetching GP (full on-orbit catalog)...');
    const cookie = await spaceTrackLogin();
    gp = await spaceTrackQuery(cookie,
      'class/gp/decay_date/null-val/epoch/%3Enow-30/orderby/NORAD_CAT_ID/format/json');
    fs.writeFileSync(GP_CACHE, JSON.stringify(gp));
    console.log('[spacetrack] fetching cdm_public (upcoming conjunctions)...');
    try {
      cdm = await spaceTrackQuery(cookie,
        'class/cdm_public/TCA/%3Enow/orderby/PC%20desc/format/json');
      fs.writeFileSync(CDM_CACHE, JSON.stringify(cdm));
    } catch (e) {
      console.warn('[spacetrack] cdm fetch failed:', e.message);
    }
  }

  if (!cdm) {
    if (fs.existsSync(CDM_CACHE)) cdm = JSON.parse(fs.readFileSync(CDM_CACHE, 'utf8'));
    else if (fs.existsSync(CDM_SAMPLE)) cdm = JSON.parse(fs.readFileSync(CDM_SAMPLE, 'utf8'));
    else cdm = [];
  }

  const catalog = buildCatalog(gp);
  const conjunctions = buildConjunctions(cdm);

  fs.writeFileSync(path.join(OUT_DIR, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(OUT_DIR, 'conjunctions.json'), JSON.stringify(conjunctions));

  // Category histogram for logging.
  const hist = {};
  for (const o of catalog) hist[o.cat] = (hist[o.cat] || 0) + 1;
  console.log(`[spacetrack] catalog.json: ${catalog.length} objects`);
  console.log('[spacetrack] categories:', JSON.stringify(hist));
  console.log(`[spacetrack] conjunctions.json: ${conjunctions.length} events`);
}

main().catch((e) => { console.error(e); process.exit(1); });
