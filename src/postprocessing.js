import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Objects whose .layers.enable(BLOOM_LAYER) is called will glow via the
// selective-bloom composer. Everything else renders normally with no bloom.
export const BLOOM_LAYER = 1;

/**
 * Layer-gated selective bloom.
 *
 * Technique: render the scene twice.
 *  1. Bloom pass — the camera's layer mask is switched to ONLY the bloom layer,
 *     so exclusively flagged (emissive) objects are drawn; everything else is
 *     black. That render is blurred by UnrealBloomPass into an offscreen target.
 *  2. Final pass — the camera renders the full scene normally, then a mix shader
 *     additively composites the blurred bloom target on top, and OutputPass
 *     applies tone-mapping + color-space conversion.
 *
 * The camera-layer variant (vs. the material-swap variant in the three.js docs)
 * is used because this scene contains Points / Lines / Sprites, which the
 * material-swap approach does not darken correctly.
 */
export class SelectiveBloom {
  constructor(renderer, scene, camera, width, height, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const strength = opts.strength ?? 1.5;
    const radius = opts.radius ?? 0.6;
    const threshold = opts.threshold ?? 0.0;

    const renderScene = new RenderPass(scene, camera);

    // --- Bloom composer (renders only the bloom layer, blurs it) ---
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      strength,
      radius,
      threshold,
    );
    this.bloomComposer = new EffectComposer(renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(this.bloomPass);

    // --- Mix pass (base scene + additive bloom) ---
    this.mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
          }
        `,
      }),
      'baseTexture',
    );
    this.mixPass.needsSwap = true;

    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(this.mixPass);
    this.finalComposer.addPass(new OutputPass());
  }

  setSize(width, height) {
    this.bloomComposer.setSize(width, height);
    this.finalComposer.setSize(width, height);
  }

  render() {
    const camera = this.camera;
    const savedMask = camera.layers.mask;

    // Pass 1: only the bloom layer contributes.
    camera.layers.set(BLOOM_LAYER);
    this.bloomComposer.render();

    // Pass 2: full scene + composited bloom.
    camera.layers.mask = savedMask;
    this.finalComposer.render();
  }

  dispose() {
    this.bloomComposer.dispose();
    this.finalComposer.dispose();
  }
}
