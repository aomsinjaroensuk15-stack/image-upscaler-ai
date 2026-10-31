/**
 * Static host for the built upscaler.
 *
 * There is no server-side logic: every byte the app needs is either in dist/,
 * downloaded from jsDelivr (ONNX Runtime WASM) or from the model host.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
