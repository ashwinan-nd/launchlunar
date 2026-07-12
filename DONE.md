# LaunchLunar — BUILD COMPLETE (consolidated)

The `real-data-and-physics` and `overhaul` branches are merged into one
comprehensive build on the `consolidation` branch. Everything below is
implemented, tested, and browser-verified.

## What this build has

**Real data**
- ~31,000 real Space-Track objects, real TLEs, SGP4 propagation in a Web Worker.
- Per-category glyphs sized by radar cross-section; live CelesTrak/N2YO fallback
  with status toasts when the bundled catalog is unavailable.

**Real physics** (all launch dates capture the Moon)
- Gravity-turn ascent with real MECO + honest ascent-failure reporting.
- Launch-azimuth plane targeting; Lambert TLI + Newton corrector; RK4 transfer
  with J2 + lunar third-body gravity; periselene capture + powered descent to the
  exact requested landing coordinate.
- Uncached Moon-velocity finite differences (fixed a shared ~10x dvLoi bug).
- Launch-window search with daily diversity, Monte-Carlo P(success), conjunction
  screening.

**Visualization + UX**
- Photoreal Earth/Moon, selective bloom, GMST-accurate Earth orientation,
  handedness-correct ECI→scene mapping.
- Three camera views (EARTH / TRAJECTORY full-system framing / MOON) + phase-
  budgeted, time-accurate playback with no jump cuts.
- High-risk conjunctions glow red.
- Floating neomorphic panels, responsive drawer/bottom-sheet layout (usable on a
  390px phone — the 3D view was previously 0% visible on mobile), a11y labels +
  focus rings.
- N2YO key removed from source into .env (the committed key is burned in history
  and must be rotated).

## Tests (all green)
- `npm test` — Vitest, 31 passed (ephemeris/GMST/handedness/RK4 conservation +
  convergence/Hohmann/mission envelope/window diversity/data-layer mocks).
- `npm run test:physics` — 13 passed (physics + catalog/SGP4 sanity).
- `npm run test:e2e` — Playwright desktop 3 + mobile 2 passed.

## How to run
```
npm install
npm run dev        # Vite → http://localhost:5199/
npm test           # unit + physics validation
npm run test:e2e   # end-to-end (desktop + mobile)
```
See README.md for the full command list and architecture map.
