import { bandPower } from './signal';
import { ModelDefinition, Sample } from './types';

export const BUILTIN_MODELS: ModelDefinition[] = [
  { id: 'focus', name: 'Focus Index', description: 'Beta / (alpha + theta) band-power heuristic', inputChannels: 8, windowSize: 250, kind: 'bandpower' },
  { id: 'relax', name: 'Relaxation Index', description: 'Alpha / beta band-power heuristic', inputChannels: 8, windowSize: 250, kind: 'bandpower' },
];

export function runModel(model: ModelDefinition, samples: Sample[]): number {
  const window = samples.slice(-model.windowSize);
  if (model.kind === 'linear' && model.weights) {
    const features = window.at(-1)?.channels ?? [];
    const raw = model.weights.reduce((sum, weight, i) => sum + weight * (features[i] ?? 0), model.bias ?? 0);
    return 1 / (1 + Math.exp(-raw));
  }
  const theta = bandPower(window, 4, 7) + 0.001;
  const alpha = bandPower(window, 8, 12) + 0.001;
  const beta = bandPower(window, 13, 30) + 0.001;
  const raw = model.id === 'relax' ? alpha / beta : beta / (alpha + theta);
  return Math.max(0, Math.min(1, raw / (1 + raw)));
}

export function validateModel(value: unknown): ModelDefinition {
  const v = value as Partial<ModelDefinition>;
  if (!v || typeof v.name !== 'string' || v.kind !== 'linear' || !Array.isArray(v.weights)) throw new Error('Model must be a linear-model JSON with name and weights.');
  return { id: `imported-${Date.now()}`, description: v.description ?? 'Imported linear model', inputChannels: v.weights.length, windowSize: v.windowSize ?? 1, bias: v.bias ?? 0, name: v.name, kind: 'linear', weights: v.weights.map(Number) };
}
