"""Put already-prepared input through arousal_lstm_muse.keras and print its output.

Skips DREAMER loading and build_inputs(): the file must already hold the
model's 36 inputs, one row per time step (.npy array, or .csv with 36 numeric
columns). Every 2500-row window, stepping by --hop rows, is scored.

    python EEGproc/try_model.py --model arousal_lstm_muse.keras --input inputs.csv
    python EEGproc/try_model.py --model arousal_lstm_muse.keras --random   # wiring check only
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from lstm_pipeline import N_INPUTS, SEQUENCE_LENGTH, ArousalLSTM


def load_inputs(path):
    path = Path(path)
    if path.suffix == '.npy':
        values = np.load(path, allow_pickle=False)
    elif path.suffix == '.csv':
        values = pd.read_csv(path).to_numpy(dtype=float)
    else:
        raise ValueError('Input must be .npy or .csv')
    if values.ndim != 2 or values.shape[1] != N_INPUTS:
        raise ValueError(f'Expected rows x {N_INPUTS} inputs, got {values.shape}')
    if len(values) < SEQUENCE_LENGTH:
        raise ValueError(f'Need at least {SEQUENCE_LENGTH} rows, got {len(values)}')
    return values


def score(model, values, hop):
    for start in range(0, len(values) - SEQUENCE_LENGTH + 1, hop):
        began = time.perf_counter()
        probability = model.predict(values[start:start + SEQUENCE_LENGTH])
        yield dict(start_row=start, end_row=start + SEQUENCE_LENGTH, probability=probability,
                   inference_ms=(time.perf_counter() - began) * 1000)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model', type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input', type=Path, help='.npy or .csv of rows x 36 model inputs')
    source.add_argument('--random', action='store_true', help='Score random noise to check the model runs')
    parser.add_argument('--hop', type=int, default=256, help='Rows between windows (default 256 = 2 s at 128 Hz)')
    parser.add_argument('--output', type=Path, help='Optional CSV of per-window results')
    args = parser.parse_args()
    if args.hop < 1:
        parser.error('--hop must be positive')
    values = (np.random.default_rng(0).normal(size=(SEQUENCE_LENGTH + 2 * args.hop, N_INPUTS))
              if args.random else load_inputs(args.input))
    model = ArousalLSTM(args.model)
    model.predict(values[:SEQUENCE_LENGTH])  # trace the graph so timings below are steady-state
    rows = []
    for row in score(model, values, args.hop):
        rows.append(row)
        print(f"rows {row['start_row']:>7}-{row['end_row']:<7} output={row['probability']:.4f} "
              f"({row['inference_ms']:.0f} ms)", flush=True)
    if args.output:
        with args.output.open('x', newline='', encoding='utf-8') as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


if __name__ == '__main__':
    sys.exit(main())
