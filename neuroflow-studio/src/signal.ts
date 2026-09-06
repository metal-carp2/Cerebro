import { PreprocessConfig, Sample } from './types';

export const SAMPLE_RATE = 125;
const CHANNELS = 8;

export function syntheticSample(index: number, startedAt: number): Sample {
  const t = index / SAMPLE_RATE;
  const channels = Array.from({ length: CHANNELS }, (_, c) => {
    const alpha = Math.sin(2 * Math.PI * (9.5 + c * 0.12) * t) * (20 - c);
    const beta = Math.sin(2 * Math.PI * (18 + c * 0.25) * t + c) * 5;
    const drift = Math.sin(2 * Math.PI * 0.35 * t) * 8;
    const noise = (Math.random() - 0.5) * 5;
    return alpha + beta + drift + noise;
  });
  return { t: startedAt + t * 1000, channels };
}

export function preprocess(samples: Sample[], config: PreprocessConfig): Sample[] {
  if (samples.length < 2) return samples;
  const means = samples[0]!.channels.map((_, c) => samples.reduce((sum, s) => sum + (s.channels[c] ?? 0), 0) / samples.length);
  const dt = 1 / SAMPLE_RATE;
  const hpRC = config.highpassHz > 0 ? 1 / (2 * Math.PI * config.highpassHz) : 0;
  const hpA = hpRC ? hpRC / (hpRC + dt) : 0;
  const lpRC = config.lowpassHz > 0 ? 1 / (2 * Math.PI * config.lowpassHz) : 0;
  const lpA = lpRC ? dt / (lpRC + dt) : 1;
  const prevIn = means.slice();
  const hp = means.map(() => 0);
  const lp = means.map(() => 0);
  return samples.map((s) => ({
    ...s,
    channels: s.channels.map((raw, c) => {
      let x = raw - (config.demean ? means[c]! : 0);
      if (config.highpassHz > 0) {
        hp[c] = hpA * (hp[c]! + x - prevIn[c]!);
        prevIn[c] = x;
        x = hp[c]!;
      }
      lp[c] = lp[c]! + lpA * (x - lp[c]!);
      return lp[c]!;
    }),
  }));
}

export function bandPower(samples: Sample[], low: number, high: number): number {
  if (samples.length < 8) return 0;
  const data = samples.map((s) => s.channels.reduce((a, b) => a + b, 0) / s.channels.length);
  let power = 0;
  for (let f = Math.ceil(low); f <= high; f++) {
    let re = 0, im = 0;
    data.forEach((x, n) => { const phase = 2 * Math.PI * f * n / SAMPLE_RATE; re += x * Math.cos(phase); im -= x * Math.sin(phase); });
    power += (re * re + im * im) / (data.length * data.length);
  }
  return power;
}
