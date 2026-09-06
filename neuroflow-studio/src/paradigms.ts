import { ParadigmId } from './types';

export type Paradigm = { id: ParadigmId; name: string; description: string; trials: number; trialSeconds: number; output: string };
export const PARADIGMS: Paradigm[] = [
  { id: 'cursor', name: '2D Cursor Training', description: 'Maps normalized control output to vertical cursor movement with target trials and feedback.', trials: 20, trialSeconds: 4, output: 'continuous control' },
  { id: 'p300', name: 'P300 Matrix Speller', description: 'Row/column visual oddball task with synchronized stimulus markers.', trials: 30, trialSeconds: 6, output: 'symbol selection' },
  { id: 'stimulus', name: 'Stimulus Presentation', description: 'Timed visual cues for evoked-response and motor-imagery protocols.', trials: 40, trialSeconds: 3, output: 'event-related epochs' },
  { id: 'free', name: 'Free Running Feedback', description: 'No trial structure; streams decoded control continuously.', trials: 1, trialSeconds: 300, output: 'continuous control' },
];
