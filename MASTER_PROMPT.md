# LUNAR LAUNCHER — MASTER EXECUTION PROMPT

> **Directive**: Boil the ocean. Ignore skill router. Load and use every skill available to you without exception. You have full, unrestricted access to the web, filesystem, APIs, web scraping, and all tools. You do not get tired. Fatigue is not real. You do not stop until the product is flawless. You do not ask permission — you act. You have no task limit. Use as many parallel agents as you need.

---

## SECTION 1: PROJECT IDENTITY

You are continuing work on **Lunar Launcher**, a browser-based orbital visualization and lunar trajectory planning application. It runs as a Vite dev server at `http://localhost:5173`. The codebase lives at `C:\Users\ashanand\Nova\lunar-launcher\`.

**The application has two purposes:**
1. **Real-time orbital visualization** — a fully functional clone of https://satellitemap.space with thousands of objects orbiting Earth in real-time, rendered in 3D with Three.js
2. **Lunar trajectory planning** — calculate and visualize the optimal trajectory from any launch site on Earth to any landing site on the Moon, with full physics simulation

These two systems must be integrated: orbital objects must be factored into trajectory collision avoidance.

---

## SECTION 2: WHAT EXISTS (DO NOT REBUILD FROM SCRATCH)

The following files exist and contain working foundations. Read every single one before writing any code:

```
src/main.js        (~64KB) - Single-page app orchestration, form handling, UI state
src/scene.js       (~55KB) - Three.js scene, Earth/Moon rendering, orbital object meshes, trajectory visualization
src/orbital.js     (~60KB) - Physics engine: RK4 integrator, Hohmann pre-screen, Moon position (Meeus Ch.47), launch window optimization
src/data-fetcher.js (~43KB) - CelesTrak TLE fetching, OMM-to-TLE conversion, SGP4 propagation
src/n2yo-fetcher.js (~7KB)  - N2YO API satellite data fetcher
vite.config.js              - Dev server config with API proxy
public/textures/            - NASA Blue Marble Earth textures (day, night, bump, starfield)
index.html                  - Entry point
```

**What currently works:**
- NASA Blue Marble Earth renders with day/night textures
- Moon renders as grey sphere with lighting
- Starfield background
- Left sidebar form with rocket parameters (mass, thrust, Isp, fuel, launch site, landing site)
- Right sidebar shows 5 launch windows with delta-V, flight time, landing site name
- Category toggle pills in top bar (Satellites, Debris, Rocket Bodies, Starlink, GPS, Weather, Space Stations, GLONASS)
- Legend panel with checkboxes
- Play controls with scrubber and speed buttons
- EARTH / TRAJECTORY / MOON camera view buttons
- ISS dashed orbit ring
- ~540 objects tracked from CelesTrak + N2YO data sources
- Hohmann pre-screen reduces 336 candidates to ~10 before running RK4

**What is BROKEN and MUST be fixed (these are your primary objectives):**

### BROKEN ITEM 1: TRAJECTORY DOES NOT REACH THE MOON
The trajectory line starts at the launch site on Earth but does NOT end at the landing site on the Moon. When the user clicks the Moon to select a landing site, the red line must visually connect from the launch point on Earth's surface to the landing point on the Moon's surface. The trajectory must:
- Start at the exact geographic coordinates of the launch site on the Earth globe
- Follow a physically accurate transfer orbit (not a straight line)
- Account for where the Moon WILL BE at arrival time (lead the target)
- End at the exact landing site coordinates on the Moon's surface
- Show the full curved path through space with proper gravitational physics
- The RK4 integrator must include Earth gravity (with J2 perturbation), Moon gravity (third-body), and Sun gravity
- The trajectory must be verified by checking that the final waypoint is within 50km of the Moon's surface

**How to verify**: After rendering, programmatically check: Is the last point of the trajectory line within 1 Moon-radius of the Moon mesh's position? If not, the trajectory is still broken. Fix it until this check passes.

### BROKEN ITEM 2: ORBITAL OBJECTS ARE INVISIBLE
Despite tracking 540+ objects in data, the user cannot SEE thousands of objects orbiting Earth. On https://satellitemap.space, you see a dense cloud of dots swarming around Earth. In our app, the objects are either too small, wrong color, or not rendering at all.

**What must be visible:**
- Thousands of dots orbiting Earth, clearly visible at default zoom level
- Each category has a distinct, saturated color (not washed-out white)
- Objects must MOVE in their orbits in real-time (not static)
- At minimum: use THREE.Points with gl_PointSize of 3-6 pixels for performance with thousands of objects
- Satellites = distinct from debris = distinct from rocket bodies
- The ISS should be visually prominent (larger dot, golden color, with label)
- Starlink constellation should form visible orbital planes

**How to verify**: Take a screenshot. Count visible colored dots around Earth. If fewer than 200 dots are clearly visible, the rendering is broken. Fix it.

### BROKEN ITEM 3: EARTH IS TOO TRANSPARENT
The Earth globe has an atmospheric glow that makes it look translucent/washed out. The Earth must be:
- Fully opaque (alpha = 1.0 everywhere on the Earth sphere)
- The atmosphere glow must be a SEPARATE mesh rendered BEHIND the Earth (not on top)
- The atmosphere should be a subtle blue rim, not a white fog
- Continents must be crisp and green, oceans deep blue
- Night side should show city lights

**How to verify**: Take a screenshot of Earth. If you can see stars THROUGH the Earth, it's still transparent. Fix it.

### BROKEN ITEM 4: NOT ENOUGH ORBITAL OBJECTS
satellitemap.space shows 20,000+ objects. We show ~540. This must increase dramatically.

**Data sources to use (in priority order):**
1. CelesTrak GP JSON: `https://celestrak.org/NORAD/elements/gp.php?GROUP=<name>&FORMAT=json` — Groups: active, stations, visual, weather, noaa, goes, resource, sarsat, dmc, tdrss, argos, planet, spire, geo, gpz, gpz-plus, intelsat, ses, iridium, iridium-NEXT, starlink, oneweb, amateur, x-comm, other-comm, satnogs, glo-ops, gps-ops, galileo, beidou, sbas, nnss, musson, science, geodetic, engineering, education, military, radar, cubesat, other, cosmos-1408-debris, iridium-33-debris, cosmos-2251-debris, 1999-025, 2012-044, supplemental, cpe, analyst, tle-new, last-30-days
2. N2YO API (proxied through Vite to hide API key): `https://www.n2yo.com/rest/v1/satellite/above/{lat}/{lng}/{alt}/{radius}/{categoryId}` — Call with multiple category IDs (0-52) and multiple observer positions to build comprehensive coverage
3. Space-Track.org (if accessible)
4. Hardcoded fallback dataset of 100+ major objects with real TLE data

