// Uploaded models are data, never code. A model file declares which named
// features it consumes and the linear weights over them, so importing one can
// never execute anything. ONNX/TFLite belong behind a native bridge that
// validates tensor shapes before inference.

export type ModelInput = 'features' | 'channels';

export type AnalysisModel = {
  id: string;
  name: string;
  description: string;
  input: ModelInput;
  /** Feature keys consumed, in weight order. Empty for channel models. */
  features: string[];
  weights: number[];
  bias: number;
  /** Optional per-feature z-scoring applied before the dot product. */
  standardize?: { mean: number[]; scale: number[] };
  output: 'probability' | 'score';
  labels: [string, string];
  threshold: number;
};

export type Prediction = { score: number; label: string };

const MAX_WEIGHTS = 4096;

function numbers(value: unknown, length: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`Model "${field}" must have ${length} numbers.`);
  return value.map((x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Model "${field}" must contain finite numbers.`);
    return x;
  });
}

export function validateModel(value: unknown): AnalysisModel {
  const m = value as Record<string, unknown>;
  if (!m || typeof m !== 'object') throw new Error('Model file must be a JSON object.');
  if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('Model needs a name.');
  if (m.kind !== undefined && m.kind !== 'linear') throw new Error('Only linear models are supported. Train a logistic model over the exported features.');
  if (!Array.isArray(m.weights) || !m.weights.length || m.weights.length > MAX_WEIGHTS) throw new Error(`Model needs between 1 and ${MAX_WEIGHTS} weights.`);

  const weights = numbers(m.weights, m.weights.length, 'weights');
  const input: ModelInput = Array.isArray(m.features) ? 'features' : 'channels';
  let features: string[] = [];
  if (input === 'features') {
    features = (m.features as unknown[]).map((f) => {
      if (typeof f !== 'string' || !f.trim()) throw new Error('Model "features" must be non-empty strings.');
      return f.trim();
    });
    if (features.length !== weights.length) throw new Error(`Model has ${features.length} features but ${weights.length} weights.`);
    if (new Set(features).size !== features.length) throw new Error('Model "features" must be unique.');
  }

  let standardize: AnalysisModel['standardize'];
  if (m.standardize !== undefined) {
    const s = m.standardize as { mean?: unknown; scale?: unknown };
    const mean = numbers(s?.mean, weights.length, 'standardize.mean');
    const scale = numbers(s?.scale, weights.length, 'standardize.scale');
    if (scale.some((x) => x === 0)) throw new Error('Model "standardize.scale" must not contain zero.');
    standardize = { mean, scale };
  }

  const labels = Array.isArray(m.labels) && m.labels.length === 2 && m.labels.every((l) => typeof l === 'string' && l.trim())
    ? ([m.labels[0], m.labels[1]] as [string, string])
    : (['negative', 'positive'] as [string, string]);
  const output = m.output === 'score' ? 'score' : 'probability';
  const threshold = typeof m.threshold === 'number' && Number.isFinite(m.threshold) ? m.threshold : output === 'probability' ? 0.5 : 0;
  const bias = typeof m.bias === 'number' && Number.isFinite(m.bias) ? m.bias : 0;

  return {
    id: `model-${Date.now()}`,
    name: m.name.trim(),
    description: typeof m.description === 'string' ? m.description : `Linear ${input} model with ${weights.length} weights`,
    input, features, weights, bias, standardize, output, labels, threshold,
  };
}

/** Feature keys the model needs that the pipeline does not produce. */
export function missingFeatures(model: AnalysisModel, available: string[]): string[] {
  if (model.input !== 'features') return [];
  const set = new Set(available);
  return model.features.filter((f) => !set.has(f));
}

function combine(model: AnalysisModel, values: number[]): Prediction {
  let sum = model.bias;
  for (let i = 0; i < model.weights.length; i++) {
    const raw = values[i] ?? 0;
    const x = model.standardize ? (raw - model.standardize.mean[i]!) / model.standardize.scale[i]! : raw;
    sum += model.weights[i]! * x;
  }
  const score = model.output === 'probability' ? 1 / (1 + Math.exp(-sum)) : sum;
  return { score, label: model.labels[score >= model.threshold ? 1 : 0] };
}

/** Score one window of extracted features. Throws if the model needs a feature the run did not produce. */
export function applyModel(model: AnalysisModel, features: Record<string, number>): Prediction {
  const missing = missingFeatures(model, Object.keys(features));
  if (missing.length) throw new Error(`Recording does not produce ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`);
  return combine(model, model.features.map((f) => features[f]!));
}

/** Score one window of raw channel values (legacy channel-weight models). */
export function applyChannelModel(model: AnalysisModel, channels: number[]): Prediction {
  return combine(model, channels);
}
