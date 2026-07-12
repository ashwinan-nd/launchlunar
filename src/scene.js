import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { SelectiveBloom, BLOOM_LAYER } from './postprocessing.js';
import { computeGmst } from './orbital.js';

// LOD: camera distance (Earth radii, camera-to-origin) below which the 3D
// instanced glyph tier replaces the flat THREE.Points billboards. Kept below
// the ~5.4-radii default view so the whole-Earth view stays on fast Points.
const LOD_NEAR_DIST = 4.0;
// Objects within this distance of the camera are promoted to instanced glyphs.
const LOD_INSTANCE_CUTOFF = 5.0;
// Per-category instance cap (bounds worst-case draw / matrix churn).
const LOD_MAX_PER_CATEGORY = 12000;
// Rebuild the visible instanced subset every N frames (not every frame).
const LOD_REBUILD_INTERVAL = 8;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EARTH_RADIUS = 1.0;
const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS = 0.2727; // 1737.4 / 6371
const MOON_DISTANCE = 60.3; // ~384400 / 6371
const EARTH_SEGMENTS = 128;
const CLOUD_ROTATION_SPEED = 0.000035;
const MOON_ORBIT_SPEED = 0.00005;
const EARTH_AXIAL_TILT = 23.5 * (Math.PI / 180);
const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// Category colours (hex values for THREE.Color / PointsMaterial)
const CATEGORY_COLORS = {
  satellite: 0xaa66ff,
  debris: 0xff4444,
  'rocket body': 0xff8c00,
  rocket_body: 0xff8c00,
  iss: 0xffd700,
  starlink: 0x00bfff,
  oneweb: 0x22d3ee,
  iridium: 0x14b8a6,
  gps: 0x32cd32,
  glonass: 0xff6347,
  galileo: 0xa3e635,
  beidou: 0xf472b6,
  weather: 0x87ceeb,
  station: 0xffd700,
};

function getCategoryColorHex(category) {
  const key = category.toLowerCase();
  return CATEGORY_COLORS[key] ?? 0xcccccc;
}

// Point sizes by category (screen-space pixels, sizeAttenuation: false)
const CATEGORY_POINT_SIZES = {
  iss: 8,
  station: 5,
  satellite: 1.5,
  gps: 2.5,
  glonass: 2.5,
  galileo: 2.5,
  beidou: 2.5,
  starlink: 1.0,
  oneweb: 1.0,
  iridium: 1.5,
  debris: 1.0,
  'rocket body': 1.5,
  rocket_body: 1.5,
  weather: 2.0,
};

function getPointSize(category) {
  const key = category.toLowerCase();
  return CATEGORY_POINT_SIZES[key] ?? 3;
}

// RCS size class -> relative scale multiplier (real objects sized by radar cross-section).
// Global glyph-size damper: the base geometries are visibility-exaggerated, so at
// close LOD thousands of LEO objects overlapped into a solid wall. 0.5 keeps them
// individually readable while still visible.
const GLYPH_SIZE = 0.5;
const RCS_SCALE = { LARGE: 2.2, MEDIUM: 1.45, SMALL: 0.95 };
function rcsScale(rcs) { return (RCS_SCALE[rcs] ?? 0.85) * GLYPH_SIZE; }

// Frame-rate-independent exponential damping (spec §8.1).
// Returns the new value moved toward target; identical convergence at any dt.
function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
function dampVec3(current, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  current.x += (target.x - current.x) * k;
  current.y += (target.y - current.y) * k;
  current.z += (target.z - current.z) * k;
}

// ---------------------------------------------------------------------------
// 3D glyph geometries for the instanced mid/near-LOD tier — objects "look like
// what they are" when zoomed in. Small (scene units; Earth radius = 1) and
// merged so each category renders in a single draw call.
// ---------------------------------------------------------------------------
// Bake a uniform grayscale vertex color onto a geometry part so merged glyphs
// carry per-component shading (bright metallic bus, dark solar panels, gold
// foil) that reads as depth/layering under the instanced material's
// vertexColors — while still multiplying by the per-category hue.
function tintPart(geo, shade) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function buildSatelliteGlyphGeometry() {
  // Bus + twin dual-segment solar arrays + a nadir comms dish.
  const body = tintPart(new THREE.BoxGeometry(0.006, 0.006, 0.010), 1.25);
  const boomL = tintPart(new THREE.BoxGeometry(0.006, 0.0006, 0.0018).translate(-0.007, 0, 0), 0.9);
  const boomR = tintPart(new THREE.BoxGeometry(0.006, 0.0006, 0.0018).translate(0.007, 0, 0), 0.9);
  const panelL1 = tintPart(new THREE.BoxGeometry(0.009, 0.0006, 0.006).translate(-0.015, 0, 0), 0.5);
  const panelL2 = tintPart(new THREE.BoxGeometry(0.009, 0.0006, 0.006).translate(-0.025, 0, 0), 0.45);
  const panelR1 = tintPart(new THREE.BoxGeometry(0.009, 0.0006, 0.006).translate(0.015, 0, 0), 0.5);
  const panelR2 = tintPart(new THREE.BoxGeometry(0.009, 0.0006, 0.006).translate(0.025, 0, 0), 0.45);
  const dish = tintPart(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0016, 8).rotateX(Math.PI / 2).translate(0, -0.005, 0), 1.4);
  const geo = mergeGeometries([body, boomL, boomR, panelL1, panelL2, panelR1, panelR2, dish]);
  [body, boomL, boomR, panelL1, panelL2, panelR1, panelR2, dish].forEach((g) => g.dispose());
  return geo;
}
function buildDebrisGlyphGeometry() {
  // Irregular tumbling fragment: jitter an icosahedron + a smaller shard.
  const main = new THREE.IcosahedronGeometry(0.005, 0);
  const pos = main.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const j = 0.45 + Math.random() * 0.85;
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
  }
  main.computeVertexNormals();
  tintPart(main, 1.0);
  const shard = tintPart(new THREE.TetrahedronGeometry(0.003, 0).translate(0.004, 0.003, 0.002), 0.7);
  const geo = mergeGeometries([main, shard]);
  main.dispose(); shard.dispose();
  return geo;
}
function buildRocketGlyphGeometry() {
  // Spent stage: cylinder body + a flared nozzle bell + interstage ring.
  const body = tintPart(new THREE.CylinderGeometry(0.0028, 0.0028, 0.016, 10), 1.15);
  const ring = tintPart(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0018, 10).translate(0, 0.006, 0), 0.6);
  const bell = tintPart(new THREE.ConeGeometry(0.0034, 0.004, 10, 1, true).translate(0, -0.010, 0), 0.75);
  const geo = mergeGeometries([body, ring, bell]);
  body.dispose(); ring.dispose(); bell.dispose();
  return geo;
}
function buildStationGlyphGeometry() {
  // ISS-like: core module + long truss + four large array wings.
  const core = tintPart(new THREE.CylinderGeometry(0.004, 0.004, 0.014, 10).rotateZ(Math.PI / 2), 1.25);
  const truss = tintPart(new THREE.BoxGeometry(0.034, 0.0012, 0.0018), 0.8);
  const wings = [];
  for (const [sx, sz] of [[-0.013, 0.006], [-0.013, -0.006], [0.013, 0.006], [0.013, -0.006]]) {
    wings.push(tintPart(new THREE.BoxGeometry(0.012, 0.0006, 0.005).translate(sx, 0, sz), 0.5));
  }
  const geo = mergeGeometries([core, truss, ...wings]);
  core.dispose(); truss.dispose(); wings.forEach((w) => w.dispose());
  return geo;
}
function buildNavGlyphGeometry() {
  // GNSS bird: octahedral bus + two panel wings.
  const bus = tintPart(new THREE.OctahedronGeometry(0.006, 0), 1.3);
  const wL = tintPart(new THREE.BoxGeometry(0.012, 0.0006, 0.006).translate(-0.012, 0, 0), 0.5);
  const wR = tintPart(new THREE.BoxGeometry(0.012, 0.0006, 0.006).translate(0.012, 0, 0), 0.5);
  const geo = mergeGeometries([bus, wL, wR]);
  bus.dispose(); wL.dispose(); wR.dispose();
  return geo;
}
function buildDefaultGlyphGeometry() {
  return tintPart(new THREE.BoxGeometry(0.007, 0.007, 0.007), 1.0);
}
function buildGlyphGeometry(shape) {
  switch (shape) {
    case 'satellite': return buildSatelliteGlyphGeometry();
    case 'debris': return buildDebrisGlyphGeometry();
    case 'rocket': return buildRocketGlyphGeometry();
    case 'station': return buildStationGlyphGeometry();
    case 'nav': return buildNavGlyphGeometry();
    default: return buildDefaultGlyphGeometry();
  }
}

// ---------------------------------------------------------------------------
// Per-category glyph textures — objects "look like what they are"
// ---------------------------------------------------------------------------
const _glyphCache = new Map();
function glyphShapeFor(category) {
  const c = category.toLowerCase();
  if (c === 'debris') return 'debris';
  if (c === 'rocket body' || c === 'rocket_body') return 'rocket';
  if (c === 'iss' || c === 'station') return 'station';
  if (c === 'gps' || c === 'glonass' || c === 'galileo' || c === 'beidou') return 'nav';
  if (c === 'weather') return 'disc';
  return 'satellite'; // satellite/starlink/oneweb/iridium: body + panels
}

