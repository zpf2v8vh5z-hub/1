/* Module resolve hook: redirects the bare specifier "three" to the stub that
   swaps only the WebGL renderer. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return {
      url: new URL("./stubs/three-boot.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
