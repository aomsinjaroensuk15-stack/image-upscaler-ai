import { MODELS, formatBytes, type ModelId } from '../upscaler/models';

interface ModelPickerProps {
  value: ModelId;
  onChange: (id: ModelId) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  return (
    <fieldset className="picker" disabled={disabled}>
      <legend className="label">Model</legend>
      <div className="picker__grid">
        {MODELS.map((model) => (
          <label
            key={model.id}
            className={`picker__option${value === model.id ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name="model"
              value={model.id}
              checked={value === model.id}
              onChange={() => onChange(model.id)}
            />
            <span className="picker__head">
              <span className="picker__name">{model.name}</span>
              <span className="picker__badge">{model.tagline}</span>
            </span>
            <span className="picker__desc">{model.description}</span>
            <span className="picker__meta">{formatBytes(model.bytes)} download, cached after first run</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