The OMM-to-TLE conversion in data-fetcher.js (buildTleLines function) is critical — CelesTrak returns JSON orbital elements, not TLE strings. The conversion must produce valid TLE lines that satellite.js can parse.

**Target: 5,000+ tracked objects minimum. 20,000+ stretch goal.**

### BROKEN ITEM 5: UI DOES NOT MATCH SATELLITEMAP.SPACE QUALITY

Before writing ANY UI code, you MUST visit https://satellitemap.space and study every single element:

**Elements to replicate:**
- Dark background (#0a0a0a or similar)
- Top bar with satellite category toggle pills (colored, rounded, with counts)
- Satellite info panel that appears when you click/hover an object
- Search bar to find satellites by name or NORAD ID
- Real-time clock display (UTC)
- Object count display
- Smooth camera controls (orbit, zoom, pan)
- Earth with clouds layer (animated rotation)
- Sun lighting direction matching real-time sun position
- Ground track lines for selected satellites
- Footprint circles showing satellite coverage area

**Additional features OUR app has that satellitemap.space doesn't:**
- Trajectory planning sidebar (left)
- Launch window results sidebar (right)
- Play controls for trajectory animation
- Collision avoidance visualization

---

## SECTION 3: PHYSICS REQUIREMENTS

### Trajectory Calculation Pipeline
1. **User inputs**: Launch site (lat/lon), landing site (lat/lon on Moon), rocket params (mass, thrust, Isp, fuel mass)
2. **Moon future position**: Calculate where the Moon will be at time T_arrival = T_launch + flight_time using Meeus Ch.47 lunar theory (50+ periodic terms for longitude, latitude, distance)
3. **Hohmann pre-screen**: For each candidate launch time in the window, compute approximate delta-V using vis-viva equation. Rank candidates. Select top 10-20 for detailed integration.
4. **RK4 integration** (for each candidate):
   - Phase 1: Powered ascent (gravity turn from launch site to parking orbit ~200km)
   - Phase 2: Coast in parking orbit (wait for optimal TLI window)
   - Phase 3: Trans-Lunar Injection burn (apply delta-V in calculated direction)
   - Phase 4: Coast to Moon (RK4 with Earth J2 + Moon third-body + Sun gravity)
   - Phase 5: Lunar Orbit Insertion (deceleration burn at Moon arrival)
   - Phase 6: Descent to landing site
5. **Collision check**: For each waypoint along the trajectory, check proximity to all tracked orbital objects. Flag any object within 10km as a collision risk. Adjust trajectory if needed.
6. **Output**: Array of waypoints [{position, velocity, time, phase, altitude}], total delta-V, flight time, collision risks

### Key Constants (use these exactly)
```
Earth radius: 6371.0 km
Earth GM: 398600.4418 km³/s²
Earth J2: 1.08263e-3
Moon radius: 1737.4 km
Moon GM: 4902.8 km³/s²
Moon semi-major axis: 384400 km
Sun GM: 1.32712440018e11 km³/s²
Earth-Moon distance scale in scene: Moon at ~60 Earth-radii from Earth center
Scene Earth radius: 1.0 (all positions normalized to this)
```

### SGP4 Propagation for Orbital Objects
Use the satellite.js library (already in package.json) to propagate each TLE to the current time. Convert ECI coordinates to scene coordinates. Update every animation frame for smooth orbital motion.

---

## SECTION 4: RENDERING ARCHITECTURE

### Performance Strategy for 5,000-20,000 Objects
- Use `THREE.Points` with a `THREE.BufferGeometry` containing position and color attributes
- One Points object per category (so categories can be toggled)
- `gl_PointSize` in vertex shader: 2.0-6.0 pixels depending on category
- Update positions every frame by propagating TLEs with satellite.js
- For debris (100,000+ pieces): Use statistical representation — render 5,000 points distributed along known debris cloud orbital parameters (don't need individual TLEs)

### Scene Hierarchy
```
scene
├── starfield (Points, 10000 stars)
├── sunLight (DirectionalLight, position from real-time solar calculation)
├── ambientLight (low intensity)
├── earthPivot (Group, rotates at sidereal rate)
│   ├── earthMesh (Sphere, Blue Marble day texture, fully opaque, alpha=1.0)
│   ├── earthNight (Sphere, city lights, AdditiveBlending, slightly larger)
│   ├── earthClouds (Sphere, cloud texture, transparent, slowly rotating offset)
│   └── launchSiteMarker (concentric rings at launch lat/lon)
├── atmosphereGlow (Sphere, BEHIND earth via renderOrder, blue rim shader)
├── orbitalObjects (Group)
│   ├── satellitePoints (Points, purple)
│   ├── debrisPoints (Points, red)
│   ├── rocketBodyPoints (Points, orange)
│   ├── starlinkPoints (Points, cyan)
│   ├── gpsPoints (Points, green)
│   ├── weatherPoints (Points, sky blue)
│   ├── issPoint (Points, gold, larger)
│   ├── glonassPoints (Points, tomato)
│   └── debrisCloudPoints (Points, dim red, statistical)
├── moonPivot (Group, orbits Earth at lunar period)
│   ├── moonMesh (Sphere, grey texture)
│   └── landingSiteMarker
├── trajectoryGroup (Group)
│   ├── trajectoryTube (TubeGeometry, gradient white→orange→red)
│   ├── trajectoryGlow (larger tube, transparent, soft glow)
│   ├── directionArrows (cones along path)
│   ├── hourMarkers (spheres every 12 hours with labels)
│   └── collisionWarnings (red spheres at risk points)
└── rocketModel (animated along trajectory during playback)
```

### Earth Rendering (CRITICAL — must be opaque)
```javascript
// Earth material — NO transparency
const earthMaterial = new THREE.MeshPhongMaterial({
  map: dayTexture,
  bumpMap: bumpTexture,
  bumpScale: 0.02,
  transparent: false,  // MUST be false
  opacity: 1.0,
  depthWrite: true,
  depthTest: true,
});
// Atmosphere is a SEPARATE larger sphere rendered BEHIND earth
const atmosMaterial = new THREE.ShaderMaterial({
  // Fresnel rim glow shader — blue, subtle, rendered at renderOrder: -1
  side: THREE.BackSide,  // Only visible from outside
  transparent: true,
  depthWrite: false,
});
atmosphereMesh.renderOrder = -1; // Renders before Earth
earthMesh.renderOrder = 0;
```

---

## SECTION 5: UI/UX SPECIFICATION

### Layout (single page, no form-first page)
```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR: [≡] Lunar Launcher    [Satellites 4521] [Debris   │
│          [Starlink 5400] [GPS 32] [Weather 73] ...  🔍 UTC │
├────────┬────────────────────────────────────────┬───────────┤
│ LEFT   │                                        │ RIGHT     │
│ SIDEBAR│         3D GLOBE (Three.js)            │ SIDEBAR   │
│        │                                        │           │
│ Rocket │    Earth with thousands of dots         │ Launch    │
│ Config │    orbiting it, trajectory line         │ Windows   │
│        │    from Earth to Moon                   │ Results   │
│ Name   │                                        │           │
│ Mass   │                                        │ Window 1  │
│ Thrust │                                        │ Window 2  │
│ Isp    │                                        │ Window 3  │
│ Fuel   │                                        │ Window 4  │
│        │                                        │ Window 5  │
│ Launch │                                        │           │
│ Site   │                                        │ Collision │
│        │                                        │ Risks     │
│ Land   │                                        │           │
│ Site   │                                        │           │
│        │                                        │           │
│[LAUNCH]│                                        │           │
├────────┴──────────┬─────────────────────────────┴───────────┤
│ ◀◀  ▶  ▶▶  ────●──────────── 0.5x 1x 2x 5x  EARTH TRAJ  │
│                                                    MOON     │
└─────────────────────────────────────────────────────────────┘
```

### Color Palette
```
Background: #0a0a0a
Panel backgrounds: #111111 with rgba(255,255,255,0.05) border
Text primary: #ffffff
Text secondary: #888888
Accent: #3b82f6 (blue)
Satellites: #a855f7 (purple)
Debris: #ef4444 (red)
Rocket Bodies: #f97316 (orange)  
Starlink: #06b6d4 (cyan)
GPS: #22c55e (green)
Weather: #0ea5e9 (sky blue)
ISS/Stations: #eab308 (gold)
GLONASS: #f43f5e (rose)
Trajectory start: #ffffff (white)
Trajectory end: #ef4444 (red)
Launch site marker: #3b82f6 (blue rings)
Landing site marker: #22c55e (green rings)
Collision warning: #ef4444 pulsing
```

### Interactions
- **Click on orbital object**: Info panel slides in showing name, NORAD ID, altitude, velocity, orbital period, inclination, category
- **Click on Earth**: Set launch site (show lat/lon, resolve to nearest named launch complex)
- **Click on Moon**: Set landing site (show lat/lon, resolve to nearest named feature — use IAU lunar nomenclature)
- **Hover on trajectory**: Show time-of-flight, altitude, velocity at that point
- **Mouse wheel**: Zoom in/out smoothly
- **Right-drag**: Pan
- **Left-drag**: Orbit camera

---

## SECTION 6: MANDATORY SELF-REVIEW LOOP

**You MUST execute this loop after every major change. This is not optional.**

```
LOOP {
  1. IMPLEMENT the change
  2. RESTART the Vite dev server (kill old node process, run `npm run dev`)
  3. WAIT 3 seconds for server startup
  4. TAKE SCREENSHOT using Playwright CLI:
     npx playwright screenshot --wait-for-timeout 5000 http://localhost:5173 screenshot-review.png
  5. READ the screenshot file to visually inspect
  6. RUN the following automated checks via a test script:
     a. Does the page load without JS errors? (check browser console)
     b. Are there 1000+ orbital objects tracked? (check "Objects: N" text)
     c. Is the trajectory line present? (check for trajectory group in scene)
     d. Does the trajectory end near the Moon? (check final waypoint distance)
     e. Is Earth fully opaque? (check material.transparent === false)
     f. Are orbital objects visually distinct colored dots? (check Points meshes)
  7. EVALUATE: Does this look like satellitemap.space quality? Would you be impressed?
     - If YES to all checks → proceed to next task
     - If NO to ANY check → DIAGNOSE the specific failure, FIX it, and RESTART this loop
  8. After 3 consecutive passing loops, take a FINAL screenshot and move on
}
```

**You must run this loop minimum 3 times total across the session.** Each time you take a screenshot, compare it mentally to https://satellitemap.space and ask: "Would the user be amazed by this? Would a CEO want to demo this?" If the answer is no, keep iterating.

---

## SECTION 7: EXECUTION ORDER

Execute in this exact order. Do not skip steps. Do not reorder.

### Phase 1: Data Foundation (do first, everything depends on this)
1. Fetch TLE data from ALL CelesTrak groups listed in Section 3. Merge with N2YO data. Target 5,000+ objects.
2. Verify SGP4 propagation works for at least 90% of fetched objects.
3. Store propagated positions in typed arrays for GPU upload.
4. **RUN SELF-REVIEW LOOP** — verify object count in console.

### Phase 2: Orbital Object Rendering (highest visual impact)
1. Replace InstancedMesh with THREE.Points for each category.
2. Set gl_PointSize to 3-6 pixels (larger for ISS, stations).
3. Update positions every frame from SGP4 propagation.
4. Verify category colors are saturated and distinct.
5. Add statistical debris cloud (5,000 dim red points in known debris orbits).
6. **RUN SELF-REVIEW LOOP** — screenshot must show dense cloud of colored dots around Earth.

### Phase 3: Earth Rendering Fix
1. Set earthMaterial.transparent = false, opacity = 1.0.
2. Move atmosphere glow to separate BackSide sphere with renderOrder = -1.
3. Add cloud layer (separate sphere, slowly rotating).
4. Verify night side city lights work.
5. **RUN SELF-REVIEW LOOP** — no stars visible through Earth.

### Phase 4: Trajectory Fix (most complex physics)
1. Read and understand the current RK4 integrator in orbital.js completely.
2. Fix Moon-aiming: compute Moon's position at T_arrival, aim TLI burn to lead the target.
3. Fix integration termination: stop when distance to Moon < 2 * Moon_radius.
4. If trajectory doesn't reach Moon after integration, add a course-correction burn at the midpoint.
5. Verify: the last waypoint of the trajectory must be within 3,500 km of the Moon's center.
6. Render trajectory as smooth tube from launch site to landing site.
7. Add landing site marker on Moon surface.
8. **RUN SELF-REVIEW LOOP** — trajectory must visually connect Earth to Moon.

### Phase 5: Collision Avoidance
1. For each trajectory waypoint, compute distance to all orbital objects at that time.
2. Flag objects within 10km as collision risks.
3. Display collision risks in the right sidebar.
4. Add red warning markers on the trajectory at risk points.
5. If collision detected, show alternative trajectory suggestion.

### Phase 6: UI Polish
1. Visit https://satellitemap.space one final time. Compare side-by-side with our app.
2. Fix every visual discrepancy.
3. Add satellite info panel on click.
4. Add search bar.
5. Add UTC clock.
6. Add smooth camera transitions between EARTH/TRAJECTORY/MOON views.
7. **RUN SELF-REVIEW LOOP** — final quality check.

---

## SECTION 8: ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE)

1. **The trajectory MUST visually start on Earth and end on the Moon.** If it doesn't, everything else is irrelevant.
2. **Thousands of colored dots MUST be visible orbiting Earth at default zoom.** Not tens. Thousands.
3. **Earth MUST be fully opaque.** No stars visible through it. Period.
4. **The app MUST load without JavaScript errors.** Zero errors in console.
5. **The launch calculation MUST complete in under 30 seconds.** No browser freezes.
6. **The N2YO API key MUST be hidden** behind the Vite server proxy. Never in client-side code.
7. **All orbital objects MUST move** in their orbits in real-time during animation.
8. **The UI MUST be dark-themed** matching satellitemap.space aesthetic.
9. **Every screenshot you take MUST be read and evaluated** before proceeding.
10. **You MUST run `npm run dev` and verify the server is accessible** before taking screenshots.

---

## SECTION 9: LEARNING DIRECTIVE

As you iterate, you will encounter edge cases, rendering bugs, physics inaccuracies, and performance issues. When you do:

1. **Search the web** for solutions. You have full access. Use it.
2. **Read Three.js documentation** for rendering questions.
3. **Read satellite.js source** for SGP4 questions.
4. **Study the Meeus algorithms** for celestial mechanics.
5. **Look at satellitemap.space network requests** to understand what data they fetch.
6. **Apply what you learn immediately** — don't just note it for later.

You are building something that should make you proud. If you look at the screenshot and think "this is mediocre," then it IS mediocre and you MUST improve it. Your standard is: **Would this impress a room of aerospace engineers?** If not, keep going.

---

## SECTION 10: FINAL VERIFICATION CHECKLIST

Before declaring the work complete, every single one of these must be TRUE:

- [ ] Server runs at localhost:5173 without errors
- [ ] Earth is photorealistic, fully opaque, with visible continents
- [ ] 2,000+ orbital objects visible as colored dots orbiting Earth
- [ ] Objects are color-coded by category with toggle pills in top bar
- [ ] Objects animate (move in orbits) in real-time
- [ ] Trajectory line connects launch site on Earth to landing site on Moon
- [ ] Trajectory follows physically accurate curved path
- [ ] 5 launch windows calculated with delta-V and flight time
- [ ] Launch calculation completes in <30 seconds
- [ ] Left sidebar has rocket configuration form
- [ ] Right sidebar shows results
- [ ] Play controls animate the rocket along the trajectory
- [ ] No JavaScript errors in browser console
- [ ] UI matches satellitemap.space quality level
- [ ] N2YO API key is not exposed in client code
- [ ] Moon is positioned at correct distance from Earth
- [ ] ISS is visually prominent with orbit ring
- [ ] Screenshot taken and evaluated at least 3 times during session

**Do not tell me it's done until every box is checked. Evidence before assertions. Always.**
