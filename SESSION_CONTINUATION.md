# LaunchLunar — Session Continuation Context (2026-07-08)

Hand this file to a fresh AI coding session to continue exactly where we left off.
It contains the user's requirements, the diagnosis, everything done, how it was verified,
current state, and remaining polish.

---

## 0. Repo / how to run

- Repo: `C:\Users\ashanand\launchlunar` — GitHub `github.com/ashwinan-nd/launchlunar`
- Branch: `real-data-and-physics`
- Stack: Vite + Three.js, vanilla JS (ESM). Real orbital mechanics + real 31,775-object Space-Track GP catalog.
- **Node is NOT on the bash PATH** (Windows/winget). Prefix every node/npm command with:
  ```
  export PATH="$PATH:/c/Users/ashanand/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.16.0-win-x64"
  ```
- Commands:
  ```
  npm run dev            # Vite dev server (http://localhost:5173/, picks next free port)
  npm test               # 13 physics/data checks (scripts/test-physics.mjs)
  npm run validate:500   # 500-simulation trajectory validation harness
  npx vite build         # production build (must pass)
  ```
- Dev servers pile up on 5173+ across sessions; Vite serves current files from disk, so any
  running instance rooted in the repo reflects the latest code. Kill stray node procs if needed.
- Live visual review: Playwright MCP is installed. Screenshots save to `C:\Users\ashanand\` (home),
  NOT the repo. `window.__state` is exposed for inspection.

---

## 1. The user's requirements (verbatim, this session)

> the current project, model, and test all functionality, including 500 different simulations to
> test trajectory calculations and presentation to be accurate. it's still not accurate, because the
> trajectory somehow goes from not the accurate coordinate placement on the earth, around the earth
> in a loop, gets close to the moon's orbital path, and then somehow goes a straight line to the moon.
> this is not an acceptable launch window that should even be considered, because the moon is not in an
> optimal position in it's orbit to receive the rocket, so this needs to be analyzed across all tests
> slowly to ensure that you capture all mistakes step by step. along with that, analyze the ui in depth;
> the orbiting objects do not have enough detail and I want even more detail and I want the objects to
> actually look like what they are with some depth some shadows some contouring some finesse with
> pixel-grade perfection instead of just looking like blunt-shaped objects right now. analyze the rest
> of the ui as well, including the earth, which I explicitly said I do not want to be transparent and I
> want a detailed moon, and I want the side bar to have some neomorphism/advanced design elements and I
> want the trajectory to look accurate and I want the rocket to look accurate, and I want the animation
> to be smooth and I want everything to look extremely high quality and as realistic as possible and you
> can do web scrapes to find designs that you can reverse-engineer... the most optimal machine
> learning/automated/neural network/advanced calculus/trigonometric/orbital mechanics/astrophysics/physics
> computational model as well as animation skills and ui/ux skills as well as viewing NASA datasets and
> any other public datasets to find any more objects... checking to see if once a trajectory is launched
> if the most risky objects are glowing bright red via the integration of orbital object trajectory
> projections into the computational model to see when the most optimal launch window is to the nearest
> minute, testing both the backend and frontend functionality.
>
> also download these and use them: playwright MCP, github.com/multica-ai/andrej-karpathy-skills,
> github.com/obra/superpowers, github.com/pbakaus/impeccable. use these skills without me telling you
> to use them explicitly.

Standing user preferences (from memory): Tesla data analyst; direct/no-fluff; **finished results not
plans, verify everything, minimize tokens, never ask to continue.**

---

## 2. Diagnosis (root causes found — authoritative)

The physics engine (`src/orbital.js calculateTranslunarTrajectory`, ~line 672) was already SOUND:
gravity-turn ascent, LEO coast with Lambert coast-angle search, Lambert TLI targeting the Moon's
arrival-time position, a 3-component Newton differential corrector against full dynamics (J2 + lunar
third-body), RK4 transfer, powered descent to the requested lat/lon. `generateSmoothTrajectory` is
DEAD cosmetic code (now removed from imports).

The user-visible "wrong start / loop / straight line to Moon / Moon not in position" bug was entirely
**render-side + ranking**, four independent defects:

1. **Fake straight line** — `scene.js showTrajectory` pushed a straight `lerp` from the last real
   waypoint to `this.moon.position` whenever they were far apart.
2. **Moon desynced** — the Moon mesh was always at wall-clock "now" (`main.js` refresh loop), never
   moved to the selected window's *arrival-time* position. So the trajectory (correctly ending where the
   Moon WILL be) had a gap to where the Moon was DRAWN → triggered defect #1 and looked like the Moon
   "wasn't in position".
3. **Wrong Earth start** — launch beacon used `scene.latLonToVector3` (texture convention, no GMST)
   while the physics start uses GMST-based ECI; Earth mesh also spun cosmetically, decoupled from GMST.
4. **Bad window pick** — `findOptimalLaunchWindows` computed a real Moon-geometry/phase score
   (`quickHohmannScore`) but DROPPED it from final ranking and backfilled infeasible windows.

---

## 3. What was done (all committed on `real-data-and-physics`)

### Trajectory / physics-render / ranking (`src/orbital.js`, `src/main.js`, `src/scene.js`)
- Deleted the fake straight-line extension in `showTrajectory`; kept only a guarded gap-closer (< 1 Moon radius).
- `main.js` now calls `scene.setMoonPosition(eciToThreeJs(w.moonArrivalPosition))` on window select AND
  initial auto-select; the 10s wall-clock Moon refresh no-ops while a window is selected.
- Launch beacon now placed at `eciToThreeJs(w.trajectory.waypoints[0].position)` (true ECI start).
  Earth mesh frozen to `computeGmst(w.launchDate)` via new `freezeEarthRotationAt()` / `resumeEarthRotation()`
  (sign verified numerically: `+gmst`, err 0.0000).
- `findOptimalLaunchWindows`: Moon-geometry score folded into final ranking (~0.30 weight); infeasible
  (`transferResult === 'miss' | 'escaped'`) windows skipped in candidate push AND backfill; returns empty
  array with `.reason` if zero feasible / none clear the 98% pSuccess threshold (tells user to widen dates).
- `computeGmst` exported. Fixed a descent-splice non-monotonic-time artifact.

### Validation
- New `scripts/validate-500.mjs` + `npm run validate:500`. Latest run: **500 sims, 497/500 feasible
  (99.4%), start-on-surface 500/500, arrival-on-surface (feasible) 497/497, landing-accuracy 401/401,
  monotonic-time 500/500, finite 500/500, arrival residual mean 1.83 km / max 8.13 km.**
- `npm test`: 13/13.

### UI overhaul
- **Earth** (`scene.js`): opaque; 8k day/night/clouds; real tangent-space normal map
  (`earth-normal.jpg` + `computeTangents()`); ocean specular gated by `earth-specular.jpg`; sigmoid
  terminator; Fresnel atmosphere; AmbientLight 0.45 → 0.12.
- **Moon**: 8k color + Sobel-derived normal/bump crater relief; correct shared-sun phase lighting.
- **Objects "look like what they are"**: per-category InstancedMesh 3D glyphs at near-LOD
  (satellite = body+solar panels, debris = jittered icosahedron, rocket body = cylinder,
  station = body+truss, nav = octahedron), lit with depth/shadow, sized by RCS. Far ~30k view keeps
  `THREE.Points`. Camera-distance LOD switch. `GLYPH_SIZE = 0.5` damper (scene.js ~line 80) tunes
  close-zoom density.
- **High-risk conjunction objects glow bright red** — selective UnrealBloom (`src/postprocessing.js`,
  `SelectiveBloom`, layer-gated). `showConjunctionMarkers` emissive red on BLOOM_LAYER.
- **Neomorphic UI** (`src/style.css`, `index.html`): style.css was previously UNLINKED — now
  `<link>`ed in index.html and rewritten as a neomorphic design system (dual-shadow panels, inset
  input wells, raised/pressed buttons, elevated color-coded window cards, pill tabs/chips, neomorphic
  transport). Selectors prefixed `#app .class` to beat main.js's runtime-injected `<style>`.
