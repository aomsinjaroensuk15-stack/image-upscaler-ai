/**
 * Inference worker.
 *
 * Runs Real-ESRGAN in tiles on the visitor's own machine. Nothing is uploaded:
 * the model weights are downloaded once, cached, and executed with ONNX Runtime Web.
 */
import * as ort from 'onnxruntime-web';
import { getModel, modelUrl, type UpscaleModel } from './models';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Side length of an inference tile, in source pixels. */
const TILE_SIZE = 128;
/** Context padding around each tile so seams do not show. */
const TILE_PAD = 10;
const MODEL_CACHE = 'upscaler-models-v1';

const ctx = self as unknown as {
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  location: Location;
  navigator: Navigator;
};

// Threads stay off because plain static hosting cannot send the cross-origin
// isolation headers multi-threaded WASM needs.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

// The runtime's WASM binary is ~23 MB, larger than most static hosts accept for a
// single file, so it is loaded from a CDN build pinned to the exact bundled version.
// Every other module (ONNX Runtime JS, models) ships with the app or its model host.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';

let sessionCache: { modelId: string; session: ort.InferenceSession; provider: 'webgpu' | 'wasm' } | null =
  null;
let activeJob: string | null = null;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

async function readCachedModel(model: UpscaleModel): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(model.file);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function fetchModel(
  model: UpscaleModel,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(modelUrl(model));
  if (!response.ok) {
    throw new Error(`Could not download ${model.name} (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get('content-length') ?? model.bytes);
  const reader = response.body?.getReader();
  if (!reader) return await response.arrayBuffer();

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Best-effort cache write; a quota error only means we re-download next time.
  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(model.file, new Response(bytes.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    /* ignore */
  }

  return bytes.buffer;
}

async function getSession(
  model: UpscaleModel,
  onProgress: (progress: number, detail: string) => void,
): Promise<{ session: ort.InferenceSession; provider: 'webgpu' | 'wasm' }> {
  if (sessionCache && sessionCache.modelId === model.id) {
    return { session: sessionCache.session, provider: sessionCache.provider };
  }
  if (sessionCache) {
    await sessionCache.session.release();
    sessionCache = null;
  }

  onProgress(0, 'Checking local cache');
  let buffer = await readCachedModel(model);
  if (!buffer) {
    buffer = await fetchModel(model, (loaded, total) => {
      const share = total > 0 ? loaded / total : 0;
      onProgress(share, `Downloading ${model.name} · ${Math.round(share * 100)}%`);
    });
  }

  onProgress(1, 'Starting inference engine');
  const webgpu = 'gpu' in ctx.navigator;
  let provider: 'webgpu' | 'wasm' = 'wasm';
  let session: ort.InferenceSession;
  if (webgpu) {
    try {
      session = await ort.InferenceSession.create(buffer, { executionProviders: ['webgpu'] });
      provider = 'webgpu';
    } catch {
      session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
    }
  } else {
    session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
  }

  sessionCache = { modelId: model.id, session, provider };
  return { session, provider };
}

interface TilePlan {
  x: number;
  y: number;
  sx0: number;
  sy0: number;
  sx1: number;
  sy1: number;
}

function planTiles(width: number, height: number): TilePlan[] {
  const tiles: TilePlan[] = [];
  for (let y = 0; y < height; y += TILE_SIZE) {
    for (let x = 0; x < width; x += TILE_SIZE) {
      tiles.push({
        x,
        y,
        sx0: Math.max(0, x - TILE_PAD),
        sy0: Math.max(0, y - TILE_PAD),
        sx1: Math.min(width, x + TILE_SIZE + TILE_PAD),
        sy1: Math.min(height, y + TILE_SIZE + TILE_PAD),
      });
    }
  }
  return tiles;
}

function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

/**
 * Upscales `bitmap` with the given model and returns a new bitmap.
 * The network is fixed at x4; a 2x request is downsampled afterwards.
 */
async function upscale(
  jobId: string,
  bitmap: ImageBitmap,
  model: UpscaleModel,
  outputScale: 2 | 4,
): Promise<void> {
  const startedAt = performance.now();
  const { session, provider } = await getSession(model, (progress, detail) => {
    post({ type: 'progress', jobId, progress: progress * 0.25, detail });
  });

  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
  context.drawImage(bitmap, 0, 0);
  const source = context.getImageData(0, 0, width, height).data;
  const transparent = hasTransparency(source);

  const scale = model.scale;
  const outWidth = width * scale;
  const outHeight = height * scale;
  const target = new Uint8ClampedArray(outWidth * outHeight * 4);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tiles = planTiles(width, height);

  for (let index = 0; index < tiles.length; index += 1) {
    if (activeJob !== jobId) return; // cancelled
    const tile = tiles[index];
    const tileWidth = tile.sx1 - tile.sx0;
    const tileHeight = tile.sy1 - tile.sy0;

    // RGBA -> planar RGB floats in 0..1
    const input = new Float32Array(3 * tileWidth * tileHeight);
    for (let ty = 0; ty < tileHeight; ty += 1) {
      for (let tx = 0; tx < tileWidth; tx += 1) {
        const srcIndex = ((tile.sy0 + ty) * width + (tile.sx0 + tx)) * 4;
        const planeIndex = ty * tileWidth + tx;
        input[planeIndex] = source[srcIndex] / 255;
        input[tileWidth * tileHeight + planeIndex] = source[srcIndex + 1] / 255;
        input[2 * tileWidth * tileHeight + planeIndex] = source[srcIndex + 2] / 255;
      }
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, tileHeight, tileWidth]);
    const outputs = await session.run({ [inputName]: tensor });
    const result = outputs[outputName];
    const data = result.data as Float32Array;
    const outTileWidth = tileWidth * scale;
    const outTileHeight = tileHeight * scale;

    const cropX = (tile.x - tile.sx0) * scale;
    const cropY = (tile.y - tile.sy0) * scale;
    const copyWidth = Math.min(TILE_SIZE, width - tile.x) * scale;
    const copyHeight = Math.min(TILE_SIZE, height - tile.y) * scale;

    for (let row = 0; row < copyHeight; row += 1) {
      const srcRow = (cropY + row) * outTileWidth + cropX;
      const dstRow = ((tile.y * scale + row) * outWidth + tile.x * scale) * 4;
      for (let col = 0; col < copyWidth; col += 1) {
        const srcIndex = srcRow + col;
        const dstIndex = dstRow + col * 4;
        target[dstIndex] = data[srcIndex] * 255;
        target[dstIndex + 1] = data[outTileWidth * outTileHeight + srcIndex] * 255;
        target[dstIndex + 2] = data[2 * outTileWidth * outTileHeight + srcIndex] * 255;
        target[dstIndex + 3] = 255;
      }
    }

    const tileShare = (index + 1) / tiles.length;
    post({
      type: 'progress',
      jobId,
      progress: 0.25 + tileShare * 0.7,
      detail: `Upscaling tile ${index + 1} of ${tiles.length}`,
    });
  }

  if (activeJob !== jobId) return;

  if (transparent) {
    // The network only sees RGB, so the alpha channel is resampled separately.
    const alphaCanvas = new OffscreenCanvas(outWidth, outHeight);
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });
    if (alphaContext) {
      alphaContext.imageSmoothingEnabled = true;
      alphaContext.imageSmoothingQuality = 'high';
      alphaContext.drawImage(bitmap, 0, 0, outWidth, outHeight);
      const alphaData = alphaContext.getImageData(0, 0, outWidth, outHeight).data;
      for (let i = 0; i < target.length; i += 4) {
        target[i + 3] = alphaData[i + 3];
      }
    }
  }

  post({ type: 'progress', jobId, progress: 0.97, detail: 'Encoding result' });

  let finalCanvas = new OffscreenCanvas(outWidth, outHeight);
  finalCanvas.getContext('2d')?.putImageData(new ImageData(target, outWidth, outHeight), 0, 0);

  if (outputScale !== scale) {
    const scaled = new OffscreenCanvas(width * outputScale, height * outputScale);
    const scaledContext = scaled.getContext('2d');
    if (!scaledContext) throw new Error('Canvas 2D is unavailable in this browser.');
    scaledContext.imageSmoothingEnabled = true;
    scaledContext.imageSmoothingQuality = 'high';
    scaledContext.drawImage(finalCanvas, 0, 0, scaled.width, scaled.height);
    finalCanvas = scaled;
  }

  const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
  post({
    type: 'result',
    jobId,
    blob,
    width: finalCanvas.width,
    height: finalCanvas.height,
    elapsedMs: Math.round(performance.now() - startedAt),
    provider,
  });
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    if (activeJob === message.jobId) activeJob = null;
    return;
  }

  activeJob = message.jobId;
  try {
    await upscale(message.jobId, message.bitmap, getModel(message.modelId), message.outputScale);
  } catch (error) {
    if (activeJob !== message.jobId) return;
    const detail = error instanceof Error ? error.message : String(error);
    post({ type: 'error', jobId: message.jobId, message: detail });
  } finally {
    if (activeJob === message.jobId) activeJob = null;
  }
};
