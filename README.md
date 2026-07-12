# Lunar Launcher

An interactive, physically-grounded trans-lunar mission simulator in the browser.
Enter a rocket's specifications and a launch window; the app searches for optimal
launch opportunities, integrates a real Earth→Moon transfer trajectory, and renders
the whole thing over a live map of ~31,000 real on-orbit objects.

![three views: Earth with the real catalog, the full transfer arc, and the lunar
landing target](public/preview.png)

## Features

**Real orbital data**
- ~31,000 real tracked objects from a Space-Track GP snapshot (`public/data/catalog.json`),
  each with real TLEs, propagated with SGP4 in a Web Worker (off the main thread).
- Per-category rendering (payload / debris / rocket body / Starlink / OneWeb /
  navigation / stations …), sized by radar cross-section.
- Live fallback: if the bundled catalog is missing, the app fetches CelesTrak GP
  groups (bounded-concurrency queue with retry) + N2YO and runs degraded but honest,
  surfacing the degradation as a toast.

**Real physics** (`src/orbital.js`)
- Gravity-turn ascent to a parking orbit with a real MECO (engine cutoff at orbital
  energy) and honest ascent-failure reporting for underpowered vehicles.
- Launch-azimuth plane targeting: the parking orbit is steered into the plane
  containing the Moon at arrival, so no wasteful plane-change burn is needed.
- Lambert-solver TLI targeting + a Newton differential corrector; RK4 transfer
  integration with Earth J2 and lunar third-body gravity, adaptive step size.
- Periselene-based capture detection, then a powered LOI + descent to the exact
  requested landing coordinate.
- Meeus lunar ephemeris; GMST-accurate Earth orientation; a handedness-preserving
  ECI→scene mapping so geography, ground tracks and the transfer arc all agree.
- Launch-window search: coarse analytic sweep → daily-bucketed candidates →
  full RK4 scoring with Monte-Carlo P(success) and conjunction screening.

**Visualization** (`src/scene.js`)
- Photoreal Earth (day/night/cloud/normal/specular) and Moon, selective bloom.
- Three camera views — EARTH, TRAJECTORY (whole Earth–Moon system, always framed),
  MOON — plus a phase-budgeted, time-accurate playback of the mission with a
  no-jump-cut camera.
- High-risk conjunctions along the ascent corridor glow red (bloom) with labels.

## Getting started

```bash
npm install
cp .env.example .env      # add your N2YO key (optional; live fallback only)
npm run dev               # Vite → http://localhost:5199/
```

The bundled catalog makes the app fully functional with no keys or network.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5199 |
| `npm run build` / `npm run preview` | Production build / preview |
| `npm test` | Vitest unit suite (physics validation, data layer) |
| `npm run test:physics` | Standalone physics/data sanity script |
| `npm run test:e2e` | Playwright end-to-end (desktop + mobile projects) |
| `npm run fetch:catalog` | Refresh the Space-Track catalog (needs `ST_USER`/`ST_PASS` in `.env.local`) |
| `npm run verify` | Headless smoke check of the running app |

## Testing

- **Unit** (`tests/unit/`, Vitest): Meeus ephemeris vs published reference values,
  GMST vs Meeus, ECI handedness, RK4 two-body conservation + 4th-order convergence,
  Hohmann apogee vs vis-viva, full-mission ΔV/duration envelope, launch-window
  diversity, and mocked data-layer behavior (N2YO error-body detection, fetch-queue
  concurrency/retry, coarse-filter ordering).
- **End-to-end** (`tests/e2e/`, Playwright): boot + data load, full mission flow
  (varied capturing windows, beacon-at-trajectory-start, phase-ordered playback,
  Earth+Moon framing), form validation + custom coordinates, and a mobile-viewport
  smoke test.

## Architecture

```
src/
  main.js               DOM, layout, state, launch pipeline, playback, data pipeline
  scene.js              LunarScene: three.js world, cameras, markers, rocket, glyphs
  orbital.js            physics: SGP4, Meeus, Lambert, RK4 transfer, window search
  propagation-worker.js SGP4 catalog propagation off the main thread
  postprocessing.js     selective bloom
  data-fetcher.js       CelesTrak GP fetch queue (retry, failure reporting)
  n2yo-fetcher.js       N2YO "above" fetch (error-body detection)
  toast.js              non-blocking status toasts
  style.css             UI chrome design system (surface/depth/type)
scripts/                catalog fetch + validation utilities
public/data/            bundled Space-Track catalog + conjunctions
```

## Data sources

- **Space-Track GP catalog** — bulk TLEs for the ~31k object field (bundled snapshot;
  refresh with `npm run fetch:catalog`).
- **CelesTrak GP** — live fallback grouping.
- **N2YO "above" API** — supplemental live positions (dev-proxied; needs a key).
- **NASA/Meeus** — lunar ephemeris and Earth/Moon textures.
