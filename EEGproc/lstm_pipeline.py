"""Score DREAMER trials with arousal_lstm_muse.keras every two seconds.

The model takes (None, 2500, 36): 2500 time steps of 36 inputs, one sigmoid
arousal probability. Each trial is buffered; once 2500 samples are available,
the latest 2500 are scored, then again after every further two seconds of
samples. At DREAMER's 128 Hz the model therefore sees ~19.5 s of history.

How DREAMER's 14 channels become the model's 36 inputs is unknown until the
training recipe is available, so build_inputs() raises. Run with --help.
"""
from __future__ import annotations

import argparse
import csv
import json
import platform
import time
from collections import deque
from importlib.metadata import version
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat

from dreamer_pipeline import iter_trials, keras_metadata, sha256

SEQUENCE_LENGTH = 2500
N_INPUTS = 36
HOP_SECONDS = 2
PIPELINE = 'arousal-lstm-v1'


def build_inputs(window: pd.DataFrame, fs: float) -> np.ndarray:
    """Turn SEQUENCE_LENGTH x channels EEG into SEQUENCE_LENGTH x N_INPUTS model input.

    Replace with the training recipe: input column order, any filtering or
    resampling, and the frozen training scaler. Do not fit scaling here.
    """
    raise NotImplementedError(
        'The mapping from EEG channels to the model\'s 36 inputs is unknown. '
        'Implement build_inputs() from the model\'s training notebook.')


class ArousalLSTM:
    """Loads the Keras model once and compiles a graph for fast repeated calls."""
    def __init__(self, model_path):
        metadata = keras_metadata(model_path)
        if metadata['input_shapes'] != [[None, SEQUENCE_LENGTH, N_INPUTS]]:
            raise ValueError(f'Expected input (None, {SEQUENCE_LENGTH}, {N_INPUTS}), got {metadata["input_shapes"]}')
        import tensorflow as tf
        model = tf.keras.models.load_model(model_path, compile=False, safe_mode=True)
        if tuple(model.output_shape) != (None, 1):
            raise ValueError(f'Expected one output per window, got {model.output_shape}')
        # Eager calls take ~18 s per window on CPU; a traced graph takes ~0.2 s.
        self._call = tf.function(lambda x: model(x, training=False),
                                 input_signature=[tf.TensorSpec((None, SEQUENCE_LENGTH, N_INPUTS), tf.float32)])
        self.sha256 = sha256(model_path)

    def predict(self, inputs):
        inputs = np.asarray(inputs, dtype=np.float32)
        if inputs.shape != (SEQUENCE_LENGTH, N_INPUTS):
            raise ValueError(f'Model input must be {(SEQUENCE_LENGTH, N_INPUTS)}, got {inputs.shape}')
        if not np.isfinite(inputs).all():
            raise ValueError('Non-finite model input')
        result = np.asarray(self._call(inputs[None]))
        if result.shape != (1, 1) or not np.isfinite(result).all():
            raise ValueError('Model must return one finite probability')
        return float(result[0, 0])


class StreamingScorer:
    """Buffer incoming samples and score the latest SEQUENCE_LENGTH every hop."""
    def __init__(self, model, channels, fs, input_builder=build_inputs):
        if not (HOP_SECONDS * fs).is_integer():
            raise ValueError('Sampling rate must give an integral two-second hop')
        self.model, self.channels, self.fs = model, list(channels), fs
        self.input_builder = input_builder
        self.hop = int(HOP_SECONDS * fs)
        self.buffer = deque(maxlen=SEQUENCE_LENGTH)
        self.seen = 0
        self.next_score_at = SEQUENCE_LENGTH

    def push(self, samples):
        """Add samples x channels; return one result per completed hop."""
        results = []
        for sample in np.asarray(samples, dtype=float):
            self.buffer.append(sample)
            self.seen += 1
            if self.seen == self.next_score_at:
                results.append(self._score())
                self.next_score_at += self.hop
        return results

    def _score(self):
        began = time.perf_counter()
        window = pd.DataFrame(np.array(self.buffer), columns=self.channels)
        inputs = self.input_builder(window, self.fs)
        built = time.perf_counter()
        probability = self.model.predict(inputs)
        finished = time.perf_counter()
        return dict(start_sample=self.seen - SEQUENCE_LENGTH, end_sample=self.seen,
                    end_seconds=self.seen / self.fs, probability=probability,
                    preprocess_ms=(built - began) * 1000, inference_ms=(finished - built) * 1000,
                    total_ms=(finished - began) * 1000,
                    exceeds_2s_budget=(finished - began) > HOP_SECONDS)


def run(mat_path, model_path, output, max_windows=None, input_builder=build_inputs, model=None):
    dreamer = loadmat(mat_path, squeeze_me=True, struct_as_record=False)['DREAMER']
    fs = float(dreamer.EEG_SamplingRate)
    model = model or ArousalLSTM(model_path)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)  # Never overwrite an existing run
    manifest = {'pipeline': PIPELINE, 'status': 'running', 'input': str(mat_path),
                'input_sha256': sha256(mat_path), 'model': str(model_path), 'model_sha256': model.sha256,
                'sample_rate': fs, 'sequence_length': SEQUENCE_LENGTH,
                'sequence_seconds': SEQUENCE_LENGTH / fs, 'hop_seconds': HOP_SECONDS,
                'max_windows': max_windows, 'python': platform.python_version(),
                'versions': {p: version(p) for p in ('numpy', 'pandas', 'scipy', 'tensorflow')},
                'label_scope': 'trial self-report (1-5); repeated per window, not a window-level annotation'}
    count, coverage = 0, []
    try:
        with (output / 'windows.csv').open('w', newline='', encoding='utf-8') as file:
            writer = None
            for participant, trial, arousal, frame in iter_trials(dreamer):
                scorer = StreamingScorer(model, frame.columns, fs, input_builder)
                available = max(0, (len(frame) - SEQUENCE_LENGTH) // scorer.hop + 1)
                processed = 0
                for start in range(0, len(frame), scorer.hop):
                    if max_windows is not None and count >= max_windows:
                        break
                    try:
                        results = scorer.push(frame.iloc[start:start + scorer.hop].to_numpy())
                    except Exception as exc:
                        raise ValueError(f'Participant {participant}, trial {trial}, sample {start}: {exc}') from exc
                    for result in results:
                        row = dict(participant_id=participant, trial_id=trial, window_id=processed,
                                   arousal_trial_label=arousal, **result)
                        if writer is None:
                            writer = csv.DictWriter(file, fieldnames=list(row))
                            writer.writeheader()
                        writer.writerow(row)
                        count += 1
                        processed += 1
                coverage.append(dict(participant_id=participant, trial_id=trial, samples=len(frame),
                                     available_windows=available, processed_windows=processed))
                print(f'Participant {participant}, trial {trial}: {processed}/{available} windows', flush=True)
        if not count:
            raise ValueError(f'No trial has {SEQUENCE_LENGTH} samples')
        manifest['status'] = 'complete' if all(r['processed_windows'] == r['available_windows'] for r in coverage) else 'limited'
    except Exception as exc:
        manifest['status'], manifest['error'] = 'failed', str(exc)
        raise
    finally:
        manifest['processed_windows'] = count
        pd.DataFrame(coverage).to_csv(output / 'coverage.csv', index=False)
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--mat', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-windows', type=int, help='Optional smoke-test limit; omit for all trials/subjects')
    args = parser.parse_args()
    if args.max_windows is not None and args.max_windows < 1:
        parser.error('--max-windows must be positive')
    run(args.mat, args.model, args.output, args.max_windows)


if __name__ == '__main__':
    main()
