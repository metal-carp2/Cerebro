import { ModelDefinition, Sample } from './types';

export type ComputeMode = 'phone' | 'automatic' | 'computer';
export type CompanionStatus = { name: string; version: string; backends: string[]; models: string[] };
export type RemotePrediction = { score: number; label: string; latencyMs: number; backend: string };

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/(health|infer)\/?$/i, '').replace(/\/$/, '');
}
export async function checkCompanion(endpoint: string): Promise<CompanionStatus> {
  const response = await fetch(`${normalizeEndpoint(endpoint)}/health`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Companion returned ${response.status}`);
  return response.json();
}
export async function inferRemote(endpoint: string, model: ModelDefinition, samples: Sample[], sampleRate: number): Promise<RemotePrediction> {
  const started = Date.now();
  const response = await fetch(`${normalizeEndpoint(endpoint)}/infer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model.id, sampleRate, channels: samples.at(-1)?.channels.length ?? 0, samples: samples.slice(-model.windowSize).map((sample) => sample.channels) }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Inference returned ${response.status}`);
  const result = await response.json();
  return { ...result, latencyMs: Date.now() - started };
}
