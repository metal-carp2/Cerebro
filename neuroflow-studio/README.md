# NeuroFlow Studio

A local-first Expo/React Native EEG workbench built as an application layer for BrainFlow.

## Implemented

- Built-in high/low-pass preprocessing controls and an eight-channel synthetic EEG stream.
- Live multi-channel EEG visualization.
- Connection center with synthetic board and Web Serial selection in compatible desktop browsers.
- Model library, live scoring, and import of portable linear-model JSON files.
- Browser and Android project configuration from one React Native codebase.
- Local recording history with CSV and JSON export.
- Local-only privacy mode. Firebase is deliberately not configured without project credentials and a user consent policy.
- Correct separation between ADB (computer-to-Android development connection) and EEG-device discovery.

## BCI2000-inspired workbench

The app now follows the same broad separation of concerns as BCI2000:

- **Source:** device status, sample-rate clock, streaming, recording, and synthetic-board testing.
- **Signal processing:** channel selection, high/low-pass controls, CAR or nearest-neighbor Laplacian spatial filters, artifact rejection, classifier selection, and output normalization.
- **Application:** 2D cursor feedback, P300 matrix-speller preview, timed motor-imagery/evoked-response stimulus presentation, and free-running feedback.
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

## Hybrid phone/computer mode

The **Compute** tab supports three routing policies: phone only, automatic fallback, and computer preferred. A dependency-free development companion is included and exposes health and inference endpoints on the local network.

Start it on the computer:

```bash
python companion/server.py
```

Find the computer's LAN address with `ipconfig`, then enter `http://COMPUTER_IP:8765` in the app's Compute tab. Keep the phone and computer on the same private network. The included backend is an end-to-end routing test that computes a transparent signal-energy score; it is not a pretrained neural model. Replace `predict()` in `companion/server.py` with validated PyTorch/ONNX EEGNet, BIOT, LaBraM, or EEGPT inference.

Before exposing the companion outside a trusted development network, add authenticated pairing, TLS, replay protection, payload limits, and explicit user consent. The production Android manifest will also need cleartext-local-network policy or HTTPS configuration.

## Headset adapter layer

`src/headsets.ts` defines the common acquisition contract and an initial compatibility catalog for BrainFlow synthetic/streaming boards, Muse, BrainBit, OpenBCI Ganglion, and OpenBCI Cyton variants. Only the synthetic adapter is active in the Expo/browser build. The UI accurately marks physical devices as requiring the native BrainFlow Android build rather than presenting a false connection.

## Imported model schema

See `model.example.json`. Imported models are intentionally constrained to transparent logistic linear models (`weights`, optional `bias`) so parsing arbitrary model files cannot execute code. ONNX/TFLite support belongs in the native bridge and should validate tensor shapes before inference.

## Data and privacy

AsyncStorage holds session history and imported model metadata on the device. CSV/JSON exports are initiated by the user. No analytics, cloud account, Firebase SDK, or background upload is included.
