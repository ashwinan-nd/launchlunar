---
name: spacetrack-catalog
description: Refresh LaunchLunar's real orbital catalog from Space-Track (GP + satcat + cdm_public), rebuild public/data/catalog.json & conjunctions.json, and report the delta vs the previous catalog. Use when the on-orbit data is stale, after a launch/decay event, or when the user asks to update/re-fetch the satellite catalog.
---

# spacetrack-catalog

Wraps `scripts/fetch-spacetrack.mjs` to keep LaunchLunar's catalog current from the
authoritative source (Space-Track), respecting rate limits, and reports what changed.

## Data source
- **Space-Track GP class** — every on-orbit object's SGP4 mean elements + real TLE lines
  (`decay_date null-val`, latest elset). ~31.8k objects.
- **cdm_public** — real Conjunction Data Messages (TCA, miss distance, PC, both objects, RCS).
- CelesTrak (`scripts/fetch-catalog.mjs`) is a documented dev fallback only — it 403s the
  `active`/`starlink` groups even server-side, so **do not rely on it**; Space-Track is the source.

## Credentials
`ST_USER` / `ST_PASS` in `.env.local` (gitignored) or the environment. Never commit them.

## Refresh procedure
1. Ensure creds are available (`.env.local` has `ST_USER`/`ST_PASS`).
2. Run the fetch+build (reuses the `.cache-spacetrack/` cache if present):
   ```bash
   npm run fetch:catalog            # or: node scripts/fetch-spacetrack.mjs
   node scripts/fetch-spacetrack.mjs --refresh   # force a live re-fetch from Space-Track
   ```
   This writes `public/data/catalog.json` (`[{id,name,cat,rcs,intl,cc,epoch,l1,l2}]`) and
   `public/data/conjunctions.json` (`[{id,tca,minRng,pc,a,b}]`), and prints a category histogram.
3. Rate limits: ≤30 req/min, ≤300 req/hr — one bulk query per class is enough; back off on 429/500.

## Report the delta
After a refresh, compare object counts and categories against the prior catalog and summarise:
```bash
node -e "const d=require('./public/data/catalog.json');const h={};for(const o of d)h[o.cat]=(h[o.cat]||0)+1;console.log('total',d.length);console.log(h);"
```
Report: total object count, per-category counts, newest EPOCH, and (if a prior copy exists in git)
the net add/remove of NORAD ids since the last commit.

## Validate
Run the physics + data self-check (asserts the catalog parses and ≥95% of objects propagate under SGP4):
```bash
npm test        # scripts/test-physics.mjs
```

## Notes
- Categorization is centralized in `categorize()` in `scripts/fetch-spacetrack.mjs`
  (payload/rocket-body/debris/station + constellation buckets). Keep it the single source of truth.
- The app reads only the bundled JSON at runtime; credentials never reach the client.
- Absolute cache path under Git Bash: `C:\Users\ashanand\launchlunar\.cache-spacetrack\gp_all.json`.
