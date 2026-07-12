# LaunchLunar — BUILD COMPLETE (consolidated + realism/accuracy pass)

Branch `consolidation` merges the best of `real-data-and-physics` and the
`overhaul` work, then adds a realism + computational-accuracy pass. Everything
below is implemented, tested, and browser-verified.

## Highlights of the latest pass
- **Objects never disappear at any zoom** — billboards stay visible at every
  zoom level (3D glyphs are an additive near overlay); all 31,766 objects
  render from 2.2→118 units.
- **Computational model (grounded in MIT ascent notes + NASA Trajectory
  Browser + NASA COLA practice):**
  - Ascent aerodynamic drag (exponential atmosphere); LEO ΔV is now the
    integrated gravity + drag losses, not a flat constant (~9.3 km/s to LEO).
  - Solar third-body perturbation (Meeus solar ephemeris + SUN_MU) alongside
    Earth-J2 and lunar third-body in the RK4 transfer.
  - **COLA-aware launch windows** — the predicted positions of the catalog at
    each candidate launch epoch drive a worst-case collision probability
    (Chan/Foster Pc); launch times over Pc=1e-4 are BLACKED OUT. maxPc,
    screened count, ΔV/flight Pareto (ΔV-OPT / FASTEST) surfaced per window.
- **Visual realism:**
  - Earth: fresnel atmosphere rim, terminator sunset scattering, cloud
    shadows, earthshine night side — photoreal and fully opaque from all angles.
  - Rocket: real Saturn V detailing (black roll-pattern markings, 5-engine
    F-1 cluster, launch-escape tower, PBR).
  - Orbital objects: richer per-category glyphs (bus + solar arrays + dish,
    ISS truss + wings, GNSS wings, spent stage + nozzle, tumbling debris) with
    baked per-component shading.

## Tests (all green)
- `npm test` — Vitest, 43 passed (ephemeris/GMST/handedness/RK4 conservation +
  convergence/Hohmann/mission envelope/window diversity/data-layer + ascent
  drag/solar ephemeris/COLA Pc + blackout).
- `npm run test:physics` — 13 passed.
- `npm run test:e2e` — Playwright desktop 3 + mobile 2 passed.

## How to run
```
npm install
npm run dev        # Vite → http://localhost:5199/
npm test           # unit + physics validation
npm run test:e2e   # end-to-end (desktop + mobile)
```
See README.md for the full command list, architecture, and data sources.
