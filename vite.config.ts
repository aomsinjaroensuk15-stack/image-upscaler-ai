import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * ONNX Runtime Web pulls its ~23 MB WASM binary in through `new URL(..., import.meta.url)`,
 * so the bundler copies it into the build. We load that binary from a pinned CDN instead
 * (see `ort.env.wasm.wasmPaths` in the worker), which keeps the deployed bundle small
 * enough to host anywhere with a per-file size limit.
 */
function dropOrtWasm(): Plugin {
  return {
    name: 'drop-ort-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/^assets\/ort-wasm-.*\.wasm$/.test(fileName)) delete bundle[fileName]
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropOrtWasm()],
})