function getGlyphTexture(shape) {
  if (_glyphCache.has(shape)) return _glyphCache.get(shape);
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.fillStyle = '#ffffff';
  x.strokeStyle = '#ffffff';
  const cx = S / 2, cy = S / 2;
  if (shape === 'satellite') {
    // central body + two solar panels
    x.fillRect(cx - 6, cy - 6, 12, 12);
    x.fillRect(cx - 26, cy - 4, 16, 8);
    x.fillRect(cx + 10, cy - 4, 16, 8);
  } else if (shape === 'rocket') {
    // elongated capsule
    x.beginPath();
    x.roundRect ? x.roundRect(cx - 6, cy - 22, 12, 44, 6) : x.rect(cx - 6, cy - 22, 12, 44);
    x.fill();
  } else if (shape === 'station') {
    // large H / truss
    x.fillRect(cx - 4, cy - 22, 8, 44);
    x.fillRect(cx - 24, cy - 6, 48, 12);
  } else if (shape === 'nav') {
    // diamond
    x.beginPath();
    x.moveTo(cx, cy - 22); x.lineTo(cx + 22, cy); x.lineTo(cx, cy + 22); x.lineTo(cx - 22, cy);
    x.closePath(); x.fill();
  } else if (shape === 'disc') {
    x.beginPath(); x.arc(cx, cy, 20, 0, TWO_PI); x.fill();
  } else if (shape === 'debris') {
    // irregular jagged speck
    x.beginPath();
    const pts = [[0,-18],[10,-6],[20,2],[6,8],[10,20],[-4,12],[-18,16],[-12,0],[-20,-8],[-6,-10]];
    pts.forEach((p, i) => { const px = cx + p[0], py = cy + p[1]; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath(); x.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  _glyphCache.set(shape, tex);
  return tex;
}

function makeGlyphMaterial(colorHex, glyphTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uTex: { value: glyphTex },
      uPixel: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uPixel;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixel;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uTex;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        if (t.a < 0.35) discard;
        gl_FragColor = vec4(uColor, t.a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Texture Loader with multi-URL fallback
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();

/**
 * Try loading a texture from a list of URLs. Returns the first that succeeds,
 * or null if all fail.
 * @param {...string} urls
 * @returns {Promise<THREE.Texture|null>}
 */
function loadTexture(...urls) {
  const validUrls = urls.filter(Boolean);
  if (validUrls.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let idx = 0;
    function tryNext() {
      if (idx >= validUrls.length) {
        resolve(null);
        return;
      }
      const url = validUrls[idx++];
      textureLoader.load(
        url,
        (tex) => resolve(tex),
        undefined,
        () => tryNext(),
      );
    }
    tryNext();
  });
}

// ---------------------------------------------------------------------------
// Earth Day/Night Shader — opaque, tangent-space normal map, sigmoid
// terminator, real ocean-mask specular, cloud self-shadow.
// ---------------------------------------------------------------------------
function createEarthShaderMaterial(dayTex, nightTex, normalTex, specularTex, cloudTex) {
  const uniforms = {
    dayTexture: { value: dayTex },
    nightTexture: { value: nightTex },
    normalMap: { value: normalTex },
    specularMap: { value: specularTex },
    cloudTexture: { value: cloudTex },
    sunDirection: { value: new THREE.Vector3(1.0, 0.3, 0.5).normalize() },
    normalScale: { value: 1.1 },
    hasNormal: { value: normalTex ? 1.0 : 0.0 },
    hasSpecular: { value: specularTex ? 1.0 : 0.0 },
    hasClouds: { value: cloudTex ? 1.0 : 0.0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    depthWrite: true,
    vertexShader: /* glsl */ `
      attribute vec4 tangent;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldTangent;
      varying vec3 vWorldBitangent;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        mat3 m = mat3(modelMatrix);
        vWorldNormal = normalize(m * normal);
        vWorldTangent = normalize(m * tangent.xyz);
        vWorldBitangent = normalize(cross(vWorldNormal, vWorldTangent) * tangent.w);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayTexture;
      uniform sampler2D nightTexture;
      uniform sampler2D normalMap;
      uniform sampler2D specularMap;
      uniform sampler2D cloudTexture;
      uniform vec3 sunDirection;
      uniform float normalScale;
      uniform float hasNormal;
      uniform float hasSpecular;
      uniform float hasClouds;

      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldTangent;
      varying vec3 vWorldBitangent;
      varying vec3 vWorldPosition;

      void main() {
        vec3 sunDir = normalize(sunDirection);

        // --- Tangent-space normal mapping (real relief, not dFdx hack) ---
        vec3 normal = normalize(vWorldNormal);
        if (hasNormal > 0.5) {
          vec3 nTex = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
          nTex.xy *= normalScale;
          mat3 TBN = mat3(normalize(vWorldTangent), normalize(vWorldBitangent), normal);
          normal = normalize(TBN * nTex);
        }

        float NdotL = dot(normal, sunDir);

        // --- Sharper (logistic) day/night terminator ---
        float dayFactor = 1.0 / (1.0 + exp(-16.0 * NdotL));

        vec3 dayColor = texture2D(dayTexture, vUv).rgb;
        vec3 nightColor = texture2D(nightTexture, vUv).rgb;

        // Subtle vegetation boost
        dayColor.g *= 1.08;

        // Night side = a strong "earthshine" of the real surface texture PLUS
        // city lights. Keeping the night hemisphere at a detailed ~28% of the
        // day texture (very slightly cool-tinted) means the whole globe always
        // reads as a solid, detailed planet from every angle instead of a
        // near-black void that looks transparent against space.
        vec3 earthshine = dayColor * vec3(0.24, 0.26, 0.30);
        vec3 nightLights = nightColor * 1.6;
        vec3 nightSide = earthshine + nightLights;

        vec3 color = mix(nightSide, dayColor, dayFactor);

        // --- Ocean specular gated by the specular (ocean) mask ---
        if (hasSpecular > 0.5) {
          float oceanMask = texture2D(specularMap, vUv).r;
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 reflectVec = reflect(-sunDir, normal);
          float specAngle = clamp(dot(reflectVec, viewDir), 0.0, 1.0);
          float spec = pow(specAngle, 48.0) * oceanMask;
          color += vec3(1.0, 0.98, 0.9) * spec * dayFactor * 0.9;
        }

        // --- Atmospheric scattering at the terminator ---
        // Warm Rayleigh/Mie sunset glow where the sun grazes the limb (NdotL
        // near 0), fading into the day side — the orange→blue band that makes a
        // real Earth photo read as a lit atmosphere, not a flat texture.
        float termBand = exp(-NdotL * NdotL * 42.0);          // peak at terminator
        float dayApproach = smoothstep(-0.25, 0.15, NdotL);   // day-facing only
        vec3 sunsetColor = vec3(1.0, 0.42, 0.18);
        color += sunsetColor * termBand * dayApproach * 0.22;
        // A faint cool high-atmosphere haze across the lit hemisphere.
        color += vec3(0.10, 0.16, 0.28) * dayFactor * 0.05;

        // --- Cloud self-shadow cast onto the surface (offset toward the sun) ---
        if (hasClouds > 0.5) {
          vec2 shadowUV = vUv - 0.0022 * sunDir.xy;
          float cloudShadow = texture2D(cloudTexture, shadowUV).r;
          color *= (1.0 - 0.5 * cloudShadow * dayFactor);
        }

        // Guarantee a visible floor everywhere so no part of the sphere can
        // ever fall to black and read as transparent.
        color = max(color, dayColor * 0.10);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Cloud layer shader — dims toward the terminator / night side, drifts slowly.
// ---------------------------------------------------------------------------
function createCloudShaderMaterial(cloudTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      cloudTexture: { value: cloudTex },
      sunDirection: { value: new THREE.Vector3(1.0, 0.3, 0.5).normalize() },
      uOpacity: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D cloudTexture;
      uniform vec3 sunDirection;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vec4 c = texture2D(cloudTexture, vUv);
        float lum = c.r; // clouds jpg is greyscale — luminance == alpha
        float NdotL = dot(normalize(vWorldNormal), normalize(sunDirection));
        float dayFactor = clamp(1.0 / (1.0 + exp(-8.0 * NdotL)), 0.15, 1.0);
        vec3 rgb = c.rgb * dayFactor;
        gl_FragColor = vec4(rgb, lum * dayFactor * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
// Atmosphere inner-glow shader (BackSide, NormalBlending, low opacity)
// ---------------------------------------------------------------------------
function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x5aa0ff) },
      power: { value: 3.5 },
      sunDirection: { value: new THREE.Vector3(1.0, 0.3, 0.5).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vPositionView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vPositionView = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float power;
      uniform vec3 sunDirection;
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vPositionView;
      void main() {
        vec3 viewDir = normalize(-vPositionView);
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), power);
        fresnel = clamp(fresnel, 0.0, 1.0);
        // Rim glows blue on the lit side, dims reddish toward the terminator.
        float sunFacing = 1.0 / (1.0 + exp(-7.0 * (dot(normalize(vWorldNormal), normalize(sunDirection)) + 0.1)));
        vec3 tint = mix(vec3(0.6, 0.3, 0.15), glowColor, sunFacing);
        gl_FragColor = vec4(tint, fresnel * 0.6 * (0.25 + 0.75 * sunFacing));
      }
    `,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    transparent: true,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Trajectory gradient + animated-dash shader
// ---------------------------------------------------------------------------
function createTrajectoryMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      dashScale: { value: 30.0 },
      glowIntensity: { value: 1.5 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float dashScale;
      uniform float glowIntensity;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        // Color gradient: white -> yellow -> red along path
        vec3 startColor = vec3(1.0, 1.0, 1.0);   // white
        vec3 midColor   = vec3(1.0, 0.85, 0.3);   // yellow
        vec3 endColor   = vec3(1.0, 0.25, 0.15);  // red
        float t = vUv.x;
        vec3 color = t < 0.5
          ? mix(startColor, midColor, t * 2.0)
          : mix(midColor, endColor, (t - 0.5) * 2.0);

        // Animated dash overlay
        float dash = sin((vUv.x * dashScale - time * 1.2) * 3.14159) * 0.5 + 0.5;
        float alpha = 0.5 + dash * 0.5;

        vec3 glow = color * glowIntensity;
        gl_FragColor = vec4(glow, alpha * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// LunarScene
// ---------------------------------------------------------------------------
export class LunarScene {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this._animationId = null;
    this._disposed = false;
    this._texturesLoaded = false;

    // Collections
    this._disposables = [];
    this._orbitalMeshes = new Map();        // category -> THREE.Points
    this._orbitalObjectsData = [];          // flat array of all orbital objects
    this._orbitalCategoryItems = new Map(); // category -> items[] (ordered same as Points positions)
    this._categoryCounts = new Map();
    this._trajectoryGroup = null;
    this._trajectoryMaterial = null;
    this._trajectoryCurve = null;
    this._landingMarker = null;
    this._launchMarker = null;
    this._moonOrbitAngle = 0;
    this._externalMoonPos = false;
    this._issOrbitLine = null;
    this._debrisCloud = null;

    // Rocket animation state
    this._rocket = null;
    this._rocketExhaust = null;
    this._rocketCurve = null;
    this._rocketAnim = null; // { playing, t, duration, onProgress, startTime }

    // Per-frame callback for external propagation (SGP4 etc.)
    this._onBeforeRenderCallback = null;

    // Camera animation state (gsap-based)
    this._cameraAnim = null;
    this._followRocket = false;
    this._followMoon = false;

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.001,
      500000,
    );
    this.camera.position.set(0, 2, 5);

    // ---- Controls (low sensitivity + damping) ----
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 0.25;
    this.controls.zoomSpeed = 0.5;
    this.controls.panSpeed = 0.3;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 120;
    this.controls.zoomToCursor = true;

    // ---- Scene ----
    this.scene = new THREE.Scene();

    // ---- Lights ----
    // Ambient kept low so the day/night terminator reads (spec §1.7).
    const ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 2.0);
    this.sunLight.position.set(100, 30, 50);
    this.scene.add(this.sunLight);

    const hemiLight = new THREE.HemisphereLight(0x4488cc, 0x0a0a2a, 0.08);
    this.scene.add(hemiLight);

    // ---- Instanced LOD state (mid/near 3D glyph tier) ----
    this._instanced = new Map();      // category -> { mesh, dummy, cap, map: Int32Array }
    this._lodNear = false;
    this._lodFrame = 0;
    this._userHidden = new Set();     // categories toggled off by the user

    // ---- Selective bloom composer ----
    this._bloom = new SelectiveBloom(
      this.renderer, this.scene, this.camera,
      container.clientWidth, container.clientHeight,
    );

    // ---- Build world ----
    this._loadAndBuild();
  }

  // =========================================================================
  // Async texture loading + scene building
  // =========================================================================
  async _loadAndBuild() {
    // Load high-res textures (new 8k set, with old low-res files as fallback).
    const [dayTex, nightTex, cloudTex, bumpTex, normalTex, specTex, moonTex, starTex] = await Promise.all([
      loadTexture('/textures/8k_earth_daymap.jpg', '/textures/earth-day.jpg'),
      loadTexture('/textures/8k_earth_nightmap.jpg', '/textures/earth-night.jpg'),
      loadTexture('/textures/8k_earth_clouds.jpg', '/textures/earth-clouds.png'),
      loadTexture('/textures/earth-bump.png'),
      loadTexture('/textures/earth-normal.jpg'),
      loadTexture('/textures/earth-specular.jpg'),
      loadTexture('/textures/8k_moon.jpg', '/textures/moon.jpg'),
      loadTexture('/textures/8k_stars_milky_way.jpg', '/textures/starfield.png'),
    ]);

    if (this._disposed) return;

    // Color textures are sRGB; data maps (normal/specular/bump) are linear.
    for (const tex of [dayTex, nightTex, cloudTex, moonTex, starTex]) {
      if (tex) { tex.colorSpace = THREE.SRGBColorSpace; this._disposables.push(tex); }
    }
    for (const tex of [bumpTex, normalTex, specTex]) {
      if (tex) { tex.colorSpace = THREE.NoColorSpace; this._disposables.push(tex); }
    }

    this._createStarfield(starTex);
    this._createEarth(dayTex, nightTex, cloudTex, bumpTex, normalTex, specTex);
    this._createMoon(moonTex);
    // (Synthetic debris cloud removed — the real Space-Track catalog now includes
    // ~10k tracked debris objects rendered with real SGP4 positions.)

    this._texturesLoaded = true;
  }

  // =========================================================================
  // Starfield
  // =========================================================================
  _createStarfield(starTex) {
    if (starTex) {
      // Map starfield texture onto a huge inverted sphere
      starTex.mapping = THREE.EquirectangularReflectionMapping;
      const skyGeo = new THREE.SphereGeometry(100000, 64, 64);
      const skyMat = new THREE.MeshBasicMaterial({
        map: starTex,
        side: THREE.BackSide,
        depthWrite: false,
      });
      const skyMesh = new THREE.Mesh(skyGeo, skyMat);
      this.scene.add(skyMesh);
      this._disposables.push(skyGeo, skyMat);
    } else {
      // Fallback: solid dark background
      this.scene.background = new THREE.Color(0x000005);
    }

    // Add extra procedural point stars for density
    const STAR_COUNT = 12000;
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80000 + Math.random() * 120000;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Slight color variation (warm/cool stars)
      const temp = Math.random();
      if (temp > 0.9) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 0.7;
      } else if (temp > 0.8) {
        colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: false,
      size: 1.0,
      transparent: true,
      opacity: 0.9,
    });

    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
    this._disposables.push(geo, mat);
  }

  // =========================================================================
  // Earth — fully opaque, no transparency, vegetation boost
  // =========================================================================
  _createEarth(dayTex, nightTex, cloudTex, bumpTex, normalTex, specTex) {
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS);
    // Real tangent-space normal mapping requires per-vertex tangents.
    earthGeo.computeTangents();
    this._disposables.push(earthGeo);

    // Earth pivot for axial tilt
    this.earthPivot = new THREE.Group();
    this.earthPivot.rotation.z = EARTH_AXIAL_TILT;
    this.scene.add(this.earthPivot);

    if (dayTex && nightTex) {
      // Custom day/night shader — fully opaque, depthWrite on
      this._earthMaterial = createEarthShaderMaterial(dayTex, nightTex, normalTex, specTex, cloudTex);
      this.earth = new THREE.Mesh(earthGeo, this._earthMaterial);
    } else {
      // Fallback: standard material with 5% transparency
      const earthMat = new THREE.MeshStandardMaterial({
        color: 0x1155aa,
        transparent: false,
        opacity: 1.0,
        depthWrite: true,
        roughness: 0.8,
        metalness: 0.0,
      });
      this._earthMaterial = earthMat;
      this.earth = new THREE.Mesh(earthGeo, earthMat);
      this._disposables.push(earthMat);
    }
    this.earth.renderOrder = 0;
    this.earthPivot.add(this.earth);
    this._disposables.push(this._earthMaterial);

    // Cloud layer — separate sphere slightly above the surface, custom shader
    // that dims toward the terminator and drifts slowly (animate()).
    if (cloudTex) {
      const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.006, EARTH_SEGMENTS, EARTH_SEGMENTS);
      this._cloudMaterial = createCloudShaderMaterial(cloudTex);
      this.clouds = new THREE.Mesh(cloudGeo, this._cloudMaterial);
      this.earthPivot.add(this.clouds);
      this._disposables.push(cloudGeo, this._cloudMaterial);
    }

    // Atmosphere inner glow — SEPARATE mesh, BackSide, NormalBlending, low opacity
    const atmosGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 64);
    const atmosMat = createAtmosphereMaterial();
    this._atmosphereMaterial = atmosMat;
    this.atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    this.atmosphere.renderOrder = -1;
    this.scene.add(this.atmosphere);
    this._disposables.push(atmosGeo, atmosMat);

    // Outer atmospheric halo (BackSide, max alpha 0.12, NormalBlending)
    const haloGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.12, 64, 64);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(0x3366cc) },
        coefficient: { value: 0.8 },
        power: { value: 5.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vPositionView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPositionView = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 glowColor;
        uniform float coefficient;
        uniform float power;
        varying vec3 vNormal;
        varying vec3 vPositionView;
        void main() {
          vec3 viewDir = normalize(-vPositionView);
          float fresnel = coefficient + (1.0 - coefficient) * pow(1.0 - abs(dot(vNormal, viewDir)), power);
          fresnel = clamp(fresnel, 0.0, 1.0);
          gl_FragColor = vec4(glowColor, fresnel * 0.12);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.renderOrder = -1;
    this.scene.add(halo);
    this._disposables.push(haloGeo, haloMat);
  }

  // =========================================================================
  // Moon — texture or procedural grey with crater marks
  // =========================================================================
  _createMoon(moonTex) {
    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, 128, 128);
    this._disposables.push(moonGeo);

    if (moonTex) {
      // 8k color + bump/normal relief derived from the same luminance texture.
      // NASA ships no lunar normal map; luminance-driven bump is the standard
      // derived proxy and gives clear crater relief under the shared sun light.
      const normalTex = this._deriveMoonNormalMap(moonTex);
      const moonMat = new THREE.MeshStandardMaterial({
        map: moonTex,
        bumpMap: moonTex,
        bumpScale: 0.004,
        normalMap: normalTex || undefined,
        normalScale: normalTex ? new THREE.Vector2(0.7, 0.7) : undefined,
        roughness: 0.95,
        metalness: 0.0,
      });
      this.moon = new THREE.Mesh(moonGeo, moonMat);
      this._disposables.push(moonMat);
    } else {
      // Procedural fallback: grey sphere with canvas-based crater texture
      const moonMat = new THREE.MeshStandardMaterial({
        map: this._createProceduralMoonTexture(),
        roughness: 0.95,
        metalness: 0.0,
      });
      this.moon = new THREE.Mesh(moonGeo, moonMat);
      this._disposables.push(moonMat);
    }
    this.moon.position.set(MOON_DISTANCE, 0, 0);
    this.scene.add(this.moon);
    
    // Moon orbital path - bright yellow dashed ring
    this._createMoonOrbitPath();
  }

  /**
   * Derive a tangent-space normal map from the Moon's color luminance via a
   * Sobel height gradient. Downsampled so it's cheap to compute once at load.
   * @param {THREE.Texture} colorTex
   * @returns {THREE.CanvasTexture|null}
   */
  _deriveMoonNormalMap(colorTex) {
    const img = colorTex && colorTex.image;
    if (!img || !img.width || !img.height) return null;
    try {
      const W = 1024, H = 512;
      const src = document.createElement('canvas');
      src.width = W; src.height = H;
      const sctx = src.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(img, 0, 0, W, H);
      const data = sctx.getImageData(0, 0, W, H).data;

      // Luminance heightfield
      const height = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        height[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
      }

      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const octx = out.getContext('2d');
      const outImg = octx.createImageData(W, H);
      const od = outImg.data;
      const strength = 2.5;
      const at = (x, y) => height[((y + H) % H) * W + ((x + W) % W)];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
          const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
          const len = Math.hypot(dx, dy, 1.0);
          const idx = (y * W + x) * 4;
          od[idx] = ((dx / len) * 0.5 + 0.5) * 255;
          od[idx + 1] = ((dy / len) * 0.5 + 0.5) * 255;
          od[idx + 2] = (1.0 / len) * 0.5 * 255 + 127.5;
          od[idx + 3] = 255;
        }
      }
      octx.putImageData(outImg, 0, 0);
      const tex = new THREE.CanvasTexture(out);
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      this._disposables.push(tex);
      return tex;
    } catch {
      return null; // e.g. canvas tainted — fall back to bumpMap only
    }
  }

  _createMoonOrbitPath() {
    // This creates a placeholder ring. It will be updated when setMoonOrbitFromPositions is called.
    const segments = 256;
    const points = [];
    const moonIncl = 5.145 * Math.PI / 180;
    
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = MOON_DISTANCE * Math.cos(angle);
      const rawZ = MOON_DISTANCE * Math.sin(angle);
      const y = rawZ * Math.sin(moonIncl);
      const z = rawZ * Math.cos(moonIncl);
      points.push(new THREE.Vector3(x, y, z));
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: 0xFFFF00,
      dashSize: 1.5,
      gapSize: 0.8,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
      depthWrite: false,
    });
    
    this._moonOrbitLine = new THREE.Line(geometry, material);
    this._moonOrbitLine.computeLineDistances();
    this._moonOrbitLine.renderOrder = 1;
    this.scene.add(this._moonOrbitLine);
    this._disposables.push(geometry, material);
  }

  /**
   * Update the Moon orbit ring to pass through actual computed Moon positions.
   * Call this with an array of {x,y,z} positions computed from Meeus at regular
   * intervals around the Moon's ~27.3-day orbit.
   */
  setMoonOrbitFromPositions(positions) {
    if (!this._moonOrbitLine || !positions || positions.length < 10) return;
    
    const points = positions.map(p => new THREE.Vector3(p.x, p.y, p.z));
    // Close the loop
    points.push(points[0].clone());
    
    const newGeo = new THREE.BufferGeometry().setFromPoints(points);
    this._moonOrbitLine.geometry.dispose();
    this._moonOrbitLine.geometry = newGeo;
    this._moonOrbitLine.computeLineDistances();
    this._disposables.push(newGeo);
  }

  /**
   * Generate a procedural Moon texture with craters on a canvas.
   * @returns {THREE.CanvasTexture}
   */
  _createProceduralMoonTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base grey
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, size, size);

    // Add noise-like variation
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const brightness = 120 + Math.floor(Math.random() * 40 - 20);
      ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Draw craters
    const craterCount = 60;
    for (let i = 0; i < craterCount; i++) {
      const cx = Math.random() * size;
      const cy = Math.random() * size;
      const cr = 3 + Math.random() * 20;

      // Crater shadow (darker ring)
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, TWO_PI);
      ctx.fillStyle = `rgba(60,60,60,${0.3 + Math.random() * 0.3})`;
      ctx.fill();

      // Crater floor (slightly lighter)
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.7, 0, TWO_PI);
      ctx.fillStyle = `rgba(100,100,100,${0.3 + Math.random() * 0.2})`;
      ctx.fill();

      // Bright rim highlight
      ctx.beginPath();
      ctx.arc(cx - cr * 0.15, cy - cr * 0.15, cr * 0.85, 0, TWO_PI);
      ctx.strokeStyle = `rgba(170,170,170,${0.15 + Math.random() * 0.15})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Large maria (dark patches)
    const mariaCount = 5;
    for (let i = 0; i < mariaCount; i++) {
      const cx = 50 + Math.random() * (size - 100);
      const cy = 50 + Math.random() * (size - 100);
      const rx = 30 + Math.random() * 60;
      const ry = 30 + Math.random() * 60;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, Math.random() * Math.PI, 0, TWO_PI);
      ctx.fillStyle = `rgba(70,70,75,${0.2 + Math.random() * 0.15})`;
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._disposables.push(tex);
    return tex;
  }

  // =========================================================================
  // Statistical debris cloud — 3000 synthetic debris points
  // =========================================================================
  _addDebrisCloud() {
    const COUNT = 30000;
    const positions = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      // 80% LEO, 20% GEO
      const isGeo = Math.random() < 0.2;
      const altKm = isGeo
        ? 35786 + (Math.random() - 0.5) * 200
        : 300 + Math.random() * 1700;
      const radius = (EARTH_RADIUS_KM + altKm) / EARTH_RADIUS_KM; // in scene units

      const inclination = isGeo
        ? (Math.random() - 0.5) * 5 * DEG_TO_RAD
        : (20 + Math.random() * 80) * DEG_TO_RAD;
      const raan = Math.random() * TWO_PI;
      const trueAnomaly = Math.random() * TWO_PI;

      // Convert orbital elements to Cartesian position
      const x = radius * (Math.cos(raan) * Math.cos(trueAnomaly) - Math.sin(raan) * Math.sin(trueAnomaly) * Math.cos(inclination));
      const y = radius * Math.sin(trueAnomaly) * Math.sin(inclination);
      const z = radius * (Math.sin(raan) * Math.cos(trueAnomaly) + Math.cos(raan) * Math.sin(trueAnomaly) * Math.cos(inclination));

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xef4444,
      size: 0.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    const cloud = new THREE.Points(geo, mat);
    cloud.frustumCulled = false;
    this.scene.add(cloud);
    this._debrisCloud = cloud;
    this._disposables.push(geo, mat);
  }

  // =========================================================================
  // Orbital object rendering — THREE.Points (NOT InstancedMesh)
  // =========================================================================

  /**
   * @param {Array<{id:string, name:string, category:string, position:{x:number,y:number,z:number}}>} objectsArray
   */
  addOrbitalObjects(objectsArray) {
    // Store all objects for later position updates by id
    this._orbitalObjectsData = objectsArray;

    // Group by category
    const groups = new Map();
    for (const obj of objectsArray) {
      const cat = obj.category.toLowerCase();
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(obj);
    }

    // Parallel array: for each category, the global catalog index of each item,
    // so worker position buffers (indexed by catalog index) can be scattered in.
    this._orbitalCategoryGidx = this._orbitalCategoryGidx || new Map();

    for (const [category, items] of groups) {
      const positions = new Float32Array(items.length * 3);
      const sizes = new Float32Array(items.length);
      const gidx = new Int32Array(items.length);
      const baseSize = getPointSize(category);
      for (let i = 0; i < items.length; i++) {
        positions[i * 3] = items[i].position.x;
        positions[i * 3 + 1] = items[i].position.y;
        positions[i * 3 + 2] = items[i].position.z;
        // Screen-space size scaled by RCS class; clamped so glyph shapes read clearly
        // without large objects (ISS/stations) ballooning.
        sizes[i] = Math.max(3.5, Math.min(20, baseSize * 2.2 * rcsScale(items[i].rcs)));
        gidx[i] = items[i].idx != null ? items[i].idx : -1;
      }
      this._orbitalCategoryGidx.set(category, gidx);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

      const color = getCategoryColorHex(category);
      const glyphTex = getGlyphTexture(glyphShapeFor(category));
      const material = makeGlyphMaterial(color, glyphTex);

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 2; // Render after Earth (0) and atmosphere (-1)
      this.scene.add(points);
      this._orbitalMeshes.set(category, points);
      this._orbitalCategoryItems.set(category, items);
      this._categoryCounts.set(category, items.length);

      this._disposables.push(geometry, material);

      // Build the 3D instanced glyph tier for this category (hidden until the
      // camera zooms into LOD_NEAR_DIST).
      this._buildInstancedLOD(category, items);

      // ISS orbit path: draw a thin dashed ring at ISS orbital altitude
      if (category === 'iss' && items.length > 0) {
        this._createISSOrbitPath(items[0]);
      }
    }
  }

  /**
   * Build the instanced 3D-glyph LOD tier for a category. Capacity is capped;
   * the mesh stays hidden and empty (count = 0) until the camera zooms in.
   * @param {string} category
   * @param {Array} items
   */
  _buildInstancedLOD(category, items) {
    const shape = glyphShapeFor(category);
    const geo = buildGlyphGeometry(shape);
    const colorHex = getCategoryColorHex(category);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.22),
      roughness: 0.4,
      metalness: 0.65,
      flatShading: true,
      // Per-component baked shading (bright bus / dark panels / foil) modulates
      // the category hue for real depth and layering.
      vertexColors: true,
    });
    const cap = Math.min(items.length, LOD_MAX_PER_CATEGORY);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // we manage the visible subset ourselves
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this._disposables.push(geo, mat);
    this._instanced.set(category, {
      mesh,
      dummy: new THREE.Object3D(),
      cap,
      map: new Int32Array(cap), // instanceId -> local index in this category
    });
  }

  /**
   * LOD driver — swap between the flat Points billboards (far) and the 3D
   * instanced glyphs (near) based on camera distance to Earth centre, and
   * refresh the visible instanced subset periodically.
   */
  _updateLOD() {
    if (this._instanced.size === 0) return;
    const camDist = this.camera.position.length();
    const near = camDist < LOD_NEAR_DIST;

    if (near !== this._lodNear) {
      this._lodNear = near;
      for (const [cat, points] of this._orbitalMeshes) {
        const hidden = this._userHidden.has(cat);
        // Billboards stay visible at EVERY zoom level so no object ever
        // disappears — including far-side and high-orbit (GEO) objects that
        // the near instanced tier (5-unit cutoff) can't reach. The 3D glyphs
        // are an ADDITIVE near-camera detail overlay, not a replacement.
        points.visible = !hidden;
        const inst = this._instanced.get(cat);
        if (inst) inst.mesh.visible = near && !hidden;
      }
      if (near) this._rebuildInstances();
      return;
    }

    if (near) {
      this._lodFrame = (this._lodFrame + 1) % LOD_REBUILD_INTERVAL;
      if (this._lodFrame === 0) this._rebuildInstances();
    }
  }

  /** Populate instanced matrices with objects within LOD_INSTANCE_CUTOFF of the camera. */
  _rebuildInstances() {
    const cam = this.camera.position;
    const cutoffSq = LOD_INSTANCE_CUTOFF * LOD_INSTANCE_CUTOFF;
    for (const [category, points] of this._orbitalMeshes) {
      const inst = this._instanced.get(category);
      if (!inst) continue;
      if (this._userHidden.has(category)) { inst.mesh.count = 0; continue; }

      const items = this._orbitalCategoryItems.get(category);
      const posAttr = points.geometry.getAttribute('position');
      const arr = posAttr.array;
      const { mesh, dummy, cap, map } = inst;
      let n = 0;
      for (let i = 0; i < items.length && n < cap; i++) {
        const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        if (dx * dx + dy * dy + dz * dz > cutoffSq) continue;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(rcsScale(items[i].rcs));
        dummy.lookAt(0, 0, 0); // nadir-ish orientation cue
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        map[n] = i;
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Create a thin dashed orbit ring for the ISS at its orbital altitude.
   * @param {{position:{x:number,y:number,z:number}}} issObj
   */
  _createISSOrbitPath(issObj) {
    // Remove existing ISS orbit line if any
    if (this._issOrbitLine) {
      this.scene.remove(this._issOrbitLine);
      if (this._issOrbitLine.geometry) this._issOrbitLine.geometry.dispose();
      if (this._issOrbitLine.material) this._issOrbitLine.material.dispose();
      this._issOrbitLine = null;
    }

    // Compute orbital radius from the ISS position
    const pos = new THREE.Vector3(issObj.position.x, issObj.position.y, issObj.position.z);
    const orbitRadius = pos.length();
    if (orbitRadius < EARTH_RADIUS) return; // sanity check

    // Build a circle of points at the orbital altitude
    const segments = 256;
    const ringPoints = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * TWO_PI;
      ringPoints.push(new THREE.Vector3(
        Math.cos(angle) * orbitRadius,
        0,
        Math.sin(angle) * orbitRadius,
      ));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(ringPoints);

    // Compute line distances for dashing
    const lineDistances = new Float32Array(ringPoints.length);
    lineDistances[0] = 0;
    for (let i = 1; i < ringPoints.length; i++) {
      lineDistances[i] = lineDistances[i - 1] + ringPoints[i].distanceTo(ringPoints[i - 1]);
    }
    geo.setAttribute('lineDistance', new THREE.BufferAttribute(lineDistances, 1));

    const mat = new THREE.LineDashedMaterial({
      color: 0xffd700,
      dashSize: 0.05,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    this._issOrbitLine = new THREE.Line(geo, mat);
    this._issOrbitLine.computeLineDistances();
    this._issOrbitLine.name = 'issOrbitPath';
    this.scene.add(this._issOrbitLine);
    this._disposables.push(geo, mat);
  }

  /**
   * Update orbital object positions.
   * @param {Map<string,{x:number,y:number,z:number}>} positionsMap  id -> position
   */
  updateOrbitalPositions(positionsMap) {
    for (const [category, points] of this._orbitalMeshes) {
      const items = this._orbitalCategoryItems.get(category);
      if (!items) continue;

      const posAttr = points.geometry.getAttribute('position');
      let changed = false;

      for (let i = 0; i < items.length; i++) {
        const newPos = positionsMap.get(items[i].id);
        if (newPos) {
          posAttr.array[i * 3] = newPos.x;
          posAttr.array[i * 3 + 1] = newPos.y;
          posAttr.array[i * 3 + 2] = newPos.z;
          changed = true;
        }
      }

      if (changed) {
        posAttr.needsUpdate = true;
      }
    }
  }

  /**
   * Legacy alias — routes to updateOrbitalPositions.
   * @param {Map<string,{x:number,y:number,z:number}>} positionsMap
   */
  updateOrbitalObjects(positionsMap) {
    this.updateOrbitalPositions(positionsMap);
  }

  /**
   * Fast path: scatter a worker-produced position buffer (Float32Array indexed by
   * global catalog index) into each category's geometry using the precomputed gidx.
   * @param {Float32Array} buf
   */
  updateFromBuffer(buf) {
    if (!this._orbitalCategoryGidx) return;
    for (const [category, points] of this._orbitalMeshes) {
      const gidx = this._orbitalCategoryGidx.get(category);
      if (!gidx) continue;
      const posAttr = points.geometry.getAttribute('position');
      const arr = posAttr.array;
      for (let i = 0; i < gidx.length; i++) {
        const g = gidx[i];
        if (g < 0) continue;
        arr[i * 3] = buf[g * 3];
        arr[i * 3 + 1] = buf[g * 3 + 1];
        arr[i * 3 + 2] = buf[g * 3 + 2];
      }
      posAttr.needsUpdate = true;
    }
  }

  /**
   * Raycast the orbital object clouds and return the picked object's identity.
   * @param {number} ndcX  normalized device X (-1..1)
   * @param {number} ndcY  normalized device Y (-1..1)
   * @returns {{gidx:number, category:string, index:number, point:THREE.Vector3}|null}
   */
  pickObject(ndcX, ndcY) {
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Points.threshold = 0.025;
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);

    // Near LOD: pick against the 3D instanced glyphs (Points are hidden).
    if (this._lodNear) {
      let best = null;
      for (const [cat, inst] of this._instanced) {
        if (!inst.mesh.visible || inst.mesh.count === 0) continue;
        const hits = this._raycaster.intersectObject(inst.mesh);
        for (const h of hits) {
          if (h.instanceId == null) continue;
          if (!best || h.distance < best.distance) {
            const localIndex = inst.map[h.instanceId];
            best = { category: cat, index: localIndex, distance: h.distance, point: h.point };
          }
        }
      }
      if (best) {
        const gidxArr = this._orbitalCategoryGidx.get(best.category);
        const gidx = gidxArr ? gidxArr[best.index] : -1;
        return { gidx, category: best.category, index: best.index, point: best.point };
      }
      return null;
    }

    // Far LOD: pick against the Points billboards.
    let best = null;
    for (const [cat, pts] of this._orbitalMeshes) {
      if (!pts.visible) continue;
      const hits = this._raycaster.intersectObject(pts);
      for (const h of hits) {
        if (!best || h.distanceToRay < best.distanceToRay) {
          best = { category: cat, index: h.index, distanceToRay: h.distanceToRay, point: h.point };
        }
      }
    }
    if (!best) return null;
    const gidxArr = this._orbitalCategoryGidx.get(best.category);
    const gidx = gidxArr ? gidxArr[best.index] : -1;
    return { gidx, category: best.category, index: best.index, point: best.point };
  }

  /** Current world position of a category's local-index point, or null. */
  getObjectWorldPosition(category, index) {
    const pts = this._orbitalMeshes.get(category);
    if (!pts) return null;
    const a = pts.geometry.getAttribute('position');
    if (!a || index < 0 || index >= a.count) return null;
    return new THREE.Vector3(a.array[index * 3], a.array[index * 3 + 1], a.array[index * 3 + 2]);
  }

  /** Show a selection highlight ring at a world position. */
  showSelectionMarker(pos) {
    this.clearSelectionMarker();
    const geo = new THREE.RingGeometry(0.03, 0.045, 24);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos);
    ring.userData._isSelMarker = true;
    this._selectionMarker = ring;
    this.scene.add(ring);
    this._disposables.push(geo, mat);
  }

  clearSelectionMarker() {
    if (this._selectionMarker) {
      this.scene.remove(this._selectionMarker);
      this._selectionMarker = null;
    }
  }

  /**
   * Toggle visibility of an orbital category.
   * @param {string} category
   * @param {boolean} visible
   */
  setCategoryVisibility(category, visible) {
    const altKey = category.includes('_') ? category.replace('_', ' ') : category.replace(' ', '_');
    for (const key of [category, altKey]) {
      // Track user intent so the LOD driver doesn't re-show a hidden category.
      if (visible) this._userHidden.delete(key);
      else this._userHidden.add(key);

      const mesh = this._orbitalMeshes.get(key);
      // Billboards always visible (never disappear); 3D glyphs overlay when near.
      if (mesh) mesh.visible = visible;
      const inst = this._instanced.get(key);
      if (inst) inst.mesh.visible = visible && this._lodNear;
    }
  }

  // =========================================================================
  // Trajectory visualisation — gradient tube, reaches Moon
  // =========================================================================

  /**
   * Draw a smooth glowing trajectory through waypoints with gradient color
   * (white -> yellow -> red) and animated dashes plus direction cones.
   * If the last waypoint doesn't reach the Moon, extend toward it.
   * @param {Array<{x:number,y:number,z:number}>} trajectoryPoints
   * @param {number} [color=0xff0000]
   */
  showTrajectory(trajectoryPoints, color = 0xff0000) {
    this.clearTrajectory();

    if (!trajectoryPoints || trajectoryPoints.length < 2) return;

    this._trajectoryGroup = new THREE.Group();
    this._trajectoryGroup.name = 'trajectory';
    this._trajectoryGroup.renderOrder = 3; // Render after Earth (0), atmosphere (-1), orbital objects (2)

    const points = trajectoryPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));

    // NOTE: no straight-line extension to the Moon. The physics descent waypoints
    // already terminate on the lunar surface at the arrival-time Moon position, and
    // the Moon mesh is moved to that same position (see main.js setMoonPosition).
    // Only close a genuinely tiny gap (< 1 Moon radius) if the Moon is present and
    // the final waypoint is already adjacent to its surface.
    if (this.moon) {
      const moonPos = this.moon.position;
      const lastPoint = points[points.length - 1];
      const distToMoon = lastPoint.distanceTo(moonPos);
      const gap = Math.abs(distToMoon - MOON_RADIUS);
      if (distToMoon > MOON_RADIUS && gap > 1e-4 && gap < MOON_RADIUS) {
        const moonSurface = moonPos.clone().add(
          lastPoint.clone().sub(moonPos).normalize().multiplyScalar(MOON_RADIUS)
        );
        points.push(moonSurface);
      }
    }

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this._trajectoryCurve = curve;

    const trajLength = curve.getLength();

    const tubularSegments = Math.max(points.length * 10, 256);
    const RADIAL_SEGS = 8;

    // Tube radius: thin (0.002 to 0.008), based on trajectory length
    const tubeRadius = Math.max(0.002, Math.min(0.008, trajLength * 0.0001));
    const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, RADIAL_SEGS, false);
    this._trajectoryMaterial = createTrajectoryMaterial();
    const tubeMesh = new THREE.Mesh(tubeGeo, this._trajectoryMaterial);
    this._trajectoryGroup.add(tubeMesh);
    this._disposables.push(tubeGeo);

    // Outer glow tube — additive fake-glow shader with radial falloff, fed into
    // the bloom layer so it reads as an energetic, live trajectory (spec §6).
    const glowGeo = new THREE.TubeGeometry(curve, Math.floor(tubularSegments / 2), tubeRadius * 3.0, 8, false);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(color) },
        falloff: { value: 0.18 },
        glowSharpness: { value: 0.6 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalView;
        void main() {
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 glowColor;
        uniform float falloff;
        uniform float glowSharpness;
        varying vec3 vNormalView;
        void main() {
          float intensity = pow(1.0 - abs(vNormalView.z), 2.0 - glowSharpness);
          gl_FragColor = vec4(glowColor, intensity * falloff * 3.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.layers.enable(BLOOM_LAYER);
    this._trajectoryGroup.add(glowMesh);
    this._disposables.push(glowGeo, glowMat);

    // Direction cones every ~10% of the path
    const arrowCount = 10;
    const arrowSize = Math.max(0.04, trajLength * 0.002);
    const coneGeo = new THREE.ConeGeometry(arrowSize * 0.4, arrowSize, 6);
    const coneMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.0,
    });
    this._disposables.push(coneGeo, coneMat);

    for (let i = 1; i <= arrowCount; i++) {
      const t = i / (arrowCount + 1);
      const pos = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();

      const arrow = new THREE.Mesh(coneGeo, coneMat);
      arrow.position.copy(pos);

      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
      arrow.quaternion.copy(quat);

      this._trajectoryGroup.add(arrow);
    }

    this.scene.add(this._trajectoryGroup);
  }

  /**
   * Draw red pulsing warning markers at conjunction points along the trajectory.
   * @param {Array<{pos:{x,y,z}, label:string, critical:boolean}>} markers
   */
  showConjunctionMarkers(markers) {
    this.clearConjunctionMarkers();
    if (!markers || markers.length === 0) return;
    const group = new THREE.Group();
    group.name = 'conjunctionMarkers';
    for (const m of markers) {
      const color = m.critical ? 0xff2222 : 0xffaa00;
      const emissive = m.critical ? 0xff0000 : 0xff7700;
      const geo = new THREE.SphereGeometry(0.02, 12, 12);
      // Hot emissive + toneMapped:false so the bloom pass sees a blown-out
      // pixel; on BLOOM_LAYER so the selective composer makes it glow.
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 3.0,
        toneMapped: false,
      });
      const dot = new THREE.Mesh(geo, mat);
      dot.position.set(m.pos.x, m.pos.y, m.pos.z);
      dot.userData._isPulse = true;
      dot.layers.enable(BLOOM_LAYER);
      group.add(dot);
      this._disposables.push(geo, mat);
      // ring
      const rgeo = new THREE.RingGeometry(0.03, 0.045, 20);
      const rmat = new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: 2.0, toneMapped: false,
        side: THREE.DoubleSide, transparent: true, opacity: 0.85,
      });
      const ring = new THREE.Mesh(rgeo, rmat);
      ring.position.copy(dot.position);
      ring.lookAt(this.camera.position);
      ring.userData._isPulse = true;
      ring.layers.enable(BLOOM_LAYER);
      group.add(ring);
      this._disposables.push(rgeo, rmat);
      if (m.label) {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 40;
        const x = cv.getContext('2d');
        x.fillStyle = m.critical ? '#ff5555' : '#ffcc44';
        x.font = 'bold 22px sans-serif';
        x.textBaseline = 'middle';
        x.fillText(m.label, 6, 20);
        const tex = new THREE.CanvasTexture(cv);
        const smat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(smat);
        sprite.position.set(m.pos.x, m.pos.y + 0.06, m.pos.z);
        sprite.scale.set(0.5, 0.08, 1);
        group.add(sprite);
        this._disposables.push(tex, smat);
      }
    }
    this._conjunctionMarkers = group;
    this.scene.add(group);
  }

  clearConjunctionMarkers() {
    if (this._conjunctionMarkers) {
      this.scene.remove(this._conjunctionMarkers);
      this._conjunctionMarkers.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      this._conjunctionMarkers = null;
    }
  }

  clearTrajectory() {
    if (this._trajectoryGroup) {
      this.scene.remove(this._trajectoryGroup);
      this._trajectoryGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      this._trajectoryGroup = null;
      this._trajectoryMaterial = null;
      this._trajectoryCurve = null;
    }
  }

  // =========================================================================
  // Landing site marker
  // =========================================================================

  /**
   * Green pulsing ring + beacon on Moon surface.
   * @param {{x:number,y:number,z:number}} pos
   */
  showLandingSite(pos) {
    if (this._landingMarker) {
      this.scene.remove(this._landingMarker);
    }

    this._landingMarker = new THREE.Group();
    this._landingMarker.name = 'landingSite';

    const position = new THREE.Vector3(pos.x, pos.y, pos.z);
    const moonPos = this.moon ? this.moon.position : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const normal = position.clone().sub(moonPos).normalize();

    // Central beacon
    const dotGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 1.5,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(position);
    this._landingMarker.add(dot);
    this._disposables.push(dotGeo, dotMat);

    // Inner ring
    const ringGeo = new THREE.RingGeometry(0.1, 0.16, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(position);
    ring.lookAt(position.clone().add(normal));
    this._landingMarker.add(ring);
    this._disposables.push(ringGeo, ringMat);

    // Outer pulsing ring
    const pulseGeo = new THREE.RingGeometry(0.2, 0.26, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const pulseRing = new THREE.Mesh(pulseGeo, pulseMat);
    pulseRing.position.copy(position);
    pulseRing.lookAt(position.clone().add(normal));
    pulseRing.userData._isPulse = true;
    this._landingMarker.add(pulseRing);
    this._disposables.push(pulseGeo, pulseMat);

    // Vertical beacon line
    const beaconGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.8, 6);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.4,
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.copy(position.clone().add(normal.clone().multiplyScalar(0.4)));
    const upVec = new THREE.Vector3(0, 1, 0);
    beacon.quaternion.setFromUnitVectors(upVec, normal);
    beacon.userData._isBeacon = true;
    this._landingMarker.add(beacon);
    this._disposables.push(beaconGeo, beaconMat);

    this.scene.add(this._landingMarker);
  }

  // =========================================================================
  // Launch site marker
  // =========================================================================

  /**
   * Red pulsing beacon on Earth surface with vertical beam.
   * @param {{x:number,y:number,z:number}} pos
   */
  showLaunchSite(pos) {
    if (this._launchMarker) {
      this.scene.remove(this._launchMarker);
    }

    this._launchMarker = new THREE.Group();
    this._launchMarker.name = 'launchSite';

    const position = new THREE.Vector3(pos.x, pos.y, pos.z);
    const normal = position.clone().normalize();

    // Dot
    const dotGeo = new THREE.SphereGeometry(0.025, 16, 16);
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff4444,
      emissiveIntensity: 1.5,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(position);
    this._launchMarker.add(dot);
    this._disposables.push(dotGeo, dotMat);

    // Vertical beam
    const beamGeo = new THREE.CylinderGeometry(0.006, 0.002, 0.6, 6);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.6,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(position.clone().add(normal.clone().multiplyScalar(0.3)));
    const upVec = new THREE.Vector3(0, 1, 0);
    beam.quaternion.setFromUnitVectors(upVec, normal);
    beam.userData._isBeacon = true;
    this._launchMarker.add(beam);
    this._disposables.push(beamGeo, beamMat);

    // Base ring
    const ringGeo = new THREE.RingGeometry(0.03, 0.06, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6644,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(position);
    ring.lookAt(position.clone().add(normal));
    this._launchMarker.add(ring);
    this._disposables.push(ringGeo, ringMat);

    // Outer pulse ring
    const pulseGeo = new THREE.RingGeometry(0.07, 0.1, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const pulseRing = new THREE.Mesh(pulseGeo, pulseMat);
    pulseRing.position.copy(position);
    pulseRing.lookAt(position.clone().add(normal));
    pulseRing.userData._isPulse = true;
    this._launchMarker.add(pulseRing);
    this._disposables.push(pulseGeo, pulseMat);

    this.scene.add(this._launchMarker);
  }

  // =========================================================================
  // Rocket model (idempotent — removes old before creating new)
  // =========================================================================

  /**
   * Build a simple but recognizable rocket from merged geometries.
   * Idempotent: removes any existing rocket before creating a new one.
   * @param {number} heightM - Rocket height in meters (used for proportions)
   * @param {number} radiusM - Rocket radius in meters
   * @returns {THREE.Group} The rocket group added to the scene
   */
  createRocket(heightM = 70, radiusM = 3.7) {
    // Idempotent: remove old rocket + exhaust before creating new
    if (this._rocket) {
      this.scene.remove(this._rocket);
      this._rocket.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      this._rocket = null;
      this._rocketExhaust = null;
    }

    // Scale: 1 unit = 6371 km. A 70m rocket is tiny.
    // But we need it visible, so enforce minimum 0.02 units tall.
    const scaleUnit = Math.max(0.02, heightM / 6371000);
    const h = 1.0; // normalized height, then scale group
    const r = (radiusM / heightM) * h;

    this._rocket = new THREE.Group();
    this._rocket.name = 'rocket';

    // --- Multi-stage tapered body (Saturn-V-ish proportions, spec §7) ---
    const stageMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2, roughness: 0.45, metalness: 0.55,
      emissive: 0x222222, emissiveIntensity: 0.15,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a, roughness: 0.7, metalness: 0.6,
    });
    this._disposables.push(stageMat, ringMat);

    // Cursor starts at the base and stacks upward. y=0 stays near mid-body.
    let y = -0.42 * h;
    const addStage = (rBottom, rTop, hFrac) => {
      const geo = new THREE.CylinderGeometry(rTop, rBottom, hFrac, 16);
      const mesh = new THREE.Mesh(geo, stageMat);
      mesh.position.y = y + hFrac / 2;
      this._rocket.add(mesh);
      this._disposables.push(geo);
      y += hFrac;
      return rTop;
    };
    const addRing = (rad, hFrac) => {
      const geo = new THREE.CylinderGeometry(rad * 1.04, rad * 1.04, hFrac, 16);
      const mesh = new THREE.Mesh(geo, ringMat);
      mesh.position.y = y + hFrac / 2;
      this._rocket.add(mesh);
      this._disposables.push(geo);
      y += hFrac;
    };

    const baseY = y; // remember for fins / nozzle
    addStage(r, r, h * 0.30);          // S-IC (stage 1, widest)
    addRing(r, h * 0.015);             // interstage
    addStage(r, r, h * 0.22);          // S-II (stage 2)
    addRing(r * 0.85, h * 0.015);      // interstage
    addStage(r * 0.68, r * 0.62, h * 0.16); // S-IVB (stage 3, narrower)
    addRing(r * 0.5, h * 0.012);       // interstage
    addStage(r * 0.5, r * 0.34, h * 0.12);  // IU + CSM stack (taper)

    // Nose cone (S-IVB forward / CSM) — conic
    const noseGeo = new THREE.ConeGeometry(r * 0.34, h * 0.16, 16);
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x333333, emissiveIntensity: 0.25,
      roughness: 0.25, metalness: 0.6,
    });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.y = y + h * 0.08;
    this._rocket.add(nose);
    this._disposables.push(noseGeo, noseMat);

    // Launch-escape tower: a thin lattice spike + tractor motor on the tip
    // (the tall red needle atop every crewed Saturn V / Apollo stack).
    const lesMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222, roughness: 0.5, metalness: 0.4,
      emissive: 0x330000, emissiveIntensity: 0.2,
    });
    this._disposables.push(lesMat);
    const lesTowerGeo = new THREE.CylinderGeometry(r * 0.04, r * 0.05, h * 0.14, 8);
    const lesTower = new THREE.Mesh(lesTowerGeo, lesMat);
    lesTower.position.y = nose.position.y + h * 0.14;
    this._rocket.add(lesTower);
    this._disposables.push(lesTowerGeo);
    const lesMotorGeo = new THREE.CylinderGeometry(r * 0.09, r * 0.11, h * 0.05, 10);
    const lesMotor = new THREE.Mesh(lesMotorGeo, lesMat);
    lesMotor.position.y = lesTower.position.y + h * 0.09;
    this._rocket.add(lesMotor);
    this._disposables.push(lesMotorGeo);

    // --- Iconic Saturn V black roll-pattern markings (recognisable at a glance) ---
    // White stages with black panels: a wide base band, four upper quadrant
    // panels on stage 1, and a mid band. Built as thin greebles so no per-
    // cylinder UV alignment is needed.
    const blackMat = new THREE.MeshStandardMaterial({
      color: 0x111114, roughness: 0.55, metalness: 0.35,
    });
    this._disposables.push(blackMat);
    const addBand = (yc, hFrac, rad) => {
      const geo = new THREE.CylinderGeometry(rad * 1.012, rad * 1.012, hFrac, 20);
      const m = new THREE.Mesh(geo, blackMat);
      m.position.y = yc;
      this._rocket.add(m);
      this._disposables.push(geo);
    };
    addBand(baseY + h * 0.03, h * 0.05, r);        // base band (S-IC bottom)
    addBand(baseY + h * 0.28, h * 0.02, r);        // stage-1 upper band
    // Four black quadrant panels on stage 1 (the classic roll pattern).
    const panelGeo = new THREE.BoxGeometry(r * 0.9, h * 0.14, r * 0.06);
    this._disposables.push(panelGeo);
    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(panelGeo, blackMat);
      const a = (i / 4) * TWO_PI + Math.PI / 4;
      panel.position.set(Math.cos(a) * r * 0.99, baseY + h * 0.18, Math.sin(a) * r * 0.99);
      panel.rotation.y = a;
      this._rocket.add(panel);
    }

    // --- 5-engine F-1 cluster at the base (1 centre + 4 outboard) ---
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x1c1c20, roughness: 0.7, metalness: 0.8,
      emissive: 0x0a0a0a, emissiveIntensity: 0.2,
    });
    this._disposables.push(nozzleMat);
    const nozzleGeo = new THREE.ConeGeometry(r * 0.26, h * 0.11, 14, 1, true);
    this._disposables.push(nozzleGeo);
    const engineCap = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.85 });
    this._disposables.push(engineCap);
    const addEngine = (ex, ez) => {
      const noz = new THREE.Mesh(nozzleGeo, nozzleMat);
      noz.rotation.x = Math.PI; // bell opens downward
      noz.position.set(ex, baseY - h * 0.05, ez);
      this._rocket.add(noz);
      // Injector plate cap above the bell
      const capGeo = new THREE.CylinderGeometry(r * 0.16, r * 0.22, h * 0.03, 12);
      const cap = new THREE.Mesh(capGeo, engineCap);
      cap.position.set(ex, baseY + h * 0.005, ez);
      this._rocket.add(cap);
      this._disposables.push(capGeo);
    };
    addEngine(0, 0); // centre
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TWO_PI;
      addEngine(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); // outboard ring
    }

    // 4 stabilising fins between the outboard engines
    const finGeo = new THREE.BoxGeometry(r * 0.12, h * 0.15, r * 2.6);
    const finMat = new THREE.MeshStandardMaterial({
      color: 0xe6e6e6, roughness: 0.35, metalness: 0.4,
    });
    this._disposables.push(finGeo, finMat);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeo, finMat);
      const angle = (i / 4) * TWO_PI + Math.PI / 4;
      fin.position.set(
        Math.cos(angle) * r * 0.85,
        baseY + h * 0.05,
        Math.sin(angle) * r * 0.85,
      );
      fin.rotation.y = angle;
      this._rocket.add(fin);
    }

    // Engine exhaust (sprite-based particle effect)
    const exhaustCanvas = document.createElement('canvas');
    exhaustCanvas.width = 64;
    exhaustCanvas.height = 64;
    const ectx = exhaustCanvas.getContext('2d');
    const gradient = ectx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,200,50,1)');
    gradient.addColorStop(0.3, 'rgba(255,120,20,0.8)');
    gradient.addColorStop(0.7, 'rgba(255,60,10,0.3)');
    gradient.addColorStop(1, 'rgba(255,30,5,0)');
    ectx.fillStyle = gradient;
    ectx.fillRect(0, 0, 64, 64);
    const exhaustTex = new THREE.CanvasTexture(exhaustCanvas);
    const exhaustMat = new THREE.SpriteMaterial({
      map: exhaustTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this._rocketExhaust = new THREE.Sprite(exhaustMat);
    this._rocketExhaust.scale.set(r * 4, h * 0.4, 1);
    this._rocketExhaust.position.y = -h * 0.45;
    this._rocketExhaust.visible = false;
    this._rocket.add(this._rocketExhaust);
    this._disposables.push(exhaustTex, exhaustMat);

    // Scale entire group
    const finalScale = scaleUnit / h;
    const visibleScale = Math.max(finalScale, 0.02);
    this._rocket.scale.set(visibleScale, visibleScale, visibleScale);
    this._rocket.visible = false;
    this.scene.add(this._rocket);

    return this._rocket;
  }

  /**
   * Animate the rocket along a trajectory curve over time.
   * @param {Array<{x:number,y:number,z:number}>} trajectoryPoints
   * @param {number} duration - Duration in seconds
   * @param {function} [onProgress] - Called with t (0..1)
   * @returns {{play:function, pause:function, stop:function, seek:function}}
   */
  animateRocketAlongTrajectory(trajectoryPoints, duration = 30, onProgress = null) {
    if (!this._rocket) {
      this.createRocket();
    }

    const points = trajectoryPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this._rocketCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);

    this._rocket.visible = true;
    if (this._rocketExhaust) this._rocketExhaust.visible = true;

    const controller = {
      _scene: this,
      playing: false,
      t: 0,
      duration,
      onProgress,
      startTime: 0,
      _pausedT: 0,

      play() {
        this.playing = true;
        this._scene._rocketAnim = this;
        if (this._scene._rocketExhaust) this._scene._rocketExhaust.visible = true;
      },
      pause() {
        this.playing = false;
        this._pausedT = this.t;
      },
      stop() {
        this.playing = false;
        this.t = 0;
        if (this._scene._rocket) this._scene._rocket.visible = false;
        if (this._scene._rocketExhaust) this._scene._rocketExhaust.visible = false;
        this._scene._rocketAnim = null;
        this._scene._followRocket = false;
      },
      seek(t) {
        this.t = Math.max(0, Math.min(1, t));
        this._scene._updateRocketPosition(this.t);
        if (this.onProgress) this.onProgress(this.t);
      },
    };

    this._rocketAnim = controller;
    controller.play();

    return controller;
  }

  /** Update rocket position along its curve at parameter t */
  _updateRocketPosition(t) {
    if (!this._rocket || !this._rocketCurve) return;

    const pos = this._rocketCurve.getPointAt(t);
    const tangent = this._rocketCurve.getTangentAt(t).normalize();

    this._rocket.position.copy(pos);

    // Orient rocket nose along tangent
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
    this._rocket.quaternion.copy(quat);

    // Exhaust flicker
    if (this._rocketExhaust && this._rocketExhaust.visible) {
      const flicker = 0.8 + Math.random() * 0.4;
      const baseScale = 0.02;
      this._rocketExhaust.scale.set(baseScale * 3 * flicker, baseScale * 5 * flicker, 1);
    }
  }

  // =========================================================================
  // Camera methods
  // =========================================================================

  focusEarth() {
    this._followRocket = false;
    this._followMoon = false;
    this._animateCameraTo(
      new THREE.Vector3(0, 1.5, 3),
      new THREE.Vector3(0, 0, 0),
      1.2,
    );
  }

  focusMoon() {
    // Orbit around the Moon core; the per-frame follow keeps the target on the moving Moon.
    this._followRocket = false;
    this._followMoon = true;
    const moonPos = this.moon ? this.moon.position.clone() : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const offset = new THREE.Vector3(0, 0.3, 1.5);
    this._animateCameraTo(
      moonPos.clone().add(offset),
      moonPos,
      1.5,
    );
  }

  focusTrajectory() {
    // Frame the WHOLE Earth-Moon system so the full transfer arc is visible.
    // (The old versions either chased the rocket — hiding the arc — or used
    // fixed multipliers that framed empty space at some Moon phases, so the
    // button appeared to show nothing.) During playback the phase-based
    // cinematography in main.js takes over; this is the static overview.
    this._followRocket = false;
    this._followMoon = false;
    const moonPos = this.moon ? this.moon.position.clone() : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const mid = moonPos.clone().multiplyScalar(0.5);
    const totalDist = moonPos.length();

    // Required camera distance from the span's angular size vs the SMALLER of
    // the vertical/horizontal FOV (aspect-dependent), plus a 30% margin.
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const limitingFov = Math.min(vFov, hFov);
    const halfSpan = totalDist / 2;
    const camDistance = (halfSpan * 1.3) / Math.tan(limitingFov / 2);

    // View perpendicular to the Earth-Moon line, elevated so the arc's
    // out-of-plane shape reads.
    const spanDir = moonPos.clone().normalize();
    let viewDir = new THREE.Vector3(0, 1, 0).cross(spanDir);
    if (viewDir.lengthSq() < 1e-6) viewDir = new THREE.Vector3(0, 0, 1);
    viewDir.normalize().multiplyScalar(camDistance);
    viewDir.y += camDistance * 0.35;

    this._animateCameraTo(mid.clone().add(viewDir), mid, 2.0);
  }

  followRocket() {
    this._followRocket = true;
  }

  /**
   * Smooth camera transition using GSAP.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} target
   * @param {number} duration - seconds
   */
  _animateCameraTo(position, target, duration = 1.0) {
    // Kill any existing camera tween
    if (this._cameraTween) {
      this._cameraTween.kill();
    }
    if (this._targetTween) {
      this._targetTween.kill();
    }

    this._cameraTween = gsap.to(this.camera.position, {
      x: position.x,
      y: position.y,
      z: position.z,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.controls.update();
      },
    });

    this._targetTween = gsap.to(this.controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration,
      ease: 'power2.inOut',
    });
  }

  /**
   * Legacy smooth camera method (for backwards compat with main.js internal usage).
   */
  animateCameraTo(position, target, durationMs = 1000) {
    this._animateCameraTo(position, target, durationMs / 1000);
  }

  // =========================================================================
  // Smooth Keplerian propagation for SATCAT objects
  // =========================================================================

  /**
   * Update positions of orbital objects that have Keplerian elements.
   * Uses mean anomaly propagation: M = M0 + n * (simTime - epoch)
   * then solves Kepler's equation M -> E -> true anomaly -> 3D position.
   * @param {number} simTime - Current simulation time in seconds (Unix epoch)
   */
  updateKeplerianPositions(simTime) {
    for (const [category, points] of this._orbitalMeshes) {
      const items = this._orbitalCategoryItems.get(category);
      if (!items) continue;

      const posAttr = points.geometry.getAttribute('position');
      let changed = false;

      for (let i = 0; i < items.length; i++) {
        const kep = items[i].keplerian;
        if (!kep) continue;

        const dt = simTime - kep.epoch;
        // Mean anomaly at current time
        let M = kep.trueAnomaly + kep.meanMotion * dt; // approximate: using trueAnomaly as M0
        M = M % (Math.PI * 2);
        if (M < 0) M += Math.PI * 2;

        // Solve Kepler's equation: M = E - e*sin(E) via Newton iteration
        // For near-circular orbits (e ~ 0), E ~ M is a good approximation
        // SATCAT objects typically have low eccentricity data, so use M directly as true anomaly
        const trueAnomaly = M;

        const altKm = kep.semiMajorAxis; // already = 6371 + altKm
        const radius = altKm / 6371; // scene units

        const cosI = Math.cos(kep.inclination), sinI = Math.sin(kep.inclination);
        const cosR = Math.cos(kep.raan), sinR = Math.sin(kep.raan);
        const cosV = Math.cos(trueAnomaly), sinV = Math.sin(trueAnomaly);

        const x = radius * (cosR * cosV - sinR * sinV * cosI);
        const y = radius * sinV * sinI;
        const z = radius * (sinR * cosV + cosR * sinV * cosI);

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;
        changed = true;
      }

      if (changed) {
        posAttr.needsUpdate = true;
      }
    }
  }

  /**
   * Update positions of SGP4-tracked objects using satellite.js propagation.
   * Called each frame for smooth orbital motion.
   * @param {Map<string|number, object>} satrecMap - NORAD_ID -> satrec
   * @param {Date} simDate - Current simulation date
   * @param {function} eciToThreeJsFn - ECI to Three.js coordinate converter
   */
  updateSGP4Positions(satrecMap, simDate, eciToThreeJsFn) {
    if (!satrecMap || satrecMap.size === 0) return;

    // Import satellite.js dynamically would be heavy; instead accept a propagation function
    // The caller (main.js) passes satellite.propagate results via the existing updateOrbitalPositions
    // This method is kept for direct per-frame updates from main.js
  }

  /**
   * Register a per-frame callback for external propagation updates (SGP4 etc.).
   * Called every frame with (elapsedTime, deltaTime).
   * @param {function|null} cb
   */
  setOnBeforeRender(cb) {
    this._onBeforeRenderCallback = typeof cb === 'function' ? cb : null;
  }

  // =========================================================================
  // Animation loop
  // =========================================================================
  animate() {
    if (this._disposed) return;

    this._animationId = requestAnimationFrame(() => this.animate());

    // Clamp delta so a backgrounded-tab resume doesn't teleport damped values.
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();
    const frameScale = delta * 60; // normalize per-frame magic constants to 60fps

    // Controls
    this.controls.update();

    // Earth rotation from REAL sidereal time while idle: geographic longitude
    // L sits at mesh-local angle -L (three.js sphere/texture convention) and
    // the handedness-preserving eciToThreeJs mapping puts Greenwich at GMST —
    // rotation.y = GMST lines the texture up with the ECI frame exactly, so
    // satellites fly over the right geography. While a mission is selected the
    // rotation is FROZEN at the launch epoch's GMST (freezeEarthRotationAt) so
    // the inertial trajectory, beacon and Moon stay mutually consistent.
    if (this.earth && !this._freezeEarthRotation) {
      this.earth.rotation.y = computeGmst(new Date());
    }

    // Clouds ride the Earth's rotation plus a slow eastward drift
    if (this.clouds) {
      this._cloudDrift = (this._cloudDrift || 0) + CLOUD_ROTATION_SPEED * frameScale;
      this.clouds.rotation.y = (this.earth ? this.earth.rotation.y : 0) + this._cloudDrift;
    }

    // Moon orbit (simple circular for default; overridden by external moonPosition)
    this._moonOrbitAngle += MOON_ORBIT_SPEED * frameScale;
    if (this.moon && !this._externalMoonPos) {
      this.moon.position.set(
        Math.cos(this._moonOrbitAngle) * MOON_DISTANCE,
        0,
        Math.sin(this._moonOrbitAngle) * MOON_DISTANCE,
      );
    }

    // Update sun direction on earth / cloud / atmosphere shaders to match sunLight
    const sunDir = this.sunLight.position;
    if (this._earthMaterial && this._earthMaterial.uniforms && this._earthMaterial.uniforms.sunDirection) {
      this._earthMaterial.uniforms.sunDirection.value.copy(sunDir).normalize();
    }
    if (this._cloudMaterial && this._cloudMaterial.uniforms) {
      this._cloudMaterial.uniforms.sunDirection.value.copy(sunDir).normalize();
    }
    if (this._atmosphereMaterial && this._atmosphereMaterial.uniforms) {
      this._atmosphereMaterial.uniforms.sunDirection.value.copy(sunDir).normalize();
    }

    // LOD: switch Points <-> instanced 3D glyphs by camera distance.
    this._updateLOD();

    // Orbital object positions are updated from the propagation worker (see main.js),
    // not re-propagated on the render thread.

    // Per-frame external propagation callback (SGP4 from main.js)
    if (this._onBeforeRenderCallback) {
      this._onBeforeRenderCallback(elapsed, delta);
    }

    // Trajectory animated dash
    if (this._trajectoryMaterial && this._trajectoryMaterial.uniforms) {
      this._trajectoryMaterial.uniforms.time.value = elapsed;
    }

    // Landing site pulse
    if (this._landingMarker) {
      this._landingMarker.traverse((child) => {
        if (child.userData._isPulse) {
          const pulse = 1.0 + Math.sin(elapsed * 4) * 0.4;
          child.scale.set(pulse, pulse, 1);
          if (child.material) {
            child.material.opacity = 0.3 + Math.sin(elapsed * 4) * 0.3;
          }
        }
        if (child.userData._isBeacon && child.material) {
          child.material.opacity = 0.3 + Math.sin(elapsed * 3) * 0.2;
        }
      });
    }

    // Launch site pulse
    if (this._launchMarker) {
      this._launchMarker.traverse((child) => {
        if (child.userData._isPulse) {
          const pulse = 1.0 + Math.sin(elapsed * 5) * 0.3;
          child.scale.set(pulse, pulse, 1);
          if (child.material) {
            child.material.opacity = 0.3 + Math.sin(elapsed * 5) * 0.25;
          }
        }
        if (child.userData._isBeacon && child.material) {
          child.material.opacity = 0.4 + Math.sin(elapsed * 4) * 0.3;
        }
      });
    }

    // Rocket animation
    if (this._rocketAnim && this._rocketAnim.playing && this._rocketCurve) {
      const anim = this._rocketAnim;
      anim.t += delta / anim.duration;
      if (anim.t >= 1.0) {
        anim.t = 1.0;
        anim.playing = false;
        if (this._rocketExhaust) this._rocketExhaust.visible = false;
      }
      this._updateRocketPosition(anim.t);
      if (anim.onProgress) anim.onProgress(anim.t);
    }

    // Keep the selection marker facing the camera and gently pulsing.
    if (this._selectionMarker) {
      this._selectionMarker.lookAt(this.camera.position);
      const s = 1 + Math.sin(elapsed * 5) * 0.25;
      this._selectionMarker.scale.set(s, s, s);
    }

    // Camera follow: keep the orbit target on the rocket / Moon core so the user
    // orbits around it (Earth view targets the origin, handled by focusEarth).
    if (this._followRocket && this._rocket && this._rocket.visible) {
      dampVec3(this.controls.target, this._rocket.position, 6.0, delta);
    } else if (this._followMoon && this.moon) {
      dampVec3(this.controls.target, this.moon.position, 6.0, delta);
    }

    // Render — selective-bloom composer (falls back to direct render).
    if (this._bloom) {
      this._bloom.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // Moon position (external)
  // =========================================================================
  /**
   * @param {{x:number,y:number,z:number}} pos
   */
  setMoonPosition(pos) {
    this._externalMoonPos = true;
    if (this.moon) {
      this.moon.position.set(pos.x, pos.y, pos.z);
    }
  }

  // =========================================================================
  // Earth rotation freeze (align inertial ECI frame with launchDate)
  // =========================================================================
  /**
   * Freeze the cosmetic Earth spin and set its rotation so the surface texture
   * aligns with the ECI frame at the given GMST. The launch beacon is rendered
   * from the true ECI launch point, so the Earth must be rotated by GMST for the
   * beacon to sit over the correct geography.
   * @param {number} gmstRad  Greenwich Mean Sidereal Time in radians.
   */
  freezeEarthRotationAt(gmstRad) {
    this._freezeEarthRotation = true;
    if (this.earth) {
      this.earth.rotation.y = gmstRad;
    }
  }

  /** Resume the cosmetic Earth spin (e.g. when the trajectory is cleared). */
  resumeEarthRotation() {
    this._freezeEarthRotation = false;
  }

  // =========================================================================
  // Resize
  // =========================================================================
  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this._bloom) this._bloom.setSize(w, h);
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Convert geographic coordinates to a 3D position on a sphere.
   * @param {number} lat  Latitude in degrees
   * @param {number} lon  Longitude in degrees
   * @param {number} radius  Sphere radius (default = EARTH_RADIUS)
   * @returns {THREE.Vector3}
   */
  latLonToVector3(lat, lon, radius = EARTH_RADIUS) {
    const phi = (90 - lat) * DEG_TO_RAD;
    const theta = (lon + 180) * DEG_TO_RAD;
    return new THREE.Vector3(
      -(radius * Math.sin(phi) * Math.cos(theta)),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clean up all Three.js resources.
   */
  dispose() {
    this._disposed = true;

    if (this._animationId != null) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }

    // Kill GSAP tweens
    if (this._cameraTween) this._cameraTween.kill();
    if (this._targetTween) this._targetTween.kill();

    this.clearTrajectory();

    // Remove ISS orbit line
    if (this._issOrbitLine) {
      this.scene.remove(this._issOrbitLine);
      if (this._issOrbitLine.geometry) this._issOrbitLine.geometry.dispose();
      if (this._issOrbitLine.material) this._issOrbitLine.material.dispose();
      this._issOrbitLine = null;
    }

    // Remove debris cloud
    if (this._debrisCloud) {
      this.scene.remove(this._debrisCloud);
      if (this._debrisCloud.geometry) this._debrisCloud.geometry.dispose();
      if (this._debrisCloud.material) this._debrisCloud.material.dispose();
      this._debrisCloud = null;
    }

    // Remove markers
    if (this._landingMarker) this.scene.remove(this._landingMarker);
    if (this._launchMarker) this.scene.remove(this._launchMarker);

    // Remove rocket
    if (this._rocket) {
      this.scene.remove(this._rocket);
      this._rocket.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      this._rocket = null;
      this._rocketExhaust = null;
    }

    // Dispose bloom composer
    if (this._bloom) { this._bloom.dispose(); this._bloom = null; }

    // Remove instanced LOD meshes
    for (const inst of this._instanced.values()) {
      this.scene.remove(inst.mesh);
      if (inst.mesh.geometry) inst.mesh.geometry.dispose();
      if (inst.mesh.material) inst.mesh.material.dispose();
      inst.mesh.dispose();
    }
    this._instanced.clear();

    // Remove orbital Points meshes
    for (const points of this._orbitalMeshes.values()) {
      this.scene.remove(points);
      if (points.geometry) points.geometry.dispose();
      if (points.material) points.material.dispose();
    }
    this._orbitalMeshes.clear();
    this._orbitalCategoryItems.clear();
    this._orbitalObjectsData = [];

    // Dispose collected resources
    for (const resource of this._disposables) {
      if (resource && typeof resource.dispose === 'function') {
        resource.dispose();
      }
    }
    this._disposables.length = 0;

    // Scene traversal cleanup
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.controls.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
