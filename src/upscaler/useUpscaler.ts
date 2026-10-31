import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelId } from './models';
import type { OutputScale, WorkerRequest, WorkerResponse } from './protocol';

/** Source images above this many pixels are rejected to protect browser memory. */
export const MAX_SOURCE_PIXELS = 4_000_000;

export interface UpscaleResult {
  url: string;
  blob: Blob;
  width: number;
  height: number;
  elapsedMs: number;
  provider: 'webgpu' | 'wasm';
}

export interface UpscaleState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** 0..1 across model download and inference. */
  progress: number;
  detail: string;
  error: string | null;
  result: UpscaleResult | null;
}

const INITIAL_STATE: UpscaleState = {
  status: 'idle',
  progress: 0,
  detail: '',
  error: null,
  result: null,
};

/**
 * Owns the inference worker and its lifecycle. One job runs at a time; starting
 * a new job cancels the previous one.
 */
export function useUpscaler() {
  const [state, setState] = useState<UpscaleState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('./upscaler.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.jobId !== jobRef.current) return;

      if (message.type === 'progress') {
        setState((current) => ({
          ...current,
          status: 'running',
          progress: Math.min(0.99, Math.max(current.progress, message.progress)),
          detail: message.detail,
        }));
        return;
      }

      if (message.type === 'error') {
        jobRef.current = null;
        setState({
          ...INITIAL_STATE,
          status: 'error',
          error: message.message,
        });
        return;
      }

      jobRef.current = null;
      const url = URL.createObjectURL(message.blob);
      releaseUrl();
      urlRef.current = url;
      setState({
        status: 'done',
        progress: 1,
        detail: `Done in ${(message.elapsedMs / 1000).toFixed(1)}s`,
        error: null,
        result: {
          url,
          blob: message.blob,
          width: message.width,
          height: message.height,
          elapsedMs: message.elapsedMs,
          provider: message.provider,
        },
      });
    };

    worker.onerror = (event) => {
      jobRef.current = null;
      setState({ ...INITIAL_STATE, status: 'error', error: event.message || 'The inference worker crashed.' });
    };

    workerRef.current = worker;
    return worker;
  }, [releaseUrl]);

  const upscale = useCallback(
    (bitmap: ImageBitmap, modelId: ModelId, outputScale: OutputScale) => {
      if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
        bitmap.close();
        setState({
          ...INITIAL_STATE,
          status: 'error',
          error: `That image is ${bitmap.width}×${bitmap.height}. Please use one under 4 megapixels (about 2000×2000).`,
        });
        return;
      }

      releaseUrl();
      const worker = ensureWorker();
      const jobId = crypto.randomUUID();
      jobRef.current = jobId;
      setState({
        status: 'running',
        progress: 0,
        detail: 'Warming up',
        error: null,
        result: null,
      });

      const message: WorkerRequest = {
        type: 'upscale',
        jobId,
        bitmap,
        modelId,
        outputScale,
      };
      worker.postMessage(message, [bitmap]);
    },
    [ensureWorker, releaseUrl],
  );

  const cancel = useCallback(() => {
    if (workerRef.current && jobRef.current) {
      const message: WorkerRequest = { type: 'cancel', jobId: jobRef.current };
      workerRef.current.postMessage(message);
    }
    jobRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      URL.revokeObjectURL(urlRef.current ?? '');
    },
    [],
  );

  return { state, upscale, cancel };
}
