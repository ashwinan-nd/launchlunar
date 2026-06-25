import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EARTH_RADIUS = 1.0;
const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS = 0.2727; // 1737.4 / 6371
const MOON_DISTANCE = 60.3; // ~384400 / 6371
const EARTH_SEGMENTS = 128;
const EARTH_ROTATION_SPEED = 0.0001;
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
  gps: 0x32cd32,
  weather: 0x87ceeb,
  station: 0xffd700,
  glonass: 0xff6347,
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
  starlink: 1.0,
  debris: 1.0,
  'rocket body': 1.5,
  rocket_body: 1.5,
  weather: 2.0,
};

function getPointSize(category) {
  const key = category.toLowerCase();
  return CATEGORY_POINT_SIZES[key] ?? 3;
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
// Earth Day/Night Shader — fully opaque, vegetation boost
// ---------------------------------------------------------------------------
function createEarthShaderMaterial(dayTex, nightTex, bumpTex) {
  const uniforms = {
    dayTexture: { value: dayTex },
    nightTexture: { value: nightTex },
    bumpTexture: { value: bumpTex },
    sunDirection: { value: new THREE.Vector3(1.0, 0.3, 0.5).normalize() },
    bumpScale: { value: 0.03 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayTexture;
      uniform sampler2D nightTexture;
      uniform sampler2D bumpTexture;
      uniform vec3 sunDirection;
      uniform float bumpScale;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 normal = normalize(vNormal);

        // Perturb normal with bump map for lighting variation
        if (bumpScale > 0.0) {
          float bumpVal = texture2D(bumpTexture, vUv).r;
          float dx = dFdx(bumpVal) * bumpScale;
          float dy = dFdy(bumpVal) * bumpScale;
          normal = normalize(normal + vec3(dx, dy, 0.0));
        }

        float NdotL = dot(normal, sunDirection);

        // Smooth transition zone between day and night
        float dayFactor = smoothstep(-0.15, 0.25, NdotL);

        vec4 dayColor = texture2D(dayTexture, vUv);
        vec4 nightColor = texture2D(nightTexture, vUv);

        // Boost green channel for vegetation visibility
        dayColor.g = dayColor.g * 1.15;
        dayColor.rgb = mix(dayColor.rgb, dayColor.rgb * vec3(0.9, 1.2, 0.85), step(0.3, dayColor.g));

        // Night lights glow stronger in dark areas
        vec3 nightGlow = nightColor.rgb * 1.6;

        vec3 color = mix(nightGlow, dayColor.rgb, dayFactor);

        // Add subtle specular highlight for oceans (darker areas in bump map)
        float specular = pow(max(0.0, dot(reflect(-sunDirection, normal), normalize(-vWorldPosition))), 32.0);
        float bumpHeight = texture2D(bumpTexture, vUv).r;
        float oceanMask = 1.0 - smoothstep(0.0, 0.3, bumpHeight);
        color += vec3(0.3, 0.4, 0.5) * specular * oceanMask * dayFactor * 0.4;

        // Subtle ambient light on the dark side
        color += dayColor.rgb * 0.015;

        // 5% transparent Earth
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Atmosphere inner-glow shader (BackSide, NormalBlending, low opacity)
// ---------------------------------------------------------------------------
function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x4488ff) },
      coefficient: { value: 0.6 },
      power: { value: 3.5 },
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
        gl_FragColor = vec4(glowColor, fresnel * 0.25);
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
        float dash = sin((vUv.x * dashScale - time * 3.0) * 3.14159) * 0.5 + 0.5;
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
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 2.0);
    this.sunLight.position.set(100, 30, 50);
    this.scene.add(this.sunLight);

    const hemiLight = new THREE.HemisphereLight(0x4488cc, 0x0a0a2a, 0.1);
    this.scene.add(hemiLight);

    // ---- Build world ----
    this._loadAndBuild();
  }

  // =========================================================================
  // Async texture loading + scene building
  // =========================================================================
  async _loadAndBuild() {
    // Load textures from local public folder
    const [dayTex, nightTex, cloudTex, bumpTex, moonTex, starTex] = await Promise.all([
      loadTexture('/textures/earth-day.jpg'),
      loadTexture('/textures/earth-night.jpg'),
      loadTexture('/textures/earth-clouds.png'),  // may not exist
      loadTexture('/textures/earth-bump.png'),
      loadTexture('/textures/moon.jpg'),           // may not exist — procedural fallback
      loadTexture('/textures/starfield.png'),
    ]);

    if (this._disposed) return;

    // Set texture properties
    for (const tex of [dayTex, nightTex, cloudTex, bumpTex, moonTex, starTex]) {
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        this._disposables.push(tex);
      }
    }

    this._createStarfield(starTex);
    this._createEarth(dayTex, nightTex, cloudTex, bumpTex);
    this._createMoon(moonTex);
    this._addDebrisCloud();

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
  _createEarth(dayTex, nightTex, cloudTex, bumpTex) {
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS);
    this._disposables.push(earthGeo);

    // Earth pivot for axial tilt
    this.earthPivot = new THREE.Group();
    this.earthPivot.rotation.z = EARTH_AXIAL_TILT;
    this.scene.add(this.earthPivot);

    if (dayTex && nightTex) {
      // Custom day/night shader — fully opaque, depthWrite on
      this._earthMaterial = createEarthShaderMaterial(dayTex, nightTex, bumpTex);
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

    // Cloud layer (separate sphere OUTSIDE Earth, opacity 0.55)
    if (cloudTex) {
      const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.005, EARTH_SEGMENTS, EARTH_SEGMENTS);
      const cloudMat = new THREE.MeshStandardMaterial({
        map: cloudTex,
        alphaMap: cloudTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
      this.earthPivot.add(this.clouds);
      this._disposables.push(cloudGeo, cloudMat);
    }

    // Atmosphere inner glow — SEPARATE mesh, BackSide, NormalBlending, low opacity
    const atmosGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 64);
    const atmosMat = createAtmosphereMaterial();
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
    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, 64, 64);
    this._disposables.push(moonGeo);

    if (moonTex) {
      const moonMat = new THREE.MeshStandardMaterial({
        map: moonTex,
        bumpMap: moonTex,
        bumpScale: 0.015,
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

    for (const [category, items] of groups) {
      const positions = new Float32Array(items.length * 3);
      for (let i = 0; i < items.length; i++) {
        positions[i * 3] = items[i].position.x;
        positions[i * 3 + 1] = items[i].position.y;
        positions[i * 3 + 2] = items[i].position.z;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const color = getCategoryColorHex(category);
      const pointSize = getPointSize(category);

      const material = new THREE.PointsMaterial({
        color,
        size: pointSize,
        sizeAttenuation: false, // Fixed screen-space size
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 2; // Render after Earth (0) and atmosphere (-1)
      this.scene.add(points);
      this._orbitalMeshes.set(category, points);
      this._orbitalCategoryItems.set(category, items);
      this._categoryCounts.set(category, items.length);

      this._disposables.push(geometry, material);

      // ISS orbit path: draw a thin dashed ring at ISS orbital altitude
      if (category === 'iss' && items.length > 0) {
        this._createISSOrbitPath(items[0]);
      }
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
   * Toggle visibility of an orbital category.
   * @param {string} category
   * @param {boolean} visible
   */
  setCategoryVisibility(category, visible) {
    const mesh = this._orbitalMeshes.get(category);
    if (mesh) mesh.visible = visible;
    // Handle variant keys
    const altKey = category.includes('_') ? category.replace('_', ' ') : category.replace(' ', '_');
    const altMesh = this._orbitalMeshes.get(altKey);
    if (altMesh) altMesh.visible = visible;
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

    // Extend trajectory to Moon if the last point is far from Moon position
    const moonPos = this.moon
      ? this.moon.position.clone()
      : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const lastPoint = points[points.length - 1];
    const distToMoon = lastPoint.distanceTo(moonPos);

    // If last point is more than 2 Moon-radii away from Moon center, extend
    if (distToMoon > MOON_RADIUS * 2) {
      // Add interpolated points from last waypoint toward Moon surface
      const moonSurface = moonPos.clone().add(
        lastPoint.clone().sub(moonPos).normalize().multiplyScalar(MOON_RADIUS)
      );
      const extensionSteps = 20;
      for (let i = 1; i <= extensionSteps; i++) {
        const t = i / extensionSteps;
        const interp = new THREE.Vector3().lerpVectors(lastPoint, moonSurface, t);
        points.push(interp);
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

    // Outer glow tube
    const glowGeo = new THREE.TubeGeometry(curve, Math.floor(tubularSegments / 2), tubeRadius * 2.5, 6, false);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
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

    // Nose cone
    const noseGeo = new THREE.ConeGeometry(r, h * 0.2, 8);
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
      roughness: 0.2,
      metalness: 0.6,
    });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.y = h * 0.5;
    this._rocket.add(nose);
    this._disposables.push(noseGeo, noseMat);

    // Body
    const bodyGeo = new THREE.CylinderGeometry(r, r, h * 0.55, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      emissive: 0xf0f0f0,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.4,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h * 0.125;
    this._rocket.add(body);
    this._disposables.push(bodyGeo, bodyMat);

    // Color band
    const bandGeo = new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.06, 8);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x1a73e8,
      emissive: 0x1a73e8,
      emissiveIntensity: 0.5,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = h * 0.2;
    this._rocket.add(band);
    this._disposables.push(bandGeo, bandMat);

    // Engine nozzle (inverted cone)
    const nozzleGeo = new THREE.ConeGeometry(r * 0.8, h * 0.12, 8);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.7,
    });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.x = Math.PI; // inverted
    nozzle.position.y = -h * 0.32;
    this._rocket.add(nozzle);
    this._disposables.push(nozzleGeo, nozzleMat);

    // 4 fins
    const finGeo = new THREE.BoxGeometry(r * 0.15, h * 0.15, r * 2.5);
    const finMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      emissive: 0xeeeeee,
      emissiveIntensity: 0.15,
      roughness: 0.3,
      metalness: 0.3,
    });
    this._disposables.push(finGeo, finMat);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeo, finMat);
      const angle = (i / 4) * TWO_PI;
      fin.position.set(
        Math.cos(angle) * r * 0.8,
        -h * 0.28,
        Math.sin(angle) * r * 0.8,
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
    this._animateCameraTo(
      new THREE.Vector3(0, 1.5, 3),
      new THREE.Vector3(0, 0, 0),
      1.2,
    );
  }

  focusMoon() {
    this._followRocket = false;
    const moonPos = this.moon ? this.moon.position.clone() : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const offset = new THREE.Vector3(0, 0.3, 1.5);
    this._animateCameraTo(
      moonPos.clone().add(offset),
      moonPos,
      1.5,
    );
  }

  focusTrajectory() {
    this._followRocket = false;
    const moonPos = this.moon ? this.moon.position.clone() : new THREE.Vector3(MOON_DISTANCE, 0, 0);
    const mid = moonPos.clone().multiplyScalar(0.45);
    const totalDist = moonPos.length();
    const camPos = new THREE.Vector3(
      mid.x,
      totalDist * 0.8,
      mid.z + totalDist * 0.3,
    );
    this._animateCameraTo(camPos, mid, 2.0);
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

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Controls
    this.controls.update();

    // Earth rotation
    if (this.earth) {
      this.earth.rotation.y += EARTH_ROTATION_SPEED;
    }

    // Cloud rotation (slightly different speed)
    if (this.clouds) {
      this.clouds.rotation.y += CLOUD_ROTATION_SPEED;
    }

    // Moon orbit (simple circular for default; overridden by external moonPosition)
    this._moonOrbitAngle += MOON_ORBIT_SPEED;
    if (this.moon && !this._externalMoonPos) {
      this.moon.position.set(
        Math.cos(this._moonOrbitAngle) * MOON_DISTANCE,
        0,
        Math.sin(this._moonOrbitAngle) * MOON_DISTANCE,
      );
    }

    // Update sun direction on earth shader to match sunLight
    if (this._earthMaterial && this._earthMaterial.uniforms && this._earthMaterial.uniforms.sunDirection) {
      this._earthMaterial.uniforms.sunDirection.value.copy(this.sunLight.position).normalize();
    }

    // Smooth Keplerian propagation for SATCAT objects every frame
    const simTimeSec = Date.now() / 1000;
    this.updateKeplerianPositions(simTimeSec);

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

    // Follow rocket camera
    if (this._followRocket && this._rocket && this._rocket.visible) {
      const rocketPos = this._rocket.position.clone();
      const offset = new THREE.Vector3(0.1, 0.05, 0.15);
      this.camera.position.lerp(rocketPos.clone().add(offset), 0.05);
      this.controls.target.lerp(rocketPos, 0.05);
    }

    // Render
    this.renderer.render(this.scene, this.camera);
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
  // Resize
  // =========================================================================
  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
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
