// fetch-catalog.mjs — Server-side catalog builder for LaunchLunar.
//
// CelesTrak 403s browser-origin fetches (Cloudflare), but serves fine to a
// server-side client with a normal User-Agent. This script pulls the full set
// of tracked-object groups, dedupes by NORAD id, tags each object with a
// category + RCS size class, and writes a compact catalog the app loads and
// propagates with real SGP4 (satellite.js) for true animated positions.
//
// Run:  node scripts/fetch-catalog.mjs
// Out:  public/data/catalog.json   (real OMM elements, one record per object)

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'catalog.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// Groups chosen for near-complete coverage of the public catalog with real
// element sets. `active` is the bulk of payloads; the debris groups matter for
// the >10cm conjunction-threat emphasis; special-interest groups sharpen
// category tagging.
const GROUPS = [
  'active', 'starlink', 'oneweb', 'gps-ops', 'glo-ops', 'galileo', 'beidou',
  'sbas', 'noaa', 'goes', 'weather', 'resource', 'science', 'geodetic',
  'engineering', 'cubesat', 'stations', 'visual', 'geo', 'intelsat', 'ses',
  'iridium', 'iridium-NEXT', 'amateur', 'military', 'radar',
  // debris fields (real, dangerous, >10cm tracked fragments)
  'cosmos-1408-debris', 'fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris',
  'last-30-days',
];

const BASE = 'https://celestrak.org/NORAD/elements/gp.php';

function categorize(name, group) {
  const n = (name || '').toUpperCase();
  if (n.includes('ISS (ZARYA)') || n === 'ISS') return 'iss';
  if (/\bR\/B\b/.test(n) || n.includes('ROCKET BODY') || n.includes('AKM') || n.includes('PKM')) return 'rocket_body';
  if (n.includes('DEB') || n.includes('DEBRIS') || n.includes('FRAGMENT') || /-debris/.test(group)) return 'debris';
  if (n.includes('STARLINK')) return 'starlink';
  if (n.includes('ONEWEB')) return 'oneweb';
  if (n.includes('IRIDIUM')) return 'iridium';
  if (group === 'stations' || n.includes('TIANGONG') || n.includes('CSS (') || n.includes('ISS ')) return 'station';
  if (n.includes('GPS') || n.includes('NAVSTAR') || group === 'gps-ops') return 'gps';
  if (n.includes('GLONASS') || group === 'glo-ops') return 'glonass';
  if (n.includes('GALILEO') || group === 'galileo') return 'galileo';
  if (n.includes('BEIDOU') || group === 'beidou') return 'beidou';
  if (n.includes('NOAA') || n.includes('GOES') || n.includes('METEOSAT') || n.includes('METOP') ||
      n.includes('HIMAWARI') || n.includes('DMSP') || group === 'weather' || group === 'noaa' || group === 'goes') return 'weather';
  return 'satellite';
}

async function fetchGroup(group, attempt = 1) {
  const url = `${BASE}?GROUP=${group}&FORMAT=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('non-array response (throttled?)');
    return data.map((o) => ({ ...o, __group: group }));
  } catch (e) {
    if (attempt <= 3) {
      const wait = 800 * attempt;
      await new Promise((r) => setTimeout(r, wait));
      return fetchGroup(group, attempt + 1);
    }
    console.warn(`  ! ${group}: ${e.message} (gave up)`);
    return [];
  }
}

// Sequential with small delay to stay under CelesTrak burst limits.
async function main() {
  console.log(`Fetching ${GROUPS.length} CelesTrak groups...`);
  const byId = new Map();
  let fetched = 0;
  for (const group of GROUPS) {
    const objs = await fetchGroup(group);
    fetched += objs.length;
    for (const o of objs) {
      const id = String(o.NORAD_CAT_ID);
      // First writer wins, except a real category beats a generic 'satellite'.
      const cat = categorize(o.OBJECT_NAME, o.__group);
      if (!byId.has(id)) {
        byId.set(id, { o, cat });
      } else if (byId.get(id).cat === 'satellite' && cat !== 'satellite') {
        byId.set(id, { o, cat });
      }
    }
    console.log(`  ${group.padEnd(22)} +${objs.length}  (unique: ${byId.size})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Compact records — only what SGP4 + UI need. Keeping OMM mean elements lets
  // the client build a satrec via satellite.js and propagate to any epoch.
  const catalog = [];
  for (const { o, cat } of byId.values()) {
    if (o.MEAN_MOTION == null || o.INCLINATION == null) continue;
    catalog.push({
      id: String(o.NORAD_CAT_ID),
      name: o.OBJECT_NAME || `NORAD ${o.NORAD_CAT_ID}`,
      cat,
      intl: o.OBJECT_ID || '',
      epoch: o.EPOCH,
      mm: o.MEAN_MOTION,
      ecc: o.ECCENTRICITY,
      inc: o.INCLINATION,
      raan: o.RA_OF_ASC_NODE,
      argp: o.ARG_OF_PERICENTER,
      ma: o.MEAN_ANOMALY,
      bstar: o.BSTAR ?? 0,
      ndot: o.MEAN_MOTION_DOT ?? 0,
      nddot: o.MEAN_MOTION_DDOT ?? 0,
      rev: o.REV_AT_EPOCH ?? 0,
      elnum: o.ELEMENT_SET_NO ?? 999,
    });
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(catalog));
  const mb = (statSync(OUT_FILE).size / 1e6).toFixed(2);

  // Category histogram for sanity.
  const hist = {};
  for (const c of catalog) hist[c.cat] = (hist[c.cat] || 0) + 1;
  console.log(`\nWrote ${catalog.length} objects (${mb} MB) to public/data/catalog.json`);
  console.log('By category:', JSON.stringify(hist, null, 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
