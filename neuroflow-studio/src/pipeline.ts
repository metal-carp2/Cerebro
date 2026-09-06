import { PipelineConfig, Sample } from './types';

export type PipelineResult = { samples: Sample[]; artifactRate: number; control: number };

export function processPipeline(input: Sample[], config: PipelineConfig): PipelineResult {
  let artifacts = 0;
  const samples = input.map((sample) => {
    const selected = config.channels.map((channel) => sample.channels[channel] ?? 0);
    const rejected = selected.some((value) => Math.abs(value) > config.artifactThresholdUv);
    if (rejected) artifacts++;
    if (config.spatialFilter === 'car') {
      const mean = selected.reduce((sum, value) => sum + value, 0) / Math.max(1, selected.length);
      return { ...sample, channels: selected.map((value) => rejected ? 0 : value - mean) };
    }
    if (config.spatialFilter === 'laplacian') {
      return { ...sample, channels: selected.map((value, index) => rejected ? 0 : value - (((selected[index - 1] ?? value) + (selected[index + 1] ?? value)) / 2)) };
    }
    return { ...sample, channels: selected.map((value) => rejected ? 0 : value) };
  });
  const latest = samples.at(-1)?.channels ?? [];
  const raw = latest.reduce((sum, value) => sum + value, 0) / Math.max(1, latest.length);
  return { samples, artifactRate: input.length ? artifacts / input.length : 0, control: config.normalize ? Math.tanh(raw / 25) : raw };
}

export const DEFAULT_PIPELINE: PipelineConfig = {
  channels: [0, 1, 2, 3, 4, 5, 6, 7], spatialFilter: 'car', temporalFilter: 'bandpass', classifier: 'model', normalize: true, artifactThresholdUv: 100,
};
