import * as THREE from 'three';
import { TEX } from './textures.js';

/**
 * Wet asphalt with a real-time planar reflection.
 *
 * The mirror-camera / texture-matrix math is adapted from three.js'
 * `Reflector` (examples/jsm/objects/Reflector.js, MIT licensed, three.js authors);
 * the material is replaced by a custom shader that blends the reflected scene
 * with the AI-generated wet asphalt texture, a puddle mask and sun glitter.
 */
export class WetRoad extends THREE.Mesh {
  constructor(width, length, {
    resolution = 1024,
    repeat = [4, 150],
    clipBias = 0.0035,
    textureWidth = 1024,
    textureHeight = 1024,
  } = {}) {
    const geometry = new THREE.PlaneGeometry(width, length);
    const rt = new THREE.WebGLRenderTarget(textureWidth, textureHeight, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      depthBuffer: true,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: TEX.asphalt },
        uNormalMap: { value: TEX.asphaltNormal },
        uReflection: { value: rt.texture },
        textureMatrix: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uRepeatX: { value: repeat[0] },
        uRepeatY: { value: repeat[1] },
        uSunDir: { value: new THREE.Vector3(-0.34, 0.09, 1).normalize() },
        uSunColor: { value: new THREE.Color(0xffa06a) },
        uReflectivity: { value: 0.92 },
      },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 vUvProj;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vUvProj = textureMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap;
        uniform sampler2D uNormalMap;
        uniform sampler2D uReflection;
        uniform float uTime, uRepeatX, uRepeatY, uReflectivity;
        uniform vec3 uSunDir, uSunColor;
        varying vec4 vUvProj;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec2 tiled = vUv * vec2(uRepeatX, uRepeatY);
          vec3 base = texture2D(uMap, tiled).rgb;
          vec3 nrm = texture2D(uNormalMap, tiled).rgb * 2.0 - 1.0;

          vec3 viewDir = normalize(cameraPosition - vWorldPos);

          // ---- wetness: broad puddle patches + fine damp asphalt
          float puddles = noise(vWorldPos.xz * 0.035) * 0.65 + noise(vWorldPos.xz * 0.11) * 0.35;
          float wet = smoothstep(0.32, 0.78, puddles);
          wet = mix(0.42, 1.0, wet);

          // ---- reflection with ripple distortion
          vec4 proj = vUvProj;
          vec2 ripple = nrm.xy * (0.05 + 0.09 * wet);
          proj.xy += ripple * proj.w * 0.06;

          // soft, distance-aware blur
          float blur = (0.0016 + 0.006 * (1.0 - wet)) * proj.w;
          vec3 refl = vec3(0.0);
          refl += texture2DProj(uReflection, proj).rgb * 0.36;
          refl += texture2DProj(uReflection, proj + vec4(blur, blur * 0.4, 0.0, 0.0)).rgb * 0.16;
          refl += texture2DProj(uReflection, proj - vec4(blur, blur * 0.4, 0.0, 0.0)).rgb * 0.16;
          refl += texture2DProj(uReflection, proj + vec4(blur * 0.5, blur * 2.2, 0.0, 0.0)).rgb * 0.16;
          refl += texture2DProj(uReflection, proj - vec4(blur * 0.5, blur * 2.2, 0.0, 0.0)).rgb * 0.16;
          refl /= 1.0;

