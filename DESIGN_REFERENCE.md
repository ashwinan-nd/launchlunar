# LaunchLunar — Photoreal Visual Overhaul: Design & Technique Spec

Codebase context (reverse-engineered from this repo before writing recs):
- `src/scene.js` — `LunarScene` class. Already has: custom day/night Earth `ShaderMaterial` (sigmoid-free, uses `smoothstep(-0.15,0.25,NdotL)`), a bump-map normal perturbation via `dFdx/dFdy`, a Fresnel atmosphere shell (`createAtmosphereMaterial`) + outer halo shell, a gradient trajectory `TubeGeometry` + cone arrows, `LineDashedMaterial` orbit rings, and a procedural-canvas rocket built from `ConeGeometry`/`CylinderGeometry`/`BoxGeometry` fins (lines 1442–1560).
- **Orbiting objects are `THREE.Points`** with a `ShaderMaterial` that samples a 64×64 canvas glyph texture per category (`makeGlyphMaterial`, line 128) — this is exactly the "flat squares" complaint: `gl_PointSize` billboards always face the camera and have zero depth, so they never occlude correctly or catch light.
- Moon (`_createMoon`, line 651) loads `/textures/moon.jpg` (single 2K/8K solar-system-scope-style diffuse) with `bumpScale: 0.015` — no displacement, no normal map, so craters are nearly invisible at any zoom.
- Sidebar CSS lives inline in `src/main.js` as a `<style>` template string (`.glass-panel`, `.left-sidebar`, lines ~148–350): flat glassmorphism (`background: rgba(0,0,0,.75); backdrop-filter: blur(12px)`), no neomorphic dual-shadow depth cues.
- `src/style.css` is still the untouched Vite scaffold CSS — not used for the app UI, ignore it.
- No `EffectComposer`/`UnrealBloomPass` anywhere in the repo — all "glow" today is faked via `AdditiveBlending` sprites/emissive materials only. Real bloom is a from-scratch addition.

Everything below is written so a change can be applied directly against these files.

---

## 1. Realistic Earth

### 1.1 Texture sources (free, direct-downloadable)

| Map | Source | URL |
|---|---|---|
| Day (albedo), 2K/8K JPG | Solar System Scope (CC BY 4.0, NASA-derived) | `https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg` |
| Night lights, 2K/8K JPG | Solar System Scope | `https://www.solarsystemscope.com/textures/download/8k_earth_nightmap.jpg` |
| Clouds (alpha), 2K/8K JPG | Solar System Scope | `https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg` |
| Normal map, 2K/8K TIFF | Solar System Scope | `https://www.solarsystemscope.com/textures/download/8k_earth_normal_map.tif` |
| Specular/ocean mask, 2K/8K TIFF | Solar System Scope | `https://www.solarsystemscope.com/textures/download/8k_earth_specular_map.tif` |
| Full-res NASA Blue Marble (5400×2700, ~500m/px, 12 months) | NASA Earth Observatory | `https://assets.science.nasa.gov/dynamicimage/assets/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x5400x2700.jpg` (swap `/august/` + `200408` for any month 200401–200412) |
| NASA Black Marble (night lights, official) | NASA SVS / Earthdata | `https://svs.gsfc.nasa.gov/5475/` (gallery) and `https://www.earthdata.nasa.gov/data/projects/black-marble` |

