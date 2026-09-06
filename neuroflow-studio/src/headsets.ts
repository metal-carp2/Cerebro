import { Board, Sample } from './types';
import { SAMPLE_RATE, syntheticSample } from './signal';

export type HeadsetCapabilities = { eegChannels: number; sampleRates: number[]; transports: Array<'ble' | 'bluetooth' | 'usb' | 'wifi' | 'synthetic'>; impedance: boolean; markers: boolean };
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

export const HEADSET_CATALOG: Array<Omit<HeadsetDescriptor, 'status'>> = [
  { id: 'synthetic', name: 'BrainFlow Synthetic Board', manufacturer: 'BrainFlow', transport: 'synthetic', brainFlowBoardId: -1, capabilities: { eegChannels: 8, sampleRates: [125], transports: ['synthetic'], impedance: false, markers: true } },
  { id: 'muse2', name: 'Muse 2 / Muse S', manufacturer: 'InteraXon', transport: 'bluetooth', capabilities: { eegChannels: 4, sampleRates: [256], transports: ['ble'], impedance: false, markers: true } },
  { id: 'brainbit', name: 'BrainBit', manufacturer: 'BrainBit', transport: 'bluetooth', capabilities: { eegChannels: 4, sampleRates: [250], transports: ['ble'], impedance: true, markers: true } },
  { id: 'ganglion', name: 'OpenBCI Ganglion', manufacturer: 'OpenBCI', transport: 'bluetooth', capabilities: { eegChannels: 4, sampleRates: [200], transports: ['ble'], impedance: true, markers: true } },
  { id: 'cyton', name: 'OpenBCI Cyton', manufacturer: 'OpenBCI', transport: 'serial', capabilities: { eegChannels: 8, sampleRates: [250], transports: ['usb'], impedance: true, markers: true } },
  { id: 'cyton-daisy', name: 'OpenBCI Cyton + Daisy', manufacturer: 'OpenBCI', transport: 'serial', capabilities: { eegChannels: 16, sampleRates: [125], transports: ['usb'], impedance: true, markers: true } },
  { id: 'streaming', name: 'BrainFlow Streaming Board', manufacturer: 'BrainFlow', transport: 'adb', capabilities: { eegChannels: 8, sampleRates: [125, 250, 500], transports: ['wifi'], impedance: false, markers: true } },
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

export function catalogBoards(): HeadsetDescriptor[] { return HEADSET_CATALOG.map((board) => ({ ...board, status: board.id === 'synthetic' ? 'available' : 'available' })); }