          // ---- Fresnel
          float fres = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.2);
          float k = mix(0.20, 0.90, fres) * wet * uReflectivity;

          // ---- sun glitter + warm sheen
          vec3 sunAz = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
          vec3 toFrag = normalize(vec3(vWorldPos.x - cameraPosition.x, 0.0, vWorldPos.z - cameraPosition.z));
          float align = max(dot(toFrag, sunAz), 0.0);
          float path = pow(align, 5.0);
          float sparkle = smoothstep(0.55, 1.0, nrm.x * 0.5 + nrm.y * 0.5 + 0.5);
          vec3 glitter = uSunColor * path * (0.28 + sparkle * 0.5) * wet;

          // ---- asphalt body
          vec3 col = base * 0.42;
          col += uSunColor * 0.14 * max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
          col = col * (1.0 - k) + refl * k;
          col += glitter;

          // fade the mirror out when looking straight down (wet asphalt, not glass)
          col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.004;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    super(geometry, material);

    this.isWetRoad = true;
    this.camera = new THREE.PerspectiveCamera();
    this.renderTarget = rt;
    this.clipBias = clipBias;
    this.textureMatrix = material.uniforms.textureMatrix.value;

    this._plane = new THREE.Plane();
    this._normal = new THREE.Vector3();
    this._reflectorWorldPosition = new THREE.Vector3();
    this._cameraWorldPosition = new THREE.Vector3();
    this._rotationMatrix = new THREE.Matrix4();
    this._lookAtPosition = new THREE.Vector3(0, 0, -1);
    this._clipPlane = new THREE.Vector4();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._q = new THREE.Vector4();
    this._hidden = [];
  }

  /** hide these objects while rendering the mirror pass */
  hide(objects) { this._hidden = objects.filter(Boolean); return this; }

  update(renderer, scene, camera, dt = 0.016) {
    this.material.uniforms.uTime.value += dt;

    const { _plane, _normal, _reflectorWorldPosition, _cameraWorldPosition, _rotationMatrix,
      _lookAtPosition, _clipPlane, _view, _target, _q } = this;

    _reflectorWorldPosition.setFromMatrixPosition(this.matrixWorld);
    _cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

    _rotationMatrix.extractRotation(this.matrixWorld);
    _normal.set(0, 0, 1).applyMatrix4(_rotationMatrix);

    _view.subVectors(_reflectorWorldPosition, _cameraWorldPosition);
    if (_view.dot(_normal) > 0) return; // camera is behind the mirror
    _view.reflect(_normal).negate();
    _view.add(_reflectorWorldPosition);

    _rotationMatrix.extractRotation(camera.matrixWorld);
    _lookAtPosition.set(0, 0, -1).applyMatrix4(_rotationMatrix).add(_cameraWorldPosition);

    _target.subVectors(_reflectorWorldPosition, _lookAtPosition);
    _target.reflect(_normal).negate();
    _target.add(_reflectorWorldPosition);

    const vc = this.camera;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rotationMatrix).reflect(_normal);
    vc.lookAt(_target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    // texture matrix
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);
    this.textureMatrix.multiply(this.matrixWorld);

    // oblique near plane clipping so nothing below the mirror leaks in
    _plane.setFromNormalAndCoplanarPoint(_normal, _reflectorWorldPosition);
    _plane.applyMatrix4(vc.matrixWorldInverse);

    _clipPlane.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const projectionMatrix = vc.projectionMatrix;
    const q = _q;
    q.x = (Math.sign(_clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(_clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
    _clipPlane.multiplyScalar(2.0 / _clipPlane.dot(q));
    projectionMatrix.elements[2] = _clipPlane.x;
    projectionMatrix.elements[6] = _clipPlane.y;
    projectionMatrix.elements[10] = _clipPlane.z + 1.0 - this.clipBias;
    projectionMatrix.elements[14] = _clipPlane.w;

    // ---- render the mirror pass
    const rt = this.renderTarget;
    this.visible = false;
    const hiddenState = this._hidden.map((o) => o.visible);
    this._hidden.forEach((o) => { o.visible = false; });

    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(false); // keep the mirror's depth buffer
    renderer.clear();
    renderer.render(scene, vc);

    this.visible = true;
    this._hidden.forEach((o, i) => { o.visible = hiddenState[i]; });
    renderer.setRenderTarget(prevRT);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  setSize(w, h) {
    this.renderTarget.setSize(Math.max(256, Math.floor(w)), Math.max(256, Math.floor(h)));
  }
}
