# Upscaler · AI image upscaling in the browser

A free, private AI image upscaler. Real-ESRGAN runs **on your own machine** through ONNX Runtime
Web — with WebGPU when available and WASM as a fallback. There is no backend, no API key, and no
upload: your images never leave the browser tab.

![status](https://img.shields.io/badge/100%25-local-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

**Live:** <https://site-e9e71010b4a34c7aa822ae8a8a79b2c7.freebuff.page>

## Features

- **4× super-resolution** with Real-ESRGAN, plus a 2× output option
- **Three models**: a fast general model, an anime/illustration model, and a heavy photo model
- **WebGPU first**, automatic WASM/CPU fallback
- **Tiled inference**, so images larger than the model's sweet spot still work without running out of GPU memory
- **Runs in a Web Worker** — the UI stays responsive and progress is reported per tile
- **Models cached** in Cache Storage after the first download
- **Transparency preserved** (PNG alpha is resampled alongside the RGB output)
- **Before/after comparison slider** and a one-click PNG download

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL and drop in an image (or paste one with Ctrl/Cmd+V).

```bash
npm run build     # type-check + production bundle in dist/
npm run preview   # serve the production build locally
npm run lint      # oxlint
```

## Deploying

`dist/` is a plain static site (under 1 MB) — GitHub Pages, Netlify, Cloudflare Pages or any static
host works. [deploy/](deploy) holds the Sites manifest and an asset-only Worker used for the live
deployment above:

```bash
npm run build
# then upload deploy/manifest.json with your host's deployer
```

For hosting on a subpath (like `user.github.io/image-upscaler-ai/`), set
`base: '/image-upscaler-ai/'` in `vite.config.ts`.

The ~23 MB ONNX Runtime WASM binary is deliberately not shipped: it would exceed per-file limits
on most static hosts, so `src/upscaler/upscaler.worker.ts` loads it from jsDelivr pinned to the
exact `onnxruntime-web` version in `package.json`. Keep those two versions in sync when upgrading.

## How it works

1. The image is decoded to pixels and sent to `src/upscaler/upscaler.worker.ts`.
2. On the first run the chosen model (~5–67 MB ONNX) is downloaded from Hugging Face and cached.
3. An `ort.InferenceSession` is created with the `webgpu` execution provider; if that fails the
   `wasm` provider is used instead.
4. The image is split into 128 px tiles with a 10 px padded border, each tile is run through the
   network, and the padded edges are cropped out before the tiles are stitched back together. This
   is what keeps memory bounded and hides seams.
5. The result is encoded as PNG and returned to the main thread for preview and download.

The network has a fixed 4× scale. A 2× request is produced by downsampling the 4× result with
high-quality canvas smoothing.

### Project layout

```
src/
  App.tsx                     UI shell, file input, drag & drop, paste
  components/CompareSlider.tsx  before/after viewer
  components/ModelPicker.tsx    model selection cards
  upscaler/
    models.ts                 model registry (URLs, sizes)
    protocol.ts               worker message types
    upscaler.worker.ts        ONNX Runtime, tiling, stitching
    useUpscaler.ts            React hook owning the worker
```

## Models

All weights are official Real-ESRGAN ONNX exports (BSD-3-Clause), hosted at
[`relax123666/clearpic-models`](https://huggingface.co/relax123666/clearpic-models) with open CORS so
the browser can fetch them directly.

| Model | Size | Best for |
| --- | --- | --- |
| `realesr-general-x4v3` | 4.9 MB | General photos, screenshots, mixed content (default) |
| `RealESRGAN_x4plus_anime_6B` | 17.9 MB | Anime, manga, illustrations, flat art |
| `RealESRGAN_x4plus` | 67 MB | Detailed real photos |

To point at your own weights, change `MODEL_BASE_URL` in `src/upscaler/models.ts`.

## Limitations

- Inputs are capped at **4 megapixels** to stay inside browser memory limits.
- CPU-only machines are slow: expect tens of seconds for a 1 MP image. WebGPU is dramatically faster.
- Multi-threaded WASM is disabled because it needs cross-origin isolation (`COOP`/`COEP`) headers that
  simple static hosting cannot provide. If you serve the app behind such headers, set
  `ort.env.wasm.numThreads` in the worker to `navigator.hardwareConcurrency`.
- The app must be served over HTTPS or `localhost` (WebGPU and workers need a secure context).

## Credits

- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) by Xintao Wang et al. (BSD-3-Clause)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (MIT)
- ONNX weight exports by [relax123666](https://huggingface.co/relax123666/clearpic-models)

## License

MIT — see [LICENSE](LICENSE). Model weights keep their own BSD-3-Clause license.
