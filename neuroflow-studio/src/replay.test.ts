import { extractFeatures, parseRecording, preprocessWindow, summarize, validateRecording, validateSettings } from './replay';
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
function rejects(fn: () => unknown) { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, 'Expected validation error'); }
const samples = Array.from({ length: 256 }, (_, i) => [Math.sin(2 * Math.PI * 10 * i / 128), 2 * Math.sin(2 * Math.PI * 10 * i / 128)]);
const recording = validateRecording({ version: 1, sampleRate: 128, channels: ['F3', 'F4'], kind: 'preprocessed', units: 'uV', samples });
const settings = { highpass: 1, lowpass: 40, hopSeconds: .5, pairs: 'F3:F4' };
validateSettings(recording, settings);
const features = extractFeatures(samples, recording, settings.pairs);
assert(Math.abs(features['F3.alpha_power']! - .5) < .01, 'Sine power must equal amplitude squared / 2');
assert(Math.abs(features['F3:F4.alpha_log_asymmetry']! + Math.log(4)) < .01, 'Asymmetry sign or scaling');
assert(features['F3.spectral_entropy']! >= 0 && features['F3.spectral_entropy']! <= 1, 'Normalized entropy');
assert(preprocessWindow(samples, recording, settings)[10]![0] === samples[10]![0], 'Preprocessed bypass');
assert(Math.abs(preprocessWindow([[1e-6, 2e-6]], { ...recording, units: 'V' }, settings)[0]![0]! - 1) < 1e-10, 'Volt conversion');
rejects(() => validateSettings(recording, { ...settings, pairs: 'missing:F4' }));
rejects(() => validateSettings(recording, { ...settings, hopSeconds: 0 }));
rejects(() => validateRecording({ ...recording, samples: [[NaN, 1]] }));
rejects(() => parseRecording('timestamp,F3\n0,1', 'data.csv', 128, 'raw', 'uV'));
assert(summarize([]).medianMs === null, 'Empty metrics must not imply measured zero');
const csv = 'F3,F4\n' + samples.map(row => row.join(',')).join('\n');
assert(parseRecording(csv, 'data.csv', 128, 'raw', 'uV').samples.length === 256, 'CSV roundtrip');
console.log('Replay tests passed');