- **Rocket**: multi-stage tapered body + interstage rings + fins + nozzle (procedural).
- **Trajectory tube**: additive-glow layer + phase coloring on BLOOM_LAYER.
- **Animation**: delta-timed exponential damping (`damp`/`dampVec3`), frame-rate-independent.

### Build / tooling
- `vite.config.js`: added `worker: { format: 'es' }` (satellite.js WASM worker uses top-level await,
  incompatible with the default `iife` worker format). `npx vite build` now passes.
- Skills installed: **impeccable** into project `.claude` (23 `/impeccable …` commands; NOT committed —
  reinstall with `npx impeccable install` from repo root). **karpathy-guidelines** + 14 **superpowers**
  skills copied to USER skills `~/.claude/skills/` (outside repo — reinstall from
  github.com/multica-ai/andrej-karpathy-skills and github.com/obra/superpowers if on a new machine).
  Playwright MCP already available.
- Design research written to `DESIGN_REFERENCE.md` (cited techniques + GLSL/params, grounded in this codebase).

### High-res textures added (`public/textures/`)
`8k_earth_daymap.jpg`, `8k_earth_nightmap.jpg`, `8k_earth_clouds.jpg`, `8k_moon.jpg`,
`8k_stars_milky_way.jpg` (Solar System Scope, CC-BY), `earth-normal.jpg`, `earth-specular.jpg`
(three.js examples). Old low-res `earth-day.jpg`/`earth-night.jpg`/`moon.jpg` kept as fallback.

