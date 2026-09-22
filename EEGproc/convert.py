"""Convert explicitly selected EEG arrays to the portable Cerebro replay format."""
import argparse
import json
from pathlib import Path

import numpy as np


def recording(data, sample_rate, channels, kind="raw", units="uV"):
    values = np.asarray(data, dtype=float)
    if values.ndim != 2 or values.shape[0] < 2 or values.shape[1] < 1:
        raise ValueError("Expected a samples-by-channels matrix with at least two samples")
    if not np.isfinite(values).all() or not np.isfinite(sample_rate) or sample_rate <= 0:
        raise ValueError("Samples and positive sample rate must be finite")
    if len(channels) != values.shape[1] or len(set(channels)) != len(channels):
        raise ValueError("Provide one unique channel name per column")
    if kind not in ("raw", "preprocessed") or units not in ("uV", "V"):
        raise ValueError("Invalid kind or units")
    return dict(version=1, sampleRate=sample_rate, channels=channels, kind=kind,
                units=units, samples=values.tolist())


def from_dataframe(frame, sample_rate, channels, **kwargs):
    """Explicit channel selection excludes timestamps, labels and pandas indices."""
    return recording(frame.loc[:, channels].to_numpy(), sample_rate, channels, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sample-rate", type=float, required=True)
    parser.add_argument("--channels", nargs="+", required=True)
    parser.add_argument("--kind", choices=["raw", "preprocessed"], default="raw")
    parser.add_argument("--units", choices=["uV", "V"], default="uV")
    parser.add_argument("--key", help="Numeric MATLAB variable name (required for .mat)")
    parser.add_argument("--transpose", action="store_true", help="Convert channels-by-samples MATLAB arrays")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a new filename")
    if args.input.suffix.lower() == ".csv":
        import pandas as pd
        data = pd.read_csv(args.input).loc[:, args.channels].to_numpy()
    elif args.input.suffix.lower() == ".mat":
        if not args.key:
            parser.error("MATLAB import needs --key for an explicitly selected numeric matrix")
        from scipy.io import loadmat
        try:
            data = loadmat(args.input)[args.key]
        except NotImplementedError:
            import h5py
            with h5py.File(args.input) as file:
                data = np.asarray(file[args.key])
        if args.transpose:
            data = data.T
    else:
        parser.error("Use CSV or MATLAB .mat")
    result = recording(data, args.sample_rate, args.channels, args.kind, args.units)
    args.output.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
