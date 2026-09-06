export type Sample = { t: number; channels: number[] };
export type EventMarker = { t: number; code: string; value?: string | number };
export type Board = { id: string; name: string; transport: 'synthetic' | 'serial' | 'bluetooth' | 'adb'; status: 'available' | 'connected' };
export type PreprocessConfig = { notchHz: 0 | 50 | 60; highpassHz: number; lowpassHz: number; demean: boolean };
export type PipelineConfig = {
  channels: number[];
  spatialFilter: 'none' | 'car' | 'laplacian';
  temporalFilter: 'bandpass' | 'none';
  classifier: 'model' | 'threshold';
  normalize: boolean;
  artifactThresholdUv: number;
};
export type ParadigmId = 'cursor' | 'p300' | 'stimulus' | 'free';
export type OperatorState = 'idle' | 'configured' | 'running' | 'suspended' | 'complete' | 'error';
export type ModelDefinition = { id: string; name: string; description: string; inputChannels: number; windowSize: number; kind: 'bandpower' | 'linear'; weights?: number[]; bias?: number };
export type Session = { id: string; startedAt: string; durationMs: number; boardName: string; sampleRate: number; samples: Sample[]; markers?: EventMarker[]; parameters?: Record<string, unknown> };