---

## 4. Verified live (Playwright, 0 console errors on Earth / Trajectory / Moon views)
- Earth opaque + detailed (continents, clouds, terminator, atmosphere rim).
- Launch (Apollo 11 preset) → 4 feasible windows, all P(success) 99.9%, ΔV ~14.9–15.3 km/s,
  flight 3.9–4.8 d, times to the minute (e.g. `Aug 13 2026 06:29:00 UTC`), landing Mare Tranquillitatis,
  high-risk conjunction listed (ATLAS D R/B, 401.6 km).
- Trajectory: real curved arc, rocket mid-flight, terminates on the lunar landing bullseye — no straight line.
- Moon view: crater relief + phase lighting + landing target rings.
- Object glyphs read as distinct 3D shapes at near-LOD.

---

## 5. Remaining polish / open ideas (NOT bugs)
- Zoomed-in Trajectory view is dense — that is the real ~10k-Starlink LEO population. Could fade/thin
  far objects during a launch for a cleaner establishing shot, or pull the default `focusTrajectory`
  camera back.
- Descent arc has a slight angular kink at the closest-approach→descent transition — could smooth.
- Bloom intensity on the trajectory/limb is strong — could tune down.
- ML/neural-network aspiration in the brief is currently classical astrodynamics + Monte-Carlo (which
  is the correct, accurate approach); a learned surrogate for window pre-screening is a possible future
  add, not needed for correctness.
- Object catalog is already the authoritative real set (31,775 Space-Track GP, >10 cm) — no public
  dataset adds meaningful tracked objects beyond it.

---

## 6. Key files
- `src/orbital.js` — physics, Lambert, differential corrector, RK4, Meeus Moon, window search, catalog.
- `src/scene.js` — all Three.js rendering (Earth/Moon/objects/LOD/rocket/trajectory/bloom/camera).
- `src/postprocessing.js` — selective bloom composer.
- `src/main.js` — app wiring, form, launch flow, results panel, view tabs, playback.
- `src/style.css` + `index.html` — neomorphic UI.
- `scripts/validate-500.mjs` — 500-sim harness. `scripts/test-physics.mjs` — `npm test`.
- `DESIGN_REFERENCE.md` — design/technique spec. `vite.config.js` — worker ES format.
