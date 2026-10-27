import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Final grade: chromatic aberration, filmic contrast, vignette, grain. Runs in display space. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.055 },
    uAberration: { value: 0.0016 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration grows towards the frame edges
      float k = uAberration * (0.35 + r2 * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * k).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * k).b;

      // filmic S-curve + split tone (cool shadows, warm highlights)
      col = clamp(col, 0.0, 1.0);
      col = pow(col, vec3(0.96, 0.99, 1.04));
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += vec3(-0.012, 0.004, 0.028) * (1.0 - lum);
      col += vec3(0.028, 0.010, -0.014) * lum;
      col = mix(vec3(lum), col, 1.12);

      // vignette
      float v = 1.0 - uVignette * smoothstep(0.18, 0.92, r2 * 2.0);
      col *= v;

      // grain
      float g = hash(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - lum));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera, { quality = 'high' } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    quality === 'high' ? 0.42 : 0.34,  // strength
    quality === 'high' ? 0.72 : 0.6,   // radius
    0.86                                // threshold
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  grade.renderToScreen = true;
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    render(dt) {
      grade.uniforms.uTime.value += dt;
      composer.render(dt);
    },
    setGrain(v) { grade.uniforms.uGrain.value = v; },
  };
}
