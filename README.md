# Cerebro

## Development environment

From an Anaconda/Miniforge prompt in this repository:

```powershell
conda env create -f environment.yml
conda activate cerebro
cd neuroflow-studio
npm install
npm run web
```

Use `npm run android` for the Android development target. Node.js is a separate prerequisite; Conda manages the Python converter and analysis dependencies, not the React Native runtime. Update an existing environment with `conda env update -f environment.yml`. Activate by environment name, not YAML filename.

The existing `requirements.txt`, `.venv`, and `EEGproc/model.py` are preserved. The new environment intentionally excludes TensorFlow until the mentor's model requirements are confirmed. `environment.yml` pins direct scientific dependencies, but is not a platform-specific transitive lockfile. Do not commit local environments or recordings.

## Recorded EEG benchmark

Open the **Replay** tab. No headset or computer companion is required for replay and feature computation on the device. Import CSV with a header containing only EEG channel names and numeric sample rows; enter the correct sample rate, units (V or uV), and raw/preprocessed mode before import. JSON includes these settings. Data is loaded into memory, limited to 25 MB in the picker. Playback schedules windows against the recording sample clock, rather than running an unpaced batch job.

The reference pipeline uses two-second windows, a configurable hop, window-local first-order high/low-pass filters for raw input, a Hann-window one-sided periodogram, theta [4,8), alpha [8,13), beta [13,30) integrated power, normalized spectral entropy, and optional log alpha-power left-minus-right asymmetry pairs. Preprocessed input bypasses filtering; volts are converted to microvolts. Filtering resets each window and can introduce edge transients. There is no notch or artifact removal in this reference pipeline. Its direct DFT is intentionally a baseline, not an optimized FFT. These definitions are **not verified against Vitor's EEGPROC library** and must not be treated as his model's feature contract.

Reports include preprocessing/feature/total compute time, queue delay, p50/p95 compute latency, and deadline misses (completion after the next window's scheduled arrival). Window acquisition time is separate from compute time. Model inference and predictions are null: no arousal model or calibration is implemented. The benchmark never routes replay data to the companion. Browser runs measure the browser; only actual phone runs support phone-latency claims. JS scheduling, foreground/background state and device load affect results. Record phone model, OS and app build alongside exported reports. Stop before switching tabs; leaving Replay discards its in-memory report. Android exports currently save to app-local storage; web exports download files.

### MATLAB and pandas

Convert a numeric MATLAB variable, specifying orientation and channels explicitly:

```powershell
python EEGproc/convert.py data/recording.mat data/replay.json --key eeg --sample-rate 128 --channels F3 F4 --units uV
```

Add `--transpose` for channels-by-samples input. MATLAB v7.3 numeric arrays use h5py. Nested DREAMER structures/cells need explicit trial extraction first; this converter never guesses subject, trial, axes or labels. Convert CSV containing metadata by selecting EEG columns:

```powershell
python EEGproc/convert.py data/recording.csv data/replay.json --sample-rate 128 --channels F3 F4
```

For pandas, call `EEGproc.convert.from_dataframe(frame, 128, ['F3', 'F4'])` and serialize the returned object as JSON. Portable JSON schema:

```json
{"version":1,"sampleRate":128,"channels":["F3","F4"],"kind":"raw","units":"uV","samples":[[1,2],[3,4]]}
```

The example illustrates the schema; provide at least two seconds of samples for replay. Sample rows must be regularly spaced. Timestamp/label columns must be excluded, and gaps must be handled explicitly before import. Feature-only matrices are not EEG recordings.

## Validation

Run `npm run typecheck` from `neuroflow-studio`. Model calibration, prediction accuracy, distillation and a validated EEGPROC adapter remain separate work requiring the mentor's library and model specification.
