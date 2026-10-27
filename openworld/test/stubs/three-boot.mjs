/* three.js with a stand-in renderer, so main.js can be executed headless.
   Everything else is the real library — only the WebGL renderer is faked,
   because the sandbox has no GPU. Explicit exports win over `export *`, which
   is how the renderer is replaced here. */

export * from "../../vendor/three.module.js";

export class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas || { style: {} };
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true };
    this.capabilities = { isWebGL2: true };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = "";
    this.info = { render: { calls: 0, triangles: 0 } };
    this.renderCount = 0;
    this._context = {
      getParameter: () => "WebGL 2.0 (headless stub)",
      VERSION: "WebGL 2.0 (headless stub)",
    };
  }
  setPixelRatio() {}
  setSize(w, h) { this.width = w; this.height = h; }
  setClearColor() {}
  setAnimationLoop() {}
  getContext() { return this._context; }
  compile() {}
  dispose() {}
  render() { this.renderCount++; }
}
