import type { ModelId } from './models';

export type OutputScale = 2 | 4;

export type WorkerRequest =
  | {
      type: 'upscale';
      jobId: string;
      bitmap: ImageBitmap;
      modelId: ModelId;
      outputScale: OutputScale;
    }
  | { type: 'cancel'; jobId: string };

export type WorkerResponse =
  | {
      type: 'progress';
      jobId: string;
      /** 0..1 */
      progress: number;
      detail: string;
    }
  | {
      type: 'result';
      jobId: string;
      blob: Blob;
      width: number;
      height: number;
      elapsedMs: number;
      provider: 'webgpu' | 'wasm';
    }
  | { type: 'error'; jobId: string; message: string };
