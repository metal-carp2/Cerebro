import { Board, Sample } from './types';
import { SAMPLE_RATE, syntheticSample } from './signal';

export type HeadsetCapabilities = { eegChannels: number; sampleRates: number[]; transports: Array<'usb' | 'synthetic'>; impedance: boolean; markers: boolean };
export type HeadsetDescriptor = Board & { manufacturer: string; brainFlowBoardId?: number; capabilities: HeadsetCapabilities };
export type StreamListener = (samples: Sample[]) => void;
export interface HeadsetAdapter {
  readonly id: string;
  scan(): Promise<HeadsetDescriptor[]>;
  connect(device: HeadsetDescriptor): Promise<void>;
  start(listener: StreamListener): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
}

// One board only for now: the BrainFlow synthetic source, which every screen can
// exercise today. Web Serial devices are added at scan time. Per-vendor adapters
// (Muse, BrainBit, OpenBCI) need the native BrainFlow bridge and are out of scope.
export const HEADSET_CATALOG: Array<Omit<HeadsetDescriptor, 'status'>> = [
  { id: 'synthetic', name: 'BrainFlow Synthetic Board', manufacturer: 'BrainFlow', transport: 'synthetic', brainFlowBoardId: -1, capabilities: { eegChannels: 8, sampleRates: [125], transports: ['synthetic'], impedance: false, markers: true } },
];

export function nativeBrainFlowAvailable(): boolean {
  return typeof globalThis === 'object' && '__NEUROFLOW_BRAINFLOW__' in globalThis;
}

export class SyntheticAdapter implements HeadsetAdapter {
  readonly id = 'synthetic'; private timer?: ReturnType<typeof setInterval>; private index = 0; private started = Date.now();
  async scan() { return [HEADSET_CATALOG[0] as Omit<HeadsetDescriptor, 'status'>].map((b) => ({ ...b, status: 'available' as const })); }
  async connect() { this.index = 0; this.started = Date.now(); }
  async start(listener: StreamListener) { this.timer = setInterval(() => listener(Array.from({ length: 5 }, () => syntheticSample(this.index++, this.started))), 1000 * 5 / SAMPLE_RATE); }
  async stop() { if (this.timer) clearInterval(this.timer); }
  async disconnect() { await this.stop(); }
}

export function catalogBoards(): HeadsetDescriptor[] { return HEADSET_CATALOG.map((board) => ({ ...board, status: 'available' })); }
