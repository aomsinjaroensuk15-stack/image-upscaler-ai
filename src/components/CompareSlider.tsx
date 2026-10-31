import { useCallback, useRef, useState } from 'react';

interface CompareSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeSize: { width: number; height: number };
  afterSize: { width: number; height: number };
}

/**
 * Before/after viewer. The low-resolution original sits on top of the upscaled
 * result and is clipped by the divider, so both are shown at the same scale.
 */
export function CompareSlider({ beforeUrl, afterUrl, beforeSize, afterSize }: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, next)));
  }, []);

  return (
    <div className="compare">
      <div
        ref={frameRef}
        className={`compare__frame${dragging ? ' is-dragging' : ''}`}
        style={{ aspectRatio: `${afterSize.width} / ${afterSize.height}` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updateFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) updateFromClientX(event.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <img className="compare__image" src={afterUrl} alt="Upscaled result" draggable={false} />
        <div className="compare__before" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img className="compare__image" src={beforeUrl} alt="Original" draggable={false} />
        </div>

        <div className="compare__divider" style={{ left: `${position}%` }}>
          <button
            type="button"
            className="compare__handle"
            role="slider"
            aria-label="Comparison divider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setPosition((value) => Math.max(0, value - 4));
              if (event.key === 'ArrowRight') setPosition((value) => Math.min(100, value + 4));
            }}
          >
            <span aria-hidden="true">⇔</span>
          </button>
        </div>

        <span className="compare__tag compare__tag--left">
          Original {beforeSize.width}×{beforeSize.height}
        </span>
        <span className="compare__tag compare__tag--right">
          Upscaled {afterSize.width}×{afterSize.height}
        </span>
      </div>
      <p className="compare__hint">Drag the divider to compare. Arrow keys move it when focused.</p>
    </div>
  );
}
