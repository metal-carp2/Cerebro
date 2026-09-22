# DREAMER two-second processing

`dreamer_pipeline.py` processes every participant and stimulus trial in a DREAMER MATLAB file. It splits each trial into non-overlapping two-second windows, filters each window using EEGProc, and calculates PSD band powers, spectral Shannon entropy, and left-minus-right band-power asymmetry. With DREAMER's 14 channels this produces 210 features per window. Windows never cross trial or participant boundaries; incomplete final windows are discarded and counted.

## Environment and preprocessing

From the Cerebro repository root in PowerShell:

```powershell
conda env create -f environment-eegproc.yml
conda activate cerebro-eegproc
python EEGproc/dreamer_pipeline.py --mat "C:\path\to\DREAMER.mat" --output "dreamer-output" --input-units uV
```

Replace the dataset path and confirm the source's units before selecting `uV` or `V`. This flag records units, not a conversion. The separate environment leaves the app's existing Conda environment unchanged. Direct dependencies are pinned; this is not a cross-platform transitive lockfile.

For a smoke test add `--max-windows 2`. Omit it for the full dataset. Choose a new output directory for each run; existing output is never overwritten. In Kaggle use its actual input dataset path and an output such as `/kaggle/working/dreamer-output`.

Outputs:

- `windows.csv`: participant/trial IDs, sample positions, trial-level arousal labels, features, timings, and optional predictions.
- `coverage.csv`: processed windows and discarded tail samples for each trial.
- `manifest.json`: versions, feature order, input hash, configuration, and complete/limited/failed status.

Trial arousal labels are repeated for windows; they are **not** independently measured two-second labels. Baseline recordings are not processed or subtracted. This matches the notebook's stimulus-only workflow, not a verified model-training recipe. For later evaluation, split by participant before fitting normalization or training; never randomly mix windows from the same trial across training and testing.

## Regression model requirements

[EEGProc](https://github.com/EEGo-UNC/EEGProc) supplies feature processing, not trained regression weights. The locally referenced `arousal_lstm_muse.keras` was inspected: its input is `(None, 2500, 36)`, with a sigmoid output and binary-crossentropy loss. It cannot be treated as this pipeline's one-window arousal regressor.

To enable predictions, obtain a trusted `.keras` regression model trained on this exact feature recipe and its training metadata. Supply `--model model.keras --contract model-contract.json`. The adapter supports a single `(None, number_of_features)` input and one scalar output, not a sequence model. It checks the model hash, shape, feature order, version, units and frozen scaling. It does not train or silently adapt incompatible models.

The contract JSON must contain these fields, populated from training (not guessed):

```json
{
  "task": "arousal_regression",
  "pipeline": "eegproc-window-v1",
  "window_seconds": 2,
  "sample_rate": 128,
  "input_units": "uV",
  "eegproc_version": "1.0.0",
  "model_sha256": "REPLACE_WITH_MODEL_SHA256",
  "feature_order": ["REPLACE_WITH_EXACT_ORDERED_TRAINING_FEATURE_NAMES"],
  "scaling": {"kind": "identity"},
  "output_scale": 1,
  "output_offset": 0,
  "output_units": "arousal rating"
}
```

Use identity only if training used unscaled features. For standard scaling use `{"kind":"standard","mean":[...],"scale":[...]}` with frozen training vectors in feature order. Output conversion is `prediction * output_scale + output_offset`; use the training target's inverse conversion. Do not fit scalers on the inference recording. Training must also match channel montage, filters, band definitions, windowing, baseline treatment and asymmetry convention.

Inspect a model without deserializing it:

```powershell
python EEGproc/dreamer_pipeline.py --inspect-model "$env:USERPROFILE\Downloads\arousal_lstm_muse.keras"
python -m pytest EEGproc/test_dreamer_pipeline.py -q
```

Timing is offline per-window filtering, feature extraction and optional inference wall time on the machine running the script. It excludes file loading, model loading and CSV writing; the first prediction may include tracing/startup overhead. The two-second budget flag is not a phone benchmark or proof of real-time streaming. No synthetic predictions are emitted when no model is supplied.
