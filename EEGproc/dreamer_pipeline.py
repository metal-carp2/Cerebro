"""Two-second DREAMER features and contract-checked Keras regression inference.

Run with --help. No training, baseline subtraction, or label thresholding is done.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import time
import zipfile
from importlib.metadata import version
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat

PAIRS = [('AF3', 'AF4'), ('F7', 'F8'), ('F3', 'F4'), ('FC5', 'FC6'),
         ('T7', 'T8'), ('P7', 'P8'), ('O1', 'O2')]
BANDS = ['delta', 'theta', 'alpha', 'betaL', 'betaH', 'gamma']
PIPELINE = 'eegproc-window-v1'


def keras_metadata(path):
    """Inspect a .keras archive without executing/deserializing model code."""
    with zipfile.ZipFile(path) as archive:
        config = json.loads(archive.read('config.json'))
    layers = config.get('config', {}).get('layers', [])
    inputs = [layer['config'].get('batch_shape', layer['config'].get('batch_input_shape'))
              for layer in layers if layer.get('class_name') == 'InputLayer']
    return {'input_shapes': inputs,
            'loss': config.get('compile_config', {}).get('loss'),
            'output_activation': layers[-1].get('config', {}).get('activation') if layers else None}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def extract_window(window, fs):
    """Match the notebook: filter each window, PSD, entropy, left-right power."""
    import eegproc
    if not hasattr(np, 'trapezoid'):
        np.trapezoid = np.trapz  # NumPy 1.x notebook compatibility
    started = time.perf_counter()
    filtered = eegproc.bandpass_filter(window, fs)
    filtered_at = time.perf_counter()
    power = eegproc.psd_bandpowers(filtered, fs, window_sec=2.0, overlap=0.0).reset_index(drop=True)
    entropy = eegproc.shannons_entropy(filtered, fs, window_sec=2.0, overlap=0.0).reset_index(drop=True)
    asymmetry = pd.DataFrame({
        f'{left}_{right}_{band}_asymmetry': power[f'{left}_{band}'] - power[f'{right}_{band}']
        for left, right in PAIRS if left in window.columns and right in window.columns
        for band in BANDS
    }, index=power.index)
    features = pd.concat([power, entropy, asymmetry], axis=1)
    if len(features) != 1 or features.columns.duplicated().any():
        raise ValueError('Expected exactly one row with unique feature names per two-second window')
    if not np.isfinite(features.to_numpy(dtype=float)).all():
        raise ValueError('Non-finite features; check flat channels, sampling rate and band definitions')
    finished = time.perf_counter()
    return features, {'filter_ms': (filtered_at - started) * 1000,
                      'feature_ms': (finished - filtered_at) * 1000}


def trial_matrix(trial, channels):
    matrix = np.asarray(trial, dtype=float)
    if matrix.ndim != 2:
        raise ValueError(f'Expected a 2D EEG trial; got {matrix.shape}')
    if matrix.shape[1] != len(channels):
        if matrix.shape[0] != len(channels):
            raise ValueError(f'Channel count does not match trial shape {matrix.shape}')
        matrix = matrix.T
    if not np.isfinite(matrix).all():
        raise ValueError('EEG contains NaN or infinite samples')
    return pd.DataFrame(matrix, columns=channels)


def iter_trials(dreamer):
    channels = [str(c).strip() for c in np.atleast_1d(dreamer.EEG_Electrodes)]
    if not channels or len(set(channels)) != len(channels):
        raise ValueError('EEG channel names must be unique')
    for participant_id, participant in enumerate(np.atleast_1d(dreamer.Data), 1):
        trials = np.atleast_1d(participant.EEG.stimuli)
        if trials.ndim == 2 and trials.dtype != object:
            trials = [trials]  # loadmat squeezes a one-trial MATLAB cell
        labels = np.atleast_1d(participant.ScoreArousal).astype(float)
        if labels.size != len(trials) or not np.isfinite(labels).all():
            raise ValueError(f'Participant {participant_id}: invalid trial arousal labels')
        for trial_id, trial in enumerate(trials, 1):
            yield participant_id, trial_id, float(labels[trial_id - 1]), trial_matrix(trial, channels)


class RegressionPredictor:
    """Accept only a documented one-window feature model, with frozen scaling."""
    def __init__(self, model_path, contract_path, fs, units):
        self.contract = json.loads(Path(contract_path).read_text(encoding='utf-8'))
        c = self.contract
        if (c.get('task') != 'arousal_regression' or c.get('pipeline') != PIPELINE
                or c.get('window_seconds') != 2 or c.get('sample_rate') != fs
                or c.get('input_units') != units or c.get('eegproc_version') != version('eegproc')):
            raise ValueError('Model contract does not match this pipeline, sample rate, units or EEGProc version')
        if c.get('model_sha256') != sha256(model_path):
            raise ValueError('Model hash differs from the model contract')
        self.order = c.get('feature_order', [])
        if not self.order or len(set(self.order)) != len(self.order):
            raise ValueError('Contract needs the exact ordered training feature names')
        metadata = keras_metadata(model_path)
        if 'crossentropy' in str(metadata['loss']).lower():
            raise ValueError('This model was saved with a classification loss, not regression')
        import tensorflow as tf
        self.model = tf.keras.models.load_model(model_path, compile=False, safe_mode=True)
        shape = self.model.input_shape
        expected = (None, len(self.order))
        if isinstance(shape, list) or tuple(shape) != expected:
            raise ValueError(f'Expected one-window feature input {expected}, got {shape}. No padding or inferred channel mapping is permitted.')
        if tuple(self.model.output_shape) != (None, 1):
            raise ValueError('Regression model must return one scalar per window')
        scaling = c.get('scaling', {})
        if scaling.get('kind') == 'identity':
            self.offset, self.scale = np.zeros(len(self.order)), np.ones(len(self.order))
        elif scaling.get('kind') == 'standard':
            self.offset, self.scale = np.asarray(scaling['mean'], dtype=float), np.asarray(scaling['scale'], dtype=float)
            if self.offset.shape != (len(self.order),) or self.scale.shape != self.offset.shape:
                raise ValueError('Training scaler dimensions do not match feature order')
        else:
            raise ValueError('Specify training scaling explicitly: identity or standard')
        if not np.isfinite(self.offset).all() or not np.isfinite(self.scale).all() or (self.scale <= 0).any():
            raise ValueError('Invalid training scaler values')
        self.output_scale = float(c['output_scale'])
        self.output_offset = float(c['output_offset'])
        if not np.isfinite([self.output_scale, self.output_offset]).all() or not c.get('output_units'):
            raise ValueError('Specify finite output conversion and output_units from training')

    def predict(self, features):
        missing = set(self.order) - set(features.columns)
        if missing:
            raise ValueError(f'Model features unavailable: {sorted(missing)}')
        values = (features.loc[:, self.order].to_numpy(dtype=float) - self.offset) / self.scale
        if not np.isfinite(values).all():
            raise ValueError('Non-finite model input')
        result = np.asarray(self.model(values.astype('float32'), training=False))
        if result.shape != (1, 1) or not np.isfinite(result).all():
            raise ValueError('Model must return one finite regression value')
        prediction = float(result[0, 0]) * self.output_scale + self.output_offset
        if not np.isfinite(prediction):
            raise ValueError('Non-finite prediction after output conversion')
        return prediction


def run(mat_path, output, units, model_path=None, contract_path=None, max_windows=None):
    import eegproc  # fail before creating output if dependency is missing
    del eegproc
    dreamer = loadmat(mat_path, squeeze_me=True, struct_as_record=False)['DREAMER']
    fs = float(dreamer.EEG_SamplingRate)
    if not np.isfinite(fs) or fs <= 0 or not (2 * fs).is_integer():
        raise ValueError('Sampling rate must give an integral two-second window')
    size = int(2 * fs)
    predictor = RegressionPredictor(model_path, contract_path, fs, units) if model_path else None
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)  # Never overwrite an existing run
    manifest = {'pipeline': PIPELINE, 'status': 'running', 'input': str(mat_path),
                'input_sha256': sha256(mat_path), 'sample_rate': fs, 'input_units': units,
                'window_seconds': 2, 'hop_seconds': 2, 'max_windows': max_windows,
                'python': platform.python_version(),
                'versions': {p: version(p) for p in ('numpy', 'pandas', 'scipy', 'eegproc')},
                'model_contract': predictor.contract if predictor else None,
                'label_scope': 'trial self-report; repeated per window, not a window-level annotation',
                'baseline_correction': False}
    count, coverage, order = 0, [], None
    try:
        with (output / 'windows.csv').open('w', newline='', encoding='utf-8') as file:
            writer = None
            for participant, trial, arousal, frame in iter_trials(dreamer):
                possible = len(frame) // size
                processed = 0
                for start in range(0, len(frame) - size + 1, size):
                    if max_windows is not None and count >= max_windows:
                        break
                    began = time.perf_counter()
                    try:
                        features, timing = extract_window(frame.iloc[start:start + size].reset_index(drop=True), fs)
                        if order is None:
                            order = list(features.columns)
                        elif list(features.columns) != order:
                            raise ValueError('Feature schema changed between windows')
                        inference_started = time.perf_counter()
                        prediction = predictor.predict(features) if predictor else None
                        inference_ms = (time.perf_counter() - inference_started) * 1000 if predictor else None
                    except Exception as exc:
                        raise ValueError(f'Participant {participant}, trial {trial}, start sample {start}: {exc}') from exc
                    total_ms = (time.perf_counter() - began) * 1000
                    row = dict(participant_id=participant, trial_id=trial, window_id=processed,
                               start_sample=start, end_sample=start + size, start_seconds=start / fs,
                               arousal_trial_label=arousal, **timing, inference_ms=inference_ms,
                               total_ms=total_ms, exceeds_2s_budget=total_ms > 2000,
                               prediction=prediction, **features.iloc[0].to_dict())
                    if writer is None:
                        writer = csv.DictWriter(file, fieldnames=list(row))
                        writer.writeheader()
                    writer.writerow(row)
                    count += 1
                    processed += 1
                coverage.append(dict(participant_id=participant, trial_id=trial, samples=len(frame),
                                     available_windows=possible, processed_windows=processed,
                                     dropped_tail_samples=len(frame) % size))
                print(f'Participant {participant}, trial {trial}: {processed}/{possible} windows', flush=True)
        if not count:
            raise ValueError('No complete windows found')
        manifest['status'] = 'complete' if all(r['processed_windows'] == r['available_windows'] for r in coverage) else 'limited'
    except Exception as exc:
        manifest['status'], manifest['error'] = 'failed', str(exc)
        raise
    finally:
        manifest['processed_windows'] = count
        manifest['feature_order'] = order
        pd.DataFrame(coverage).to_csv(output / 'coverage.csv', index=False)
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mat', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--input-units', choices=['uV', 'V'], help='Declare original units; no silent rescaling')
    parser.add_argument('--model', type=Path)
    parser.add_argument('--contract', type=Path)
    parser.add_argument('--inspect-model', type=Path)
    parser.add_argument('--max-windows', type=int, help='Optional smoke-test limit; omit for all trials/subjects')
    args = parser.parse_args()
    if args.inspect_model:
        print(json.dumps(keras_metadata(args.inspect_model), indent=2))
        return
    if not args.mat or not args.output or not args.input_units:
        parser.error('--mat, --output and --input-units are required')
    if bool(args.model) != bool(args.contract):
        parser.error('--model and --contract must be supplied together')
    if args.max_windows is not None and args.max_windows < 1:
        parser.error('--max-windows must be positive')
    run(args.mat, args.output, args.input_units, args.model, args.contract, args.max_windows)


if __name__ == '__main__':
    main()
