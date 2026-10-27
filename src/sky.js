import * as THREE from 'three';
import { TEX } from './textures.js';

/**
 * Sunset sky: single inverted sphere with a hand written shader.
 * Vertical gradient + sun bloom + drifting backlit cloud band + haze.
 */
export function createSky(scene, sunDir) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone().normalize() },
    uClouds: { value: TEX.clouds },
    uSunColor: { value: new THREE.Color(0xffd9a0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform sampler2D uClouds;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        // ---- sky gradient (deep violet zenith -> hot pink -> molten horizon)
        vec3 zenith  = vec3(0.075, 0.020, 0.150);
        vec3 high    = vec3(0.330, 0.045, 0.330);
        vec3 mid     = vec3(0.780, 0.090, 0.330);
        vec3 low     = vec3(1.000, 0.240, 0.190);
        vec3 horizon = vec3(1.000, 0.470, 0.140);

        float t = clamp(h, 0.0, 1.0);
        vec3 col = mix(horizon, low, smoothstep(0.0, 0.055, t));
        col = mix(col, mid, smoothstep(0.035, 0.155, t));
        col = mix(col, high, smoothstep(0.13, 0.30, t));
        col = mix(col, zenith, smoothstep(0.28, 0.72, t));

        // ---- sun glow
        vec3 sd = normalize(uSunDir);
        float cosA = max(dot(d, sd), 0.0);
        float glow   = pow(cosA, 9.0);
        float halo   = pow(cosA, 70.0);
        float disc   = smoothstep(0.99972, 0.99990, cosA);
        col += uSunColor * glow * 0.34 * smoothstep(-0.10, 0.14, h);
        col += uSunColor * halo * 0.42;
        col += vec3(1.0, 0.86, 0.62) * disc * 1.15;

        // ---- backlit sunset clouds
        float az = atan(d.z, d.x) / 6.2831853 + 0.5;
        float band = smoothstep(-0.01, 0.10, h) * (1.0 - smoothstep(0.45, 0.85, h));
        vec2 uv1 = vec2(az * 2.4 + uTime * 0.0022, clamp(h * 1.45 + 0.04, 0.0, 1.0));
        vec2 uv2 = vec2(az * 1.7 - uTime * 0.0014 + 0.37, clamp(h * 2.4 - 0.02, 0.0, 1.0));
        float c1 = texture2D(uClouds, uv1).r;
        float c2 = texture2D(uClouds, uv2).r;
        float cloud = clamp(c1 * 0.9 + c2 * 0.55, 0.0, 1.0);
        cloud = smoothstep(0.10, 0.72, cloud) * band;

        // clouds are lit from the sun side -> warm rims, deep magenta cores
        vec3 warm = mix(vec3(1.00, 0.34, 0.26), vec3(1.00, 0.66, 0.30), pow(cosA, 1.6));
        vec3 cool = vec3(0.38, 0.05, 0.26);
        vec3 cloudCol = mix(cool, warm, clamp(pow(cosA, 0.9) * 1.35, 0.0, 1.0));
        col = mix(col, cloudCol, cloud * 0.85);
        col += warm * cloud * 0.16;

        // ---- hazy far shore / sea horizon below the horizon line
        float below = 1.0 - smoothstep(-0.004, 0.010, h);
        vec3 hazeCol = mix(vec3(0.55, 0.14, 0.26), vec3(1.00, 0.42, 0.16), pow(cosA, 0.55));
        col = mix(col, hazeCol, below * 0.92);

        // subtle dithering against gradient banding
        col += (hash(gl_FragCoord.xy) - 0.5) * 0.006;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 32), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  return {
    mesh: sky,
    update(dt, camera) {
      uniforms.uTime.value += dt;
      sky.position.copy(camera.position);
    },
  };
}
