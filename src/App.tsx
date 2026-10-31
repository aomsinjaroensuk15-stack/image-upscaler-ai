import { useCallback, useEffect, useRef, useState } from 'react';
import { CompareSlider } from './components/CompareSlider';
import { ModelPicker } from './components/ModelPicker';
import { MAX_SOURCE_PIXELS, useUpscaler } from './upscaler/useUpscaler';
import type { ModelId } from './upscaler/models';
import type { OutputScale } from './upscaler/protocol';

interface SourceImage {
  file: File;
  url: string;
  width: number;
  height: number;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export default function App() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [model, setModel] = useState<ModelId>('general');
  const [scale, setScale] = useState<OutputScale>(4);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const { state, upscale, cancel } = useUpscaler();

  const acceptFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLoadError('That file is not an image. Try a PNG, JPEG, WebP or AVIF file.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();

      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      const url = URL.createObjectURL(file);
      sourceUrlRef.current = url;
      setSource({ file, url, width, height });
      setLoadError(null);
    } catch {
      setLoadError('This image could not be decoded by your browser.');
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file) void acceptFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile]);

  useEffect(
    () => () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    },
    [],
  );

  const run = useCallback(async () => {
    if (!source) return;
    try {
      const bitmap = await createImageBitmap(source.file);
      upscale(bitmap, model, scale);
    } catch {
      setLoadError('This image could not be decoded by your browser.');
    }
  }, [model, scale, source, upscale]);

  const busy = state.status === 'running';
  const result = state.result;
  const tooLarge = source ? source.width * source.height > MAX_SOURCE_PIXELS : false;

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__mark" aria-hidden="true">
          <span>4×</span>
        </div>
        <div>
          <h1>Upscaler</h1>
          <p className="hero__sub">
            AI super-resolution that runs entirely in your browser. Your images never leave your
            device.
          </p>
        </div>
        <a
          className="hero__badge"
          href="https://github.com/xinntao/Real-ESRGAN"
          target="_blank"
          rel="noreferrer"
        >
          Real-ESRGAN · BSD-3
        </a>
      </header>

      <main className="layout">
        <section className="stage">
          {!source && (
            <div
              className={`dropzone${dropActive ? ' is-active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropActive(false);
                void acceptFile(event.dataTransfer.files[0]);
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
              }}
            >
              <div className="dropzone__icon" aria-hidden="true">
                ⬆
              </div>
              <p className="dropzone__title">Drop an image, paste it, or click to browse</p>
              <p className="dropzone__hint">
                PNG, JPEG, WebP or AVIF · up to {Math.round(MAX_SOURCE_PIXELS / 1_000_000)} megapixels
              </p>
            </div>
          )}

          {source && !result && (
            <div className="stage__single">
              <img src={source.url} alt="Selected image" />
              <div className="stage__meta">
                <span className="chip">
                  {source.width}×{source.height}
                </span>
                <span className="chip chip--ghost">{source.file.type.replace('image/', '').toUpperCase()}</span>
                <span className="chip chip--ghost">{Math.round(source.file.size / 1024)} KB</span>
                <span className="stage__name">{source.file.name}</span>
              </div>
            </div>
          )}

          {source && result && (
            <CompareSlider
              beforeUrl={source.url}
              afterUrl={result.url}
              beforeSize={{ width: source.width, height: source.height }}
              afterSize={{ width: result.width, height: result.height }}
            />
          )}

          {busy && (
            <div className="overlay" role="status" aria-live="polite">
              <div className="overlay__card">
                <p className="overlay__detail">{state.detail}</p>
                <div className="bar">
                  <div className="bar__fill" style={{ width: `${Math.round(state.progress * 100)}%` }} />
                </div>
                <button type="button" className="btn btn--ghost" onClick={cancel}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="panel">
          <ModelPicker value={model} onChange={setModel} disabled={busy} />

          <fieldset className="picker" disabled={busy}>
            <legend className="label">Output size</legend>
            <div className="segmented">
              {([2, 4] as OutputScale[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segmented__item${scale === option ? ' is-selected' : ''}`}
                  onClick={() => setScale(option)}
                >
                  {option}×
                  {source && (
                    <span className="segmented__size">
                      {source.width * option}×{source.height * option}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="button" className="btn" onClick={run} disabled={!source || busy || tooLarge}>
            {result ? 'Upscale again' : 'Upscale image'}
          </button>

          {result && (
            <a className="btn btn--secondary" href={result.url} download={`${stripExtension(source?.file.name ?? 'image')}-${scale}x.png`}>
              Download PNG
            </a>
          )}

          <div className="actions">
            <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose another
            </button>
          </div>

          {(state.error || loadError) && <p className="error">{state.error ?? loadError}</p>}

          {result && (
            <p className="panel__note">
              {result.width}×{result.height} · {(result.elapsedMs / 1000).toFixed(1)}s ·{' '}
              {result.provider === 'webgpu' ? 'WebGPU' : 'WASM (CPU)'}
            </p>
          )}

          {tooLarge && (
            <p className="error">This image is larger than the 4 megapixel limit for browser memory.</p>
          )}

          <p className="panel__footnote">
            Weights are downloaded on first use and cached in your browser. Upscaling is tile-based,
            so very large images take a while on CPU.
          </p>
        </aside>
      </main>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void acceptFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <footer className="foot">
        <span>No uploads. No accounts. Everything runs locally.</span>
        <span>
          Model: <a href="https://huggingface.co/relax123666/clearpic-models">Real-ESRGAN ONNX</a>
        </span>
      </footer>
    </div>
  );
}
