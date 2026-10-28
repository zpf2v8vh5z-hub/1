/**
 * The Pacific around San Andreas plus all inland water (Alamo Sea, lakes, LS
 * docks). One plane at sea level, textured with the AI ocean tile, animated with
 * two scrolling layers and a sun glitter band.
 *
 * The height field has 0 m for every water surface, so a single plane at
 * SEA_LEVEL covers ocean and inland lakes alike.
 */
import * as THREE from 'three';
import { WORLD, SEA_LEVEL } from './config.js';
import { TEX } from '../textures.js';

export class Water {
  constructor(terrain) {
    this.terrain = terrain;
    this.time = 0;
    this.mesh = null;
  }

  build(scene) {
    const w = WORLD.width * 2.4;
    const h = WORLD.height * 2.4;
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD.cx, SEA_LEVEL, WORLD.cy);

    const ocean = TEX.ocean ? TEX.ocean.clone() : null;
    if (ocean) {
      ocean.wrapS = ocean.wrapT = THREE.RepeatWrapping;
      ocean.needsUpdate = true;
    }

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: ocean },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(-0.46, 0.10, 1).normalize() },
        uDeep: { value: new THREE.Color(0x0a2a3a) },
        uShallow: { value: new THREE.Color(0x2f7f8f) },
        uFogColor: { value: new THREE.Color(0xea7d92) },
        uFogDensity: { value: 0.00017 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform vec3 uSun, uDeep, uShallow, uFogColor;
        uniform float uFogDensity;
        varying vec3 vWorld;

        void main() {
          // two scrolling samples of the AI water tile = moving swell
          vec2 uv1 = vWorld.xz * 0.015 + vec2(uTime * 0.004, uTime * 0.0025);
          vec2 uv2 = vWorld.xz * 0.031 + vec2(-uTime * 0.006, uTime * 0.0035);
          vec3 a = texture2D(uMap, uv1).rgb;
          vec3 b = texture2D(uMap, uv2).rgb;
          float wave = (a.g + b.g) * 0.5;

          vec3 base = mix(uDeep, uShallow, smoothstep(0.25, 0.85, wave));
          base += a.rgb * 0.28;

          // fake normal from the two layers for specular glitter
          float nx = (a.r - b.r) * 1.6;
          float nz = (a.b - b.b) * 1.6;
          vec3 n = normalize(vec3(nx, 3.2, nz));
          vec3 view = normalize(cameraPosition - vWorld);
          vec3 sun = normalize(uSun);
          float spec = pow(max(dot(reflect(-sun, n), view), 0.0), 90.0);
          float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);

          vec3 col = base + vec3(1.0, 0.72, 0.45) * spec * 2.4;
          col = mix(col, vec3(0.95, 0.68, 0.62), fres * 0.55);

          float dist = length(cameraPosition - vWorld);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
    return this;
  }

  update(dt) {
    this.time += dt;
    if (this.material) this.material.uniforms.uTime.value = this.time;
  }
}
