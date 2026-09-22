# NeuroFlow Studio

A local-first Expo/React Native EEG workbench built as an application layer for BrainFlow.

## Implemented

- Built-in high/low-pass preprocessing controls and an eight-channel synthetic EEG stream.
- Live multi-channel EEG visualization.
- Connection center with the BrainFlow synthetic board and Web Serial selection in compatible desktop browsers.
- Offline analysis: replay a recorded CSV/JSON file window by window, extract features, and score every window with an uploaded model.
- Model library, live scoring, and import of portable linear-model JSON files.
- Browser and Android project configuration from one React Native codebase.
- Local recording history with CSV and JSON export.
- Local-only privacy mode. Firebase is deliberately not configured without project credentials and a user consent policy.
- Correct separation between ADB (computer-to-Android development connection) and EEG-device discovery.

Per-vendor headset adapters (Muse, BrainBit, OpenBCI) and the phone/computer inference router were removed from this build to keep the surface honest; both are recoverable from git history.

## BCI2000-inspired workbench

The app now follows the same broad separation of concerns as BCI2000:

- **Source:** device status, sample-rate clock, streaming, recording, and synthetic-board testing.
- **Signal processing:** channel selection, high/low-pass controls, CAR or nearest-neighbor Laplacian spatial filters, artifact rejection, classifier selection, and output normalization.
- **Application:** offline analysis of recorded files, 2D cursor feedback, P300 matrix-speller preview, timed motor-imagery/evoked-response stimulus presentation, and free-running feedback.
- **Operator:** configure/start/suspend lifecycle, module health, run identity, notes, timing display, and timestamped state/event log.
- **Configuration:** portable JSON parameter import/export covering source-adjacent, processing, classifier, paradigm, subject, and run settings.
- **Data:** signal samples, event markers, parameters, and notes are stored together in session JSON; flattened signal export is available as CSV.

This is a functional mobile/web MVP inspired by BCI2000, not a binary-compatible reimplementation. It does not read or write BCI2000 `.dat`/`.prm` files, execute BCI2000 Operator scripts, guarantee hard real-time scheduling, or reproduce BCI2000's full hardware/filter ecosystem. Those features need a desktop/native service and dedicated format/runtime compatibility work.

## Run

```bash
npm install
npm run web
```

For Android, install Android Studio/SDK, enable USB or wireless debugging, then:

```bash
adb connect PHONE_IP:5555
npm run android
```

## Real BrainFlow hardware bridge

The included synthetic source makes every screen testable today. Real EEG acquisition requires a custom Expo development build containing a React Native native module that wraps BrainFlow's Java/Android API. The bridge should expose `scan`, `connect`, `startStream`, `stopStream`, and a sample event. Do not attempt to use ADB as EEG-board discovery: use BrainFlow board parameters plus Bluetooth/USB permissions.

The upstream SDK source supplied with this project was left unmodified in `work/brainflow-source/brainflow-master`.

## Analysis: upload a model, score a recording

The **Analysis** tab runs the full offline path with no headset attached:

1. Choose a recording (CSV, or JSON in the schema `src/replay.ts` validates; up to 25 MB). Convert MATLAB files with `EEGproc/convert.py`.
2. Choose a model JSON file. The app checks up front that every feature the model names is one this recording will produce, and says which are missing if not.
3. Start the run. Each two-second window is filtered, reduced to features, and scored. You get the per-window output plotted against the model's decision threshold, the label distribution, the output range, and the inference latency alongside the existing processing timings.
4. Export the run as JSON (model metadata, settings, per-window features and predictions, summary) or as timing/prediction CSV.

## Model file schema

Two model shapes, both plain data — see `model.example.json` and `model.channels.example.json`:

- **Feature models** declare `features`, a list of feature keys, with one weight each. Keys are `<channel>.theta_power`, `<channel>.alpha_power`, `<channel>.beta_power`, `<channel>.spectral_entropy`, and `<left>:<right>.alpha_log_asymmetry` for each configured channel pair. These run in Analysis.
- **Channel models** omit `features` and carry one weight per EEG channel, applied to the latest sample. These run live in the Models tab.

Both accept `bias`, optional `standardize` (`mean`/`scale` per weight, applied before the dot product), `output` (`probability` for a logistic squash, or raw `score`), `labels` (a two-element negative/positive pair), and `threshold`.

Models are intentionally constrained to transparent linear weights so importing a file can never execute code. ONNX/TFLite support belongs in the native bridge and should validate tensor shapes before inference.

## Data and privacy

AsyncStorage holds session history and imported model metadata on the device. CSV/JSON exports are initiated by the user. No analytics, cloud account, Firebase SDK, or background upload is included.
