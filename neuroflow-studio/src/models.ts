import { bandPower } from './signal';
import { AnalysisModel, applyChannelModel } from './model';
import { Sample } from './types';

export type BuiltinModel = { id: string; name: string; description: string; kind: 'bandpower'; windowSize: number };
export type LiveModel = BuiltinModel | (AnalysisModel & { kind: 'linear'; windowSize: number });

export const BUILTIN_MODELS: LiveModel[] = [
  { id: 'focus', name: 'Focus Index', description: 'Beta / (alpha + theta) band-power heuristic', kind: 'bandpower', windowSize: 250 },
  { id: 'relax', name: 'Relaxation Index', description: 'Alpha / beta band-power heuristic', kind: 'bandpower', windowSize: 250 },
];

export function asLiveModel(model: AnalysisModel): LiveModel {
  return { ...model, kind: 'linear', windowSize: 1 };
}

/** Live scoring over the streaming window. Feature-input models are scored in Analysis, not here. */
export function runModel(model: LiveModel, samples: Sample[]): number {
  const window = samples.slice(-model.windowSize);
  if (model.kind === 'linear') {
    if (model.input === 'features') return 0;
    const score = applyChannelModel(model, window.at(-1)?.channels ?? []).score;
    return model.output === 'probability' ? score : 1 / (1 + Math.exp(-score));
  }
  const theta = bandPower(window, 4, 7) + 0.001;
  const alpha = bandPower(window, 8, 12) + 0.001;
  const beta = bandPower(window, 13, 30) + 0.001;
  const raw = model.id === 'relax' ? alpha / beta : beta / (alpha + theta);
  return Math.max(0, Math.min(1, raw / (1 + raw)));
}
