/**
 * Model registry for the in-browser upscaler.
 *
 * Weights are official Real-ESRGAN ONNX exports (BSD-3-Clause), served from
 * Hugging Face with open CORS so the browser can fetch them directly.
 * https://huggingface.co/relax123666/clearpic-models
 */

export type ModelId = 'general' | 'anime' | 'photo';

export interface UpscaleModel {
  id: ModelId;
  name: string;
  tagline: string;
  description: string;
  file: string;
  bytes: number;
  /** Native upscaling factor of the network. */
  scale: 4;
}

const MODEL_BASE_URL = 'https://huggingface.co/relax123666/clearpic-models/resolve/main/';

export const MODELS: UpscaleModel[] = [
  {
    id: 'general',
    name: 'General x4',
    tagline: 'Best all-rounder',
    description: '4.9 MB · fast, balanced. Good default for photos, screenshots and mixed content.',
    file: 'realesr-general-x4v3.onnx',
    bytes: 4_866_396,
    scale: 4,
  },
  {
    id: 'anime',
    name: 'Anime 6B',
    tagline: 'Art & screenshots',
    description: '17.9 MB · crisp edges and flat colours. Made for anime, manga and illustrations.',
    file: 'RealESRGAN_x4plus_anime_6B.onnx',
    bytes: 17_939_943,
    scale: 4,
  },
  {
    id: 'photo',
    name: 'Photo x4plus',
    tagline: 'Highest detail',
    description: '67 MB · heaviest and most detailed. Best for real photos with fine texture.',
    file: 'RealESRGAN_x4plus.onnx',
    bytes: 67_051_618,
    scale: 4,
  },
];

export function getModel(id: ModelId): UpscaleModel {
  const model = MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
}

export function modelUrl(model: UpscaleModel): string {
  return `${MODEL_BASE_URL}${model.file}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