Use case split: Solar System Scope textures are pre-packaged, seamless, power-of-two, and already equirectangular JPG/TIFF — **use these for production** (drop-in replacement for `/public/textures/earth-*.jpg`, convert the `.tif` files to `.jpg`/`.png` once offline with any image tool since browsers can't decode TIFF). NASA raw Blue Marble/Black Marble are for provenance/attribution or a higher-fidelity offline bake later.
Sources: [solarsystemscope.com/textures](https://www.solarsystemscope.com/textures/), [science.nasa.gov Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/), [NASA Black Marble @ SVS](https://svs.gsfc.nasa.gov/5475/), [Earthdata Black Marble](https://www.earthdata.nasa.gov/data/projects/black-marble).

Action items for `_loadAndBuild()` (scene.js:459): add `earth-normal.jpg`, `earth-specular.jpg` to the `Promise.all` texture list — the current shader only receives `bumpTex`, never a proper tangent-space normal map or specular mask.

### 1.2 Day/night terminator — sharpen it

Current code (scene.js:246) uses `smoothstep(-0.15, 0.25, NdotL)`, which is a decent soft terminator but reads slightly washed out compared to reference implementations that use a **sigmoid** for a crisper line:

```glsl
// replace the smoothstep call with a sharper logistic curve
float dayFactor = 1.0 / (1.0 + exp(-16.0 * NdotL));
```
Higher exponent (`-16` to `-20`) = crisper day/night line; `-8` = current soft look. Reference: [sangillee.com — Create Realistic Earth with Shaders](https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/) uses `1./(1.+exp(-20.*cosAngleSunToNormal))`.

### 1.3 Proper tangent-space normal mapping (replace the dFdx/dFdy hack)

`dFdx(bumpVal)*bumpScale` (scene.js:238) is a screen-space derivative hack — it produces faceted, resolution-dependent noise instead of true relief, and gets *worse* not better at higher texture res. Replace with a real normal map + TBN matrix:

```glsl
// vertex shader — requires geometry.computeTangents() after UVs are set
attribute vec4 tangent;
varying vec3 vTangent;
varying vec3 vBitangent;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vTangent = normalize(normalMatrix * tangent.xyz);
  vBitangent = cross(vNormal, vTangent) * tangent.w;
  ...
}

// fragment shader
vec3 n = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
mat3 TBN = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
vec3 normal = normalize(TBN * n);
```
JS side: `earthGeo.computeTangents()` right after creating `SphereGeometry` (scene.js:553), and load the `earth-normal.jpg` texture with `tex.colorSpace = THREE.NoColorSpace` (normal maps are linear-encoded, never sRGB — a common bug that flattens relief).
Source: [sangillee.com](https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/) (`u_normalPower = 5.0`, `computeTangents()` on `SphereGeometry(1,30,30)`).

### 1.4 Specular ocean mask (real one, not the bump-derived proxy)

Current ocean specular (scene.js:261-264) infers "ocean" from `bumpHeight < 0.3`, which is unreliable since bump values are terrain, not a water mask. Use the dedicated specular map texture instead:

```glsl
uniform sampler2D specularMap; // solarsystemscope 8k_earth_specular_map — white=ocean, black=land
float oceanMask = texture2D(specularMap, vUv).r;
vec3 reflectVec = reflect(-sunDirection, normal);
float specAngle = clamp(dot(reflectVec, normalize(cameraPosition - vWorldPosition)), 0.0, 1.0);
float spec = pow(specAngle, 48.0) * oceanMask;           // tight, glinty highlight
color += vec3(1.0, 0.98, 0.9) * spec * dayFactor * 0.9;  // near-white glint, not blue wash
```
Remap trick used in the reference: `reflectRatio = 0.3*texture.r + 0.1` softens pure-white ocean pixels so the whole ocean doesn't uniformly glare. Source: [sangillee.com](https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/).

### 1.5 Cloud layer with self-shadowing

Current clouds (scene.js:584-596) are a plain `MeshStandardMaterial` sphere at `radius*1.005`, opacity 0.55 — flat, doesn't cast a shadow onto the surface below and doesn't dim on the night side. Two upgrades:
1. **Cloud shadow on Earth**: sample the cloud alpha texture offset toward the sun in the *Earth* fragment shader (needs the cloud texture as a second sampler on the Earth material):
```glsl
uniform sampler2D cloudTexture;
vec3 tbn_inverse_normal = vNormal - sunDirection;         // parallax-style offset
vec2 shadowUV = vUv - 0.0006 * tbn_inverse_normal.xy;      // 0.0006 ≈ cloud height fraction
float cloudShadow = texture2D(cloudTexture, shadowUV).a;
color *= (1.0 - 0.4 * cloudShadow * dayFactor);
```
2. **Clouds dim toward terminator/night** in the cloud material itself (convert to `ShaderMaterial`):
```glsl
vec4 cloud = texture2D(cloudTexture, vUv);
cloud.rgb *= clamp(dayFactor, 0.15, 1.0);   // clouds go dark grey at night, not white
gl_FragColor = vec4(cloud.rgb, cloud.a * clamp(dayFactor, 0.2, 1.0));
```
Source: [sangillee.com](https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/) (RGB-channel-specific attenuation trick for atmospheric color scattering on clouds; magic constant `0.0005` for shadow offset).

### 1.6 Fresnel atmosphere — tune existing shader, don't replace

The current `createAtmosphereMaterial()` (scene.js:279) is already a correct Fresnel rim shader (`BackSide`, `NormalBlending`, `pow(1-dot(N,V), power)`). It's just tuned too subtle (`* 0.25` and `* 0.12` on the two shells). Reference parameter values from working implementations:

```glsl
// Inner atmosphere (tight, bright rim) — scale sphere to EARTH_RADIUS * 1.015 (already correct)
float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 3.0);   // power 3.0–4.0 for tight rim
gl_FragColor = vec4(glowColor, fresnel * 0.6);                // was 0.25 — raise for visibility
```
```glsl
// Outer halo (soft, wide) — scale EARTH_RADIUS * 1.12 (already correct)
float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 5.0);
gl_FragColor = vec4(glowColor, fresnel * 0.25);               // was 0.12
```
Also gate the atmosphere's *day-side* brightness by sun angle (the sangillee approach) so the rim only glows blue on the lit side and goes reddish/dim at the terminator (real atmospheric scattering cue):
```glsl
float sunFacing = 1.0 / (1.0 + exp(-7.0 * (dot(vNormal, sunDirection) + 0.1)));
gl_FragColor = vec4(mix(vec3(0.6,0.3,0.15), glowColor, sunFacing), fresnel * 0.6);
```
Sources: [sangillee.com fresnel/atmosphere section](https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/), [three.js discourse — atmospheric glow effect on globe sphere](https://discourse.threejs.org/t/how-to-create-an-atmospheric-glow-effect-on-surface-of-globe-sphere/32852) (two independent shader approaches with camera-relative Fresnel).

### 1.7 "Earth looks flat/transparent" — root cause checklist

The material is already `transparent:false, depthWrite:true` (scene.js:206-207), so it is *not* literally transparent in the render sense. The "flat/transparent-looking" complaint is almost certainly:
- **No real normal map** → no micro-relief, so lit hemisphere looks like a flat painted disc (fixed by 1.3).
- **Ambient light too high relative to key light**: `AmbientLight(0xffffff, 0.45)` (scene.js:442) is very strong — it flattens all shading on the night side and reduces terminator contrast. Drop to `0.08–0.15` and let the night-lights texture carry night-side visibility instead of ambient fill.
- **No specular occlusion** on land (adds a flat sheen) — gate specular strictly by `oceanMask` (1.4) so land stays matte.
- Missing `earthGeo.computeTangents()` — without it, any future `normalMap` assignment silently no-ops in `MeshStandardMaterial` fallback path, which is the code path taken whenever day/night textures fail to load (scene.js:565-577) — check `/public/textures/` actually contains the files; if the day/night `loadTexture()` calls fail silently, the app has been falling back to a flat `0x1155aa` solid-color sphere the whole time. **Verify textures exist on disk before touching shaders.**

---

## 2. Realistic Moon

### 2.1 NASA CGI Moon Kit (SVS #4720) — official color + displacement maps

Direct URLs (relative to `https://svs.gsfc.nasa.gov`), from [svs.gsfc.nasa.gov/4720](https://svs.gsfc.nasa.gov/4720):

| Map | Resolution | URL |
|---|---|---|
| Color (LROC WAC mosaic), 2019 | 2K JPG | `/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif` |
| Color | 4K / 8K TIFF | `/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif`, `.../lroc_color_poles_8k.tif` |
| Color, 2025 revision (0° lon centered) | 2K JPG | `/vis/a000000/a004700/a004720/lroc_color_2k.jpg` |
| Color 2025 | 8K/16K TIFF | `/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_8k.tif` |
| Displacement (LOLA, low-res, browser-friendly) | 1024×512 8-bit JPG | `/vis/a000000/a004700/a004720/ldem_3_8bit.jpg` |
| Displacement, higher-res | 1440×720 / 5760×2880 TIFF (float km or uint16 half-meters) | `/vis/a000000/a004700/a004720/ldem_4.tif`, `.../ldem_16.tif` |

**No normal map is provided by NASA** — generate one offline from the displacement map (e.g. via a height→normal filter in an image tool, or compute on the fly in-shader from the displacement texture using the same `dFdx/dFdy` trick the Earth shader currently misuses — it's actually *correct* for a true heightmap, just wrong for Earth's already-normal-esque bump texture).
Reference: LOLA data covers 70°N–70°S natively; poles are lower-res LOLA/LDAM fill. Radius reference sphere: 1737.4 km — matches this repo's `MOON_RADIUS = 1737.4/6371 = 0.2727` constant exactly (scene.js:10).

Simpler alternative if NASA's huge TIFFs are impractical: Solar System Scope's single `8k_moon.jpg` (`https://www.solarsystemscope.com/textures/download/8k_moon.jpg`) — note this is color-only, same limitation as today (no displacement/normal), so it improves resolution but not crater relief.

### 2.2 Displacement vs. bump — use real `displacementMap`

Current Moon material (scene.js:656-660) uses `bumpMap: moonTex, bumpScale: 0.015` — reusing the **color** texture as a fake bump map, which produces incorrect relief (bright maria read as "high" when they're actually low, flat lava plains). Fix:

```js
const moonMat = new THREE.MeshStandardMaterial({
  map: moonColorTex,               // lroc_color 8k
  displacementMap: moonHeightTex,  // ldem_16 (real LOLA elevation)
  displacementScale: 0.012,        // tune: MOON_RADIUS units; too high = spiky
  displacementBias: -0.006,
  normalMap: moonNormalTex,        // offline-baked from ldem_16
  normalScale: new THREE.Vector2(0.8, 0.8),
  roughness: 1.0,                  // Moon has ~zero specular; no metalness/gloss
  metalness: 0.0,
});
```
`displacementMap` actually moves vertices (needs geometry with enough segments — current `SphereGeometry(MOON_RADIUS, 64, 64)` is adequate but could go to 128×128 for close-up flyovers), whereas `bumpMap`/normal maps only fake lighting. Combine both: displacement for silhouette-level crater rims visible at the horizon, normal map for micro-crater shading on flat-facing terrain.

### 2.3 Correct phase lighting

The Moon should be lit by the same `sunDirection` as Earth (single global directional light is correct — scene.js already does this via one `sunLight`). Just confirm the Moon material is a lit type (`MeshStandardMaterial`, not `MeshBasicMaterial`) — it already is. For a truer look, drop `roughness` to `0.9` (real regolith has a slight opposition-surge / retroreflective brightening near full-phase) — full physically-based retroreflectance is overkill here; roughness 0.9–1.0 with a low-intensity rim light approximates it well enough.

Sources: [NASA SVS CGI Moon Kit #4720](https://svs.gsfc.nasa.gov/4720), [Solar System Scope textures](https://www.solarsystemscope.com/textures/).

---

## 3. Orbiting Objects — from billboards to real 3D glyphs at scale

### 3.1 Why `THREE.Points` is the "flat squares" bug

`makeGlyphMaterial` (scene.js:128) renders every satellite as a `gl_PointSize`-scaled quad sampling a canvas texture — always camera-facing, unlit, and with **zero real depth**: two overlapping objects at different distances still render as same-size flat squares with no occlusion cue besides raw z-test. This is fine for far zoom (galaxy-view density) but breaks the "look like what they are" requirement at close zoom.

### 3.2 Hybrid LOD strategy (the only approach that scales to ~30k instances *and* looks 3D up close)

| Distance band | Technique | Object count budget |
|---|---|---|
| Far (whole-Earth view, camera dist > ~5 Earth radii) | Keep current `THREE.Points` + glyph canvas (already fast, already implemented) | all ~30k |
| Mid (regional view) | `InstancedMesh` per category with a **real low-poly 3D glyph** (box+panels for satellite, cylinder for rocket body, icosahedron-jittered for debris) | few hundred to ~5k visible after frustum/distance culling |
| Near (single-object inspect / selection) | Swap the picked object to a dedicated hero mesh with full materials + maybe a matcap for fake studio lighting | 1 |

This mirrors the architecture used by [vasturiano/three-globe](https://github.com/vasturiano/three-globe) (points/arcs/hex-bins layered by zoom) and is the standard pattern discussed across Three.js discourse threads on rendering "heavy environments" — see [discourse: most efficient way to display heavy environments](https://discourse.threejs.org/t/the-most-efficient-way-to-display-heavy-environments/39362) and [discourse: many objects caused low FPS](https://discourse.threejs.org/t/many-objects-caused-low-fps-can-we-optimize-it-without-losing-control-over-individual-mesh/76837/6).

### 3.3 InstancedMesh per-category glyph geometries (code sketch)

Build one `InstancedMesh` per category (satellite, debris, rocket body, nav, station), each with a distinct merged `BufferGeometry` so a single draw call renders the whole category:

```js
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function buildSatelliteGlyphGeometry() {
  const body = new THREE.BoxGeometry(0.02, 0.02, 0.03);
  const panelL = new THREE.BoxGeometry(0.05, 0.002, 0.02).translate(-0.045, 0, 0);
  const panelR = new THREE.BoxGeometry(0.05, 0.002, 0.02).translate(0.045, 0, 0);
  return mergeGeometries([body, panelL, panelR]); // one geometry, three "parts"
}

function buildDebrisGlyphGeometry() {
  // irregular: jitter an icosahedron's vertices for a non-uniform silhouette
  const geo = new THREE.IcosahedronGeometry(0.012, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.4 + Math.random() * 0.6;
    pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * jitter, pos.getZ(i) * jitter);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildRocketBodyGlyphGeometry() {
  return new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6);
}

const glyphGeo = { satellite: buildSatelliteGlyphGeometry(), debris: buildDebrisGlyphGeometry(),
                   'rocket body': buildRocketBodyGlyphGeometry() /* ... */ };

const mesh = new THREE.InstancedMesh(
  glyphGeo[category],
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.6 }),
  items.length
);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // positions update every frame from SGP4
const dummy = new THREE.Object3D();
for (let i = 0; i < items.length; i++) {
  dummy.position.set(items[i].position.x, items[i].position.y, items[i].position.z);
  dummy.scale.setScalar(rcsScale(items[i].rcs));       // reuse existing rcsScale() (scene.js:68)
  dummy.lookAt(0, 0, 0);                                // nadir-ish orientation cue (cheap, looks intentional)
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}
mesh.instanceMatrix.needsUpdate = true;
```
Per-frame position updates (already have `updateFromBuffer` scattering a Float32Array by `gidx` — scene.js:1014): for `InstancedMesh` you cannot bulk-write a raw Float32Array into `instanceMatrix` directly per-position without also touching rotation/scale, so either (a) keep `Points` for the bulk far-LOD layer (position-only buffer writes stay trivial there) and only rebuild `InstancedMesh` matrices for the currently-visible near/mid subset each frame, or (b) store position in a custom `InstancedBufferAttribute` (`aOffset`, vec3) and do the offset in the **vertex shader** instead of via matrix decomposition — this is the higher-performance option and avoids per-instance `Object3D`/matrix churn entirely:

```glsl
// vertex shader on the InstancedMesh material (as onBeforeCompile injection, or raw ShaderMaterial)
attribute vec3 aOffset;   // per-instance world position, InstancedBufferAttribute
attribute float aScale;   // per-instance RCS-derived scale
void main() {
  vec3 scaled = position * aScale;
  vec3 worldPos = scaled + aOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
```
Then updating positions is just `aOffset.array.set(buf); aOffset.needsUpdate = true;` — same O(n) flat-buffer write pattern already used in `updateFromBuffer`, just applied to an instanced attribute instead of a `Points` position attribute.

### 3.4 Sizing by RCS (already implemented, keep it)

`RCS_SCALE = { LARGE: 2.2, MEDIUM: 1.45, SMALL: 0.95 }` (scene.js:67) is correct in spirit (radar cross-section proxies physical size) — reuse verbatim for `InstancedMesh` scale instead of `aSize` point size.

### 3.5 Fake depth without per-instance real-time shadow maps

Real shadow-casting from 30k instances is a non-starter (shadow map cost scales with casters, not just receivers). Two matte techniques instead:
1. **Directional-light Lambert shading is "free" depth**: as soon as objects are real meshes with `MeshStandardMaterial`/`MeshLambertMaterial` lit by the existing `sunLight`, each glyph self-shades per-facet — this alone reads as "3D" vs. flat billboards, no shadow maps needed.
2. **Matcap fallback for very small/simple glyphs** (debris specks that are only a few px): `MeshMatcapMaterial` with a pre-baked studio-lit sphere matcap texture gives convincing fake specular/AO with **zero extra lights or shadow cost** — good for the mid-LOD debris tier where per-facet Lambert shading is barely visible at 1–2px screen size anyway.

### 3.6 Performance patterns for ~30k instances

- Keep the existing `Points` bulk-catalog layer as the default view (it's already fast — one draw call per category, position-only buffer writes). This is correct and should not be thrown away.
- Only build `InstancedMesh` glyph layers for objects inside a distance/frustum cutoff (e.g. camera distance < 15 Earth radii AND within view frustum) — recompute the visible-subset index list once every N frames (e.g. every 10 frames / ~166ms), not every frame.
- Set `mesh.frustumCulled = true` for `InstancedMesh` (unlike the `Points` layers which intentionally disable culling at scene.js:901/847 because the whole catalog must always be candidate for picking) — `InstancedMesh` computes a single bounding sphere over all instances by default in older three revisions, so also call `mesh.computeBoundingSphere()` after populating, or set a manual large bounding sphere to avoid incorrect culling.
- Batch `setColorAt`/`instanceColor` only if per-instance color varies within a category (currently color is category-uniform, so a single material color is cheaper — skip `instanceColor` entirely).
- Use `BatchedMesh` (three.js r159+) instead of multiple `InstancedMesh` objects if categories need to share one draw call in the future — not required now since category count is small (~10).

Sources: [waelyasmina.net — Instanced Rendering in Three.js](https://waelyasmina.net/articles/instanced-rendering-in-three-js/) (setMatrixAt/setColorAt patterns, `instanceMatrix.needsUpdate` requirement), [discourse: many objects caused low FPS](https://discourse.threejs.org/t/many-objects-caused-low-fps-can-we-optimize-it-without-losing-control-over-individual-mesh/76837/6), [discourse: most efficient way to display heavy environments](https://discourse.threejs.org/t/the-most-efficient-way-to-display-heavy-environments/39362), [vasturiano/three-globe](https://github.com/vasturiano/three-globe) (reference multi-layer globe viz architecture), [tympanus/codrops — Three.js Instances](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/).

---

## 4. High-risk conjunction highlighting — selective bloom

### 4.1 Technique: two-composer selective bloom (the standard three.js pattern)

Rather than a global `UnrealBloomPass` (which would bloom the whole bright Earth day-side), use **layer-gated selective bloom**: darken everything except flagged objects, bloom that pass, composite back over the normal render.

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const materialCache = new Map();

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.6, 0.4, 0.15);
// (strength, radius, threshold) — threshold LOW (0.1–0.2) since risk markers are the only bloom source now
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `
    uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
    void main(){ gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv); }
  `,
}), 'baseTexture');

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderScene);
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

function renderFrame() {
  scene.traverse((obj) => {
    if (obj.isMesh && !bloomLayer.test(obj.layers)) {
      materialCache.set(obj.uuid, obj.material);
      obj.material = darkMaterial;
    }
  });
  bloomComposer.render();
  scene.traverse((obj) => {
    if (materialCache.has(obj.uuid)) { obj.material = materialCache.get(obj.uuid); materialCache.delete(obj.uuid); }
  });
  finalComposer.render();
}
```
Assign a conjunction-risk object to bloom: `riskMesh.layers.enable(BLOOM_LAYER);` (its base scene layer 0 membership is untouched, so it still renders normally in the base pass).

### 4.2 Emissive red material for the flagged object/marker

```js
const riskMat = new THREE.MeshStandardMaterial({
  color: 0xff2222,
  emissive: 0xff0000,
  emissiveIntensity: 3.0,   // > 1.0 relies on tone mapping + bloom threshold to punch through
  toneMapped: false,        // IMPORTANT: keeps the raw emissive value un-clamped by ACES so bloom threshold sees a hot pixel
});
```
`renderer.toneMapping = THREE.ACESFilmicToneMapping` is already set (scene.js:414) — for bloom to pick up "hot" emissive colors reliably, either keep `emissiveIntensity` well above 1.0 and `toneMapped:false` on the flagged material, or lower `bloomPass.threshold` so normal-brightness reds also qualify.

This repo already has `showConjunctionMarkers()` (scene.js:1203) building `MeshBasicMaterial` red/orange dots+rings — minimal change: swap to the emissive material above and `dot.layers.enable(BLOOM_LAYER)` / `ring.layers.enable(BLOOM_LAYER)`.

Sources: [official three.js selective bloom example](https://threejs.org/examples/?q=sele#webgl_postprocessing_unreal_bloom_selective) (canonical implementation this pattern is copied from), [waelyasmina.net — Selective Unreal Bloom in Three.js Post-Processing](https://waelyasmina.net/articles/unreal-bloom-selective-threejs-post-processing/) (full walkthrough + lil-gui tunable params: threshold 0/strength 1/radius 0.5/exposure 1.5), [discourse: selective bloom effect](https://discourse.threejs.org/t/selective-bloom-effect-pilot-light-on-off/52244).

---

## 5. Neomorphism / advanced sidebar CSS

Current sidebar (`main.js` inline `<style>`, `.left-sidebar`/`.glass-panel`, ~line 148–274) is flat glassmorphism: `background: rgba(0,0,0,.75); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,.06)`. For a dark space dashboard, **pure neomorphism (light+dark dual shadow on a same-color background) reads poorly on near-black** because it depends on subtle luminance steps that black backgrounds crush. The practical answer used by real dark dashboards is a **hybrid: glassmorphism base + neomorphic dual-shadow depth + a thin gradient border for edge definition.**

### 5.1 Base panel — dark neomorphic-glass hybrid

```css
:root {
  --panel-bg: #12141c;          /* slightly lighter than pure black so shadows read */
  --panel-radius: 18px;
  --shadow-dark: rgba(0, 0, 0, 0.55);
  --shadow-light: rgba(255, 255, 255, 0.04);  /* faux "highlight" since there's no real light source in space UI */
  --accent-glow: rgba(64, 156, 255, 0.35);
}

.glass-panel {
  background: linear-gradient(145deg, #14161f, #0e1016);
  border-radius: var(--panel-radius);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow:
    8px 8px 20px var(--shadow-dark),        /* dark shadow, bottom-right = light "from" top-left */
    -6px -6px 16px var(--shadow-light),     /* faint highlight, top-left */
    inset 0 1px 0 rgba(255, 255, 255, 0.03), /* 1px inner top highlight = beveled edge */
    0 0 24px var(--accent-glow);            /* soft accent bloom around the whole panel */
}
```

### 5.2 Pressed / active state (inset shadow flip — the neomorphic "signature" move)

```css
.control-btn {
  border-radius: 12px;
  background: linear-gradient(145deg, #14161f, #0e1016);
  box-shadow: 4px 4px 10px var(--shadow-dark), -4px -4px 10px var(--shadow-light);
  transition: box-shadow 0.15s ease, transform 0.1s ease;
}
.control-btn:active,
.control-btn.pressed {
  box-shadow: inset 3px 3px 6px var(--shadow-dark), inset -3px -3px 6px var(--shadow-light);
  transform: scale(0.98);
}
```

### 5.3 Inset "data well" for readouts (telemetry numbers, sliders track)

```css
.telemetry-well {
  background: #0a0b10;
  border-radius: 10px;
  box-shadow: inset 2px 2px 5px rgba(0,0,0,0.6), inset -2px -2px 5px rgba(255,255,255,0.03);
  padding: 8px 12px;
}
```

### 5.4 Accent-colored glow border for the active/selected state (replaces plain `border-color` swap)

```css
.left-sidebar {
  position: relative;
}
.left-sidebar::before {
  content: '';
  position: absolute; inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(64,156,255,0.6), rgba(170,59,255,0.3), transparent 60%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none;
}
```
This is the standard "gradient border via mask" trick — a real 1px gradient-colored border without needing an extra wrapper element.

### 5.5 Risk/status color coding consistent with the 3D scene

Reuse the same reds/oranges as the conjunction markers so the sidebar and 3D view read as one system:
```css
.risk-critical { color: #ff4444; text-shadow: 0 0 8px rgba(255,68,68,0.6); }
.risk-warning  { color: #ffaa00; text-shadow: 0 0 6px rgba(255,170,0,0.4); }
.risk-nominal  { color: #00e0ff; text-shadow: 0 0 6px rgba(0,224,255,0.35); }
```

Sources: [CSS-Tricks — Neumorphism and CSS](https://css-tricks.com/neumorphism-and-css/) (dual-shadow syntax, inset-for-pressed convention, contrast/border-radius rules), [neumorphism.io generator](https://neumorphism.io/) (interactive parameter reference for tuning distance/blur/intensity), [freefrontend.com neumorphism examples](https://freefrontend.com/css-neumorphism-examples/) (dark-theme variants).

---

## 6. Trajectory line rendering

Current `createTrajectoryMaterial()` (scene.js:318-362) already does gradient (white→yellow→red via `vUv.x`) + animated dash (`sin(vUv.x*dashScale - time*3.0)`) + a separate low-opacity `BackSide` glow tube (scene.js:1157-1168). This is close to right; concrete upgrades:

### 6.1 Additive blending for the glow tube (currently `NormalBlending` default)

```js
const glowMat = new THREE.MeshBasicMaterial({
  color, transparent: true, opacity: 0.35, depthWrite: false,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,   // was default NormalBlending — additive makes overlaps punch brighter, reads as "glow" not "translucent paint"
});
```

### 6.2 True falloff-based glow shader (replace the flat-opacity `BackSide` proxy tube)

The current glow tube is a second larger tube at constant `opacity:0.1` — no actual gradient falloff from core to edge. A dedicated fake-glow shader gives a real radial falloff along the tube's cross-section:
```js
// FakeGlowMaterial pattern — apply to the outer tube instead of MeshBasicMaterial
const glowMat = new THREE.ShaderMaterial({
  uniforms: {
    glowColor: { value: new THREE.Color(color) },
    falloff: { value: 0.15 },
    glowSharpness: { value: 0.6 },
  },
  vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform vec3 glowColor; uniform float falloff; uniform float glowSharpness;
    varying vec3 vNormal;
    void main(){
      float intensity = pow(1.0 - abs(vNormal.z), 2.0 - glowSharpness);
      gl_FragColor = vec4(glowColor, intensity * falloff * 3.0);
    }`,
  transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
});
```
Reference implementation to port from directly: [ektogamat/fake-glow-material-threejs](https://github.com/ektogamat/fake-glow-material-threejs) (MIT license; defaults `falloff:0.1, glowInternalRadius:6.0, glowColor:'#00d5ff', glowSharpness:0.5, opacity:1.0` — README notes it needs smooth geometry, which `TubeGeometry` already is, unlike sharp boxes).

### 6.3 Feed the trajectory tube into the bloom layer

Since section 4 adds selective bloom, put the trajectory glow tube on `BLOOM_LAYER` too — a glowing bloomed trajectory reads as "energetic/live" vs. the current flat additive sprite look:
```js
glowMesh.layers.enable(BLOOM_LAYER);
```

### 6.4 Dash direction/speed tuning

Current `dashScale: 30.0`, animated via `time*3.0` — keep, but consider slowing to `time*1.2` for a calmer "in-flight" feel vs. the current fast strobe (fast dashes read as urgent/alarm, which conflicts with the calmer nominal-trajectory use case; reserve fast strobing for the risk markers only).

Sources: [github.com/ektogamat/fake-glow-material-threejs](https://github.com/ektogamat/fake-glow-material-threejs), [tympanus/codrops — High-speed Light Trails in Three.js](https://tympanus.net/codrops/2019/11/13/high-speed-light-trails-in-three-js/) (instanced-tube pattern, per-instance `aOffset`/`aMetrics` attributes, vertical-lift trick `offsetY = radius*1.3`), [three.js discourse — glow effect to LineBasicMaterial without bloom](https://discourse.threejs.org/t/glow-effect-to-linebasicmaterial-without-bloom/84313).

---

## 7. Rocket model

### 7.1 Keep the procedural approach, upgrade proportions + stage count

The current `createRocket()` (scene.js:1442) builds a **single-stage** rocket (one nose, one body cylinder, one band, one nozzle, 4 fins). A Saturn-V-*ish* silhouette needs at minimum 3 visually distinct stages with tapering diameters and interstage rings — this is cheap to add since it's the same primitive-based approach already in place:

```js
// Saturn V real proportions (for reference ratios, not exact scale):
// S-IC (stage 1): 42m tall, 10.1m dia   → height fraction ~0.40, radius fraction 1.0 (widest)
// S-II (stage 2): 24.8m tall, 10.1m dia → height fraction ~0.24, radius fraction 1.0
// S-IVB (stage 3): 17.8m tall, 6.6m dia → height fraction ~0.17, radius fraction 0.65
// Instrument Unit + CSM/LM stack + LES: remaining ~0.19, radius fraction 0.35–0.5, LES cone at tip

function buildStage(rBottom, rTop, hFrac, yCenter, colorHex, group, disposables) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, hFrac, 16); // 16 sides now, not 8 — smoother silhouette
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.55 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = yCenter;
  group.add(mesh);
  disposables.push(geo, mat);
  return mesh;
}
```
Stack three `buildStage()` calls top-to-bottom with slightly decreasing radius (S-IC widest at base, S-IVB narrowest near the top), add a thin darker `interstage ring` cylinder (short, slightly larger radius) between each pair for the visual "joint" cue real rockets have, keep the existing 4-fin loop at the base of the widest stage, and keep the existing nose cone + engine nozzle + exhaust sprite logic as-is (already reasonable).

### 7.2 Increase radial segments for smoother silhouette

Current `CylinderGeometry(r, r, h*0.55, 8)` uses 8 sides — visibly faceted at close zoom. Bump to 16–24 for the body, keep 6–8 for tiny fins/nozzle where facets aren't noticeable.

### 7.3 Free GLTF alternative (if procedural stacking isn't enough fidelity)

Sketchfab has several Saturn V models; **verify license before using** — Sketchfab requires checking each model's individual license tag (CC0, CC-BY, or "Standard" non-commercial) at download time, this couldn't be confirmed via fetch for the specific low-poly candidate found (`sketchfab.com/3d-models/low-poly-saturn-v-791ca88f35f742549175733a811f2aad`, 360 tris/240 verts — extremely light, good for InstancedMesh-style rendering, but described as a Minecraft/Blockbench asset so *visual fidelity is low*, not photoreal). Better candidates to manually check on Sketchfab (all require login + license check per model, cannot be verified via automated fetch):
- `sketchfab.com/3d-models/apollo-saturn-v-launch-vehicle-7c61146069134981a84dc7ed951609a0`
- `sketchfab.com/3d-models/saturn-v-nasa-7a2c9709ff8144c8b3b18ec84b5e112e`
- `sketchfab.com/3d-models/nasa-saturn-v-spacecraft-rocket-pbr-5e9596fe0bea4588aeb0865be5449a49` (PBR — best fit if license is CC0/CC-BY)

**Recommendation: stick with the upgraded procedural multi-stage approach (7.1)** — it's already implemented, has zero licensing risk, animates/scales trivially with the existing `heightM`/`radiusM` params, and matches the low-poly aesthetic of the rest of the scene (glyphs, debris) better than importing a mismatched-style GLTF.

Source note: proportions above are well-known public Saturn V dimensions (NASA historical specs), not from a single fetched source — cross-check against [NASA history pages](https://www.nasa.gov) if exact accuracy matters; this spec treats them as "convincing," not archival.

---

## 8. Smooth animation

### 8.1 Frame-rate-independent damping (replace any fixed-fraction lerp)

A naive `position.lerp(target, 0.1)` runs at a different *effective* speed depending on frame rate (60fps vs. 144fps monitors converge at different real-world speeds). The standard fix is exponential-decay-based damping using `delta` from `THREE.Clock`:

```js
// generic frame-rate-independent damp, drop-in replacement for `lerp(target, k)`
function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
// usage inside the render loop:
const dt = clock.getDelta();
camera.position.x = damp(camera.position.x, targetX, 8.0, dt); // lambda ~4–10 for camera moves
```
This is the same mathematical basis `OrbitControls` uses internally for its own `dampingFactor` (the existing `controls.dampingFactor = 0.08` at scene.js:433 is already frame-based internally via three.js's own delta handling — no change needed there). Apply the `damp()` helper anywhere a manual lerp exists for camera-follow / rocket-follow logic (`this._followRocket`, `this._followMoon` flags at scene.js:402-403) instead of a fixed-alpha `lerp()`.

### 8.2 `THREE.Clock` delta usage pattern (already partially in place — `this.clock = new THREE.Clock()` at scene.js:370)

```js
function animate() {
  requestAnimationFrame(animate);
  const dt = this.clock.getDelta();           // seconds since last frame, handles variable frame rate
  this.earth.rotation.y += EARTH_ROTATION_SPEED * dt * 1000; // if speeds were tuned per-ms, scale accordingly
  this.controls.update();                      // required every frame when enableDamping=true
  this.renderer.render(this.scene, this.camera);
}
```
Verify the existing render loop actually multiplies rotation speeds by `dt` rather than a fixed per-frame increment — constants like `EARTH_ROTATION_SPEED = 0.0001` (scene.js:13) suggest a fixed-per-frame-call increment, which will visibly change rotation speed if the tab was backgrounded (RAF pauses, then a huge `dt` on resume) or on variable-refresh displays. Multiply all such per-frame deltas by `clock.getDelta()` and rescale the magic-number constants accordingly.

### 8.3 GSAP already in use (scene.js imports `gsap` at line 3) — keep it for scripted camera moves

GSAP is well-suited for one-shot cinematic camera transitions (launch cutscene, "fly to Moon" button) — the repo already depends on it (`this._cameraAnim` at scene.js:401). Use GSAP `.to()` with `ease: 'power2.inOut'` for camera moves, and reserve the `damp()` exponential-decay approach (8.1) for continuous per-frame follow behavior (camera chasing a moving rocket) where GSAP's fixed-duration tweens are the wrong tool (target keeps moving, so there's no fixed end state to tween toward).

### 8.4 General RAF hygiene

- Single `requestAnimationFrame` loop for the whole app (verify there isn't a second implicit loop from `OrbitControls`' own `change` event triggering redundant renders — the sbcode.net tutorial explicitly flags this double-render bug: [sbcode.net/threejs/animation-loop](https://sbcode.net/threejs/animation-loop/)).
- Cap `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` — already done (scene.js:411) — correct, prevents 3x/4x DPR mobile devices from tanking fps.
- Pause/reduce update rate for off-screen or minimized state via the Page Visibility API (`document.hidden`) to avoid the huge-`dt` jump problem entirely rather than just clamping it.
- Clamp `dt` to a sane max (e.g. `Math.min(clock.getDelta(), 0.1)`) so a backgrounded-tab resume doesn't cause a visible teleport/jump in damped values.

Sources: general frame-independent exponential smoothing is a widely documented game-dev technique (formula `value += (target-value) * (1-Math.exp(-lambda*dt))`, equivalently `damp()` above); [sbcode.net — Animation Loop](https://sbcode.net/threejs/animation-loop/) (RAF loop pattern, redundant-render-on-controls-change pitfall); GSAP docs for `ease` curves (`power2.inOut`, `power3.out` for camera arrival easing) at [gsap.com/docs/v3/Eases](https://gsap.com/docs/v3/Eases/).

---

## Priority order (highest visual impact per engineering effort)

1. **Verify Earth/Moon textures actually load** (section 1.7 checklist) — if they're silently 404ing, every shader fix above is moot.
2. Real tangent-space Earth normal map + specular mask (1.3, 1.4) — single biggest "photoreal vs flat" lever.
3. Moon displacement + normal map from NASA CGI Moon Kit (2.1–2.2) — currently the weakest visual element.
4. Selective bloom for conjunction risk (4.1–4.2) — highest "wow" for the amount of new code (one composer setup, reused everywhere).
5. Sidebar neomorphic dual-shadow pass (5.1–5.4) — pure CSS, no engine risk, fast to ship.
6. InstancedMesh mid/near-LOD glyphs (3.2–3.3) — highest effort, do after the above are solid since it touches the update loop architecture.
7. Multi-stage rocket (7.1) and trajectory glow upgrade (6.1–6.2) — polish pass.
8. Damping/delta-time audit (8.1–8.4) — do last as a stability/QA pass once visuals are locked.
