export type Recording = { version: 1; sampleRate: number; channels: string[]; kind: 'raw' | 'preprocessed'; units: 'uV' | 'V'; samples: number[][] };
export type Settings = { highpass: number; lowpass: number; hopSeconds: number; pairs: string };
export type Timing = { window: number; endSample: number; queueMs: number; preprocessingMs: number; featureMs: number; totalMs: number; missedDeadline: boolean; inferenceMs: number | null; prediction: number | null; label: string | null; features: Record<string, number> };
export const BANDS: [string, number, number][] = [['theta', 4, 8], ['alpha', 8, 13], ['beta', 13, 30]];
/** Feature keys a run will produce, without processing a window. Used to check an uploaded model up front. */
export function featureKeys(r: Recording, pairs: string): string[] {
  const keys = r.channels.flatMap(channel => [...BANDS.map(([band]) => `${channel}.${band}_power`), `${channel}.spectral_entropy`]);
  return [...keys, ...pairs.split(',').map(x => x.trim()).filter(Boolean).map(pair => `${pair}.alpha_log_asymmetry`)];
}
export function validateRecording(value: unknown): Recording {
  const r = value as Recording;
  if (!r || r.version !== 1 || !Number.isFinite(r.sampleRate) || r.sampleRate < 2 || r.sampleRate > 4096 ||
    !Array.isArray(r.channels) || !r.channels.length || r.channels.length > 64 ||
    r.channels.some(c => typeof c !== 'string' || !c.trim()) || new Set(r.channels).size !== r.channels.length ||
    !['raw', 'preprocessed'].includes(r.kind) || !['uV', 'V'].includes(r.units) ||
    !Array.isArray(r.samples) || r.samples.length < Math.round(2 * r.sampleRate) ||
    r.samples.some(row => !Array.isArray(row) || row.length !== r.channels.length || row.some(x => typeof x !== 'number' || !Number.isFinite(x)))) {
    throw new Error('Invalid recording: require finite samples, unique channels, units, kind, sampleRate and at least two seconds.');
  }
  return r;
}
export function parseRecording(text: string, name: string, sampleRate: number, kind: Recording['kind'], units: Recording['units']): Recording {
  if (name.toLowerCase().endsWith('.json')) return validateRecording(JSON.parse(text));
  if (!name.toLowerCase().endsWith('.csv')) throw new Error('Import CSV or converted JSON. Use EEGproc/convert.py for MATLAB.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const channels = lines.shift()!.split(',').map(x => x.trim());
  if (channels.some(c => /timestamp|label|^index$|^time$/i.test(c))) throw new Error('CSV must contain EEG channel columns only. Use the Python converter to select channels.');
  const samples = lines.map((line, i) => line.split(',').map(x => {
    if (!x.trim()) throw new Error(`Empty CSV value at row ${i + 2}`);
    return Number(x.trim());
  }));
  return validateRecording({ version: 1, sampleRate, channels, kind, units, samples });
}
export function validateSettings(r: Recording, s: Settings) {
  if (![s.highpass, s.lowpass, s.hopSeconds].every(Number.isFinite) || s.highpass < 0 || s.lowpass <= s.highpass || s.lowpass >= r.sampleRate / 2 || s.hopSeconds <= 0 || s.hopSeconds > 2 || Math.round(s.hopSeconds * r.sampleRate) < 1) throw new Error('Require 0 ≤ high-pass < low-pass < Nyquist and a hop between one sample and two seconds.');
  for (const pair of s.pairs.split(',').map(x => x.trim()).filter(Boolean)) {
    const parts = pair.split(':');
    if (parts.length !== 2 || parts[0] === parts[1] || parts.some(c => !r.channels.includes(c))) throw new Error('Asymmetry pairs must use channel names, e.g. F3:F4,C3:C4.');
  }
}
// Reference implementation only. Not validated against Vitor's EEGPROC pipeline.
export function preprocessWindow(rows: number[][], r: Recording, s: Settings): number[][] {
  const scale = r.units === 'V' ? 1e6 : 1;
  const out = rows.map(row => row.map(x => x * scale));
  if (r.kind === 'preprocessed') return out;
  const dt = 1 / r.sampleRate;
  const hp = s.highpass ? (1 / (2 * Math.PI * s.highpass)) / (1 / (2 * Math.PI * s.highpass) + dt) : 0;
  const lp = dt / (1 / (2 * Math.PI * s.lowpass) + dt);
  for (let c = 0; c < r.channels.length; c++) {
    let prev = out[0]![c]!, high = 0, low = s.highpass ? 0 : prev;
    for (const row of out) {
      const input = row[c]!;
      high = s.highpass ? hp * (high + input - prev) : input;
      low += lp * (high - low); prev = input; row[c] = low;
    }
  }
  return out;
}
export function extractFeatures(rows: number[][], r: Recording, pairs: string): Record<string, number> {
  const features: Record<string, number> = {};
  const n = rows.length;
  const weights = Array.from({ length: n }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const norm = r.sampleRate * weights.reduce((a, b) => a + b * b, 0);
  const bands = BANDS;
  r.channels.forEach((channel, c) => {
    const mean = rows.reduce((sum, row) => sum + row[c]!, 0) / n;
    const spectrum: number[] = [];
    for (let k = 0; k <= Math.floor(n / 2); k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const x = (rows[i]![c]! - mean) * weights[i]!, angle = 2 * Math.PI * k * i / n;
        re += x * Math.cos(angle); im -= x * Math.sin(angle);
      }
      spectrum.push((re * re + im * im) / norm * (k === 0 || (n % 2 === 0 && k === n / 2) ? 1 : 2));
    }
    for (const [band, lo, hi] of bands) features[`${channel}.${band}_power`] = spectrum.reduce((sum, p, k) => sum + (k * r.sampleRate / n >= lo && k * r.sampleRate / n < hi ? p * r.sampleRate / n : 0), 0);
    const total = spectrum.reduce((a, b) => a + b, 0);
    features[`${channel}.spectral_entropy`] = total > 0 ? -spectrum.reduce((sum, p) => { const q = p / total; return sum + (q > 0 ? q * Math.log2(q) : 0); }, 0) / Math.log2(spectrum.length) : 0;
  });
  for (const pair of pairs.split(',').map(x => x.trim()).filter(Boolean)) {
    const [left, right] = pair.split(':');
    features[`${pair}.alpha_log_asymmetry`] = Math.log(Math.max(features[`${left}.alpha_power`]!, 1e-12)) - Math.log(Math.max(features[`${right}.alpha_power`]!, 1e-12));
  }
  return features;
}
function quantile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]! : null;
}
export function summarize(rows: Timing[]) {
  const scores = rows.filter(r => r.prediction !== null).map(r => r.prediction!);
  const labels: Record<string, number> = {};
  for (const row of rows) if (row.label) labels[row.label] = (labels[row.label] ?? 0) + 1;
  return {
    windows: rows.length,
    medianMs: quantile(rows.map(r => r.totalMs), .5),
    p95Ms: quantile(rows.map(r => r.totalMs), .95),
    missedDeadlines: rows.filter(r => r.missedDeadline).length,
    maxQueueMs: rows.length ? Math.max(...rows.map(r => r.queueMs)) : null,
    scoredWindows: scores.length,
    medianInferenceMs: quantile(rows.filter(r => r.inferenceMs !== null).map(r => r.inferenceMs!), .5),
    meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
    labelCounts: labels,
  };
}
