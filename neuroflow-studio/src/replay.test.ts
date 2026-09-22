import { extractFeatures, featureKeys, parseRecording, preprocessWindow, summarize, Timing, validateRecording, validateSettings } from './replay';
import { applyChannelModel, applyModel, missingFeatures, validateModel } from './model';
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

// Feature keys must be predictable before a run so an incompatible model is caught up front.
const keys = featureKeys(recording, settings.pairs);
assert(keys.length === 2 * 4 + 1, 'Two channels give four features each plus one pair');
assert(Object.keys(features).every(k => keys.includes(k)) && keys.every(k => k in features), 'Declared keys must match extracted keys');

const model = validateModel({ name: 'Alpha lateralisation', kind: 'linear', features: ['F3.alpha_power', 'F4.alpha_power'], weights: [1, -1], bias: .25, labels: ['left', 'right'] });
assert(model.input === 'features' && model.output === 'probability' && model.threshold === .5, 'Defaults: probability output at 0.5');
const expected = 1 / (1 + Math.exp(-(.25 + features['F3.alpha_power']! - features['F4.alpha_power']!)));
assert(Math.abs(applyModel(model, features).score - expected) < 1e-12, 'Logistic dot product over named features');
assert(applyModel(model, features).label === 'left', 'F4 carries the larger alpha power, so the sum falls below threshold');
assert(!missingFeatures(model, keys).length, 'Model fits this recording');
assert(missingFeatures(model, ['F3.alpha_power'])[0] === 'F4.alpha_power', 'Missing features are reported by name');
rejects(() => applyModel(model, { 'F3.alpha_power': 1 }));

const standardized = validateModel({ name: 'Z', features: ['F3.alpha_power'], weights: [2], standardize: { mean: [.5], scale: [.25] }, output: 'score', threshold: 0 });
assert(Math.abs(applyModel(standardized, { 'F3.alpha_power': 1 }).score - 4) < 1e-12, 'Z-scoring applies before the weight');
assert(applyChannelModel(validateModel({ name: 'C', weights: [1, 1], output: 'score' }), [2, 3]).score === 5, 'Channel models read the raw sample');

rejects(() => validateModel({ name: 'bad', features: ['a', 'b'], weights: [1] }));
rejects(() => validateModel({ name: 'bad', features: ['a', 'a'], weights: [1, 1] }));
rejects(() => validateModel({ name: 'bad', weights: [1], standardize: { mean: [0], scale: [0] } }));
rejects(() => validateModel({ name: 'bad', kind: 'onnx', weights: [1] }));
rejects(() => validateModel({ weights: [1] }));
rejects(() => validateModel({ name: 'bad', weights: [Number.NaN] }));

const scored: Timing[] = [.2, .8, .9].map((prediction, window) => ({ window, endSample: 0, queueMs: 0, preprocessingMs: 0, featureMs: 0, totalMs: window, missedDeadline: false, inferenceMs: 1, prediction, label: prediction >= .5 ? 'right' : 'left', features: {} }));
const stats = summarize(scored);
assert(stats.scoredWindows === 3 && stats.minScore === .2 && stats.maxScore === .9, 'Score range');
assert(Math.abs(stats.meanScore! - 1.9 / 3) < 1e-12 && stats.medianInferenceMs === 1, 'Mean output and inference latency');
assert(stats.labelCounts['right'] === 2 && stats.labelCounts['left'] === 1, 'Label counts');
assert(summarize([]).meanScore === null && summarize([]).scoredWindows === 0, 'No windows must not imply a measured zero');

console.log('Replay and model tests passed');
