import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { deliver } from './export';
import { extractFeatures, featureKeys, parseRecording, preprocessWindow, Recording, Settings, summarize, Timing, validateSettings } from './replay';
import { AnalysisModel, applyChannelModel, applyModel, missingFeatures, validateModel } from './model';
import { PredictionScope, SourceScope, TimingScope } from './InstrumentPlots';
import { Btn, Group, Input, Panel, Param, Readout, StatusBar, Table } from './Chrome';
import { C, F, S } from './theme';

export default function ReplayScreen() {
  const { width } = useWindowDimensions();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [model, setModel] = useState<AnalysisModel | null>(null);
  const [modelName, setModelName] = useState('');
  const [name, setName] = useState('');
  const [rate, setRate] = useState('128');
  const [kind, setKind] = useState<Recording['kind']>('raw');
  const [units, setUnits] = useState<Recording['units']>('uV');
  const [high, setHigh] = useState('1'), [low, setLow] = useState('40'), [hop, setHop] = useState('2'), [pairs, setPairs] = useState('');
  const [running, setRunning] = useState(false), [notice, setNotice] = useState('Import a recording and, optionally, a model. No headset required.');
  const [progress, setProgress] = useState(0), [rows, setRows] = useState<Timing[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const report = useRef<{ source: string; metadata: Omit<Recording, 'samples'>; settings: Settings; runtime: string; startedAt: string; completed: boolean; model: (Omit<AnalysisModel, 'id'> & { file: string }) | null } | null>(null);
  const stop = () => { active.current = false; if (timer.current) clearTimeout(timer.current); setRunning(false); };
  useEffect(() => () => { active.current = false; if (timer.current) clearTimeout(timer.current); }, []);
  async function choose(type: string, limitMb: number) {
    const result = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
    if (result.canceled) return null;
    const asset = result.assets[0]!;
    if (asset.size && asset.size > limitMb * 1024 * 1024) throw new Error(`Use a file under ${limitMb} MB.`);
    const body = Platform.OS === 'web' ? await (await fetch(asset.uri)).text() : await FileSystem.readAsStringAsync(asset.uri);
    return { name: asset.name, body };
  }
  async function pick() {
    try {
      const file = await choose('*/*', 25);
      if (!file) return;
      const data = parseRecording(file.body, file.name, Number(rate), kind, units);
      stop(); setRecording(data); setName(file.name); setRows([]); report.current = null; setProgress(0);
      const warning = model ? describeFit(model, data, pairs) : '';
      setNotice(`${data.samples.length} samples · ${data.channels.join(', ')} · ${data.sampleRate} Hz · ${data.kind}${warning}`);
    } catch (error) { setNotice(String(error)); }
  }
  async function pickModel() {
    try {
      const file = await choose('application/json', 2);
      if (!file) return;
      const loaded = validateModel(JSON.parse(file.body));
      stop(); setModel(loaded); setModelName(file.name); setRows([]); report.current = null; setProgress(0);
      setNotice(`Loaded ${loaded.name} · ${loaded.weights.length} weights · ${loaded.input === 'features' ? 'feature' : 'channel'} input${recording ? describeFit(loaded, recording, pairs) : ''}`);
    } catch (error) { setNotice(String(error)); }
  }
  /** Warn as soon as we know a model cannot score this recording, rather than failing mid-run. */
  function describeFit(candidate: AnalysisModel, data: Recording, pairList: string) {
    if (candidate.input === 'channels') {
      return candidate.weights.length === data.channels.length ? '' : `. Warning: model expects ${candidate.weights.length} channels, recording has ${data.channels.length}.`;
    }
    const missing = missingFeatures(candidate, featureKeys(data, pairList));
    return missing.length ? `. Warning: recording does not produce ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.` : '';
  }
  function start() {
    if (!recording) return;
    try {
      const settings: Settings = { highpass: Number(high), lowpass: Number(low), hopSeconds: Number(hop), pairs };
      validateSettings(recording, settings);
      if (model?.input === 'features') {
        const missing = missingFeatures(model, featureKeys(recording, pairs));
        if (missing.length) throw new Error(`Model needs features this recording does not produce: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}. Add the channel pair or load a matching model.`);
      }
      stop(); setRows([]); setProgress(0); active.current = true; setRunning(true);
      const { samples, ...metadata } = recording;
      const { id: _id, ...modelReport } = model ?? ({} as AnalysisModel);
      report.current = { source: name, metadata, settings, runtime: Platform.OS, startedAt: new Date().toISOString(), completed: false, model: model ? { ...modelReport, file: modelName } : null };
      const started = performance.now(), windowSize = Math.round(recording.sampleRate * 2), step = Math.round(recording.sampleRate * settings.hopSeconds);
      const interval = step / recording.sampleRate * 1000;
      let end = windowSize, index = 0;
      const processNext = () => {
        if (!active.current) return;
        try {
          const due = started + end / recording.sampleRate * 1000;
          const began = performance.now();
          const data = preprocessWindow(samples.slice(end - windowSize, end), recording, settings);
          const filtered = performance.now();
          const features = extractFeatures(data, recording, settings.pairs);
          const finished = performance.now();
          const scored = model ? (model.input === 'features' ? applyModel(model, features) : applyChannelModel(model, data.at(-1) ?? [])) : null;
          const inferred = performance.now();
          const row: Timing = { window: index++, endSample: end, queueMs: Math.max(0, began - due), preprocessingMs: filtered - began, featureMs: finished - filtered, totalMs: inferred - began, missedDeadline: inferred > due + interval, inferenceMs: model ? inferred - finished : null, prediction: scored?.score ?? null, label: scored?.label ?? null, features };
          setRows(old => [...old, row]); setProgress(end); end += step;
          if (end > samples.length) { report.current!.completed = true; stop(); setNotice(model ? `Replay complete. ${index} windows scored with ${model.name}. Partial final window was omitted.` : 'Replay complete. No model loaded, so features were extracted but nothing was scored. Partial final window was omitted.'); return; }
          timer.current = setTimeout(processNext, Math.max(0, started + end / recording.sampleRate * 1000 - performance.now()));
        } catch (error) { stop(); setNotice(`Replay stopped: ${String(error)}`); }
      };
      timer.current = setTimeout(processNext, windowSize / recording.sampleRate * 1000);
      setNotice(`Replaying at recorded speed on this device. Model: ${model ? model.name : 'none loaded'}.`);
    } catch (error) { setNotice(String(error)); }
  }
  async function save(format: 'json' | 'csv') {
    try {
      if (!report.current || !rows.length) throw new Error('Run replay before exporting.');
      const content = format === 'json' ? JSON.stringify({ ...report.current, schemaVersion: 1, featureImplementation: 'reference-periodogram-v1', summary: summarize(rows), windows: rows }, null, 2) : ['window,endSample,queueMs,preprocessingMs,featureMs,totalMs,missedDeadline,inferenceMs,prediction,label', ...rows.map(r => [r.window,r.endSample,r.queueMs,r.preprocessingMs,r.featureMs,r.totalMs,r.missedDeadline,r.inferenceMs ?? '',r.prediction ?? '',r.label ?? ''].join(','))].join('\n');
      const filename = `cerebro-analysis-${Date.now()}.${format}`;
      const where = await deliver(filename, content, format === 'json' ? 'application/json' : 'text/csv');
      setNotice(Platform.OS === 'web' ? `Downloaded ${filename}` : `Exported ${where}`);
    } catch (error) { setNotice(String(error)); }
  }

  const summary = summarize(rows);
  const latest = rows.at(-1);
  const wide = width >= 900;
  const pct = recording ? progress / recording.samples.length * 100 : 0;
  const Choice = <T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) =>
    <View style={s.row}>{options.map(option => <Btn key={option} label={labels?.[option] ?? option} active={value === option} disabled={running} onPress={() => onChange(option)} />)}</View>;

  return <View style={s.page}>
    <View style={[s.cols, { flexDirection: wide ? 'row' : 'column' }]}>
      <View style={[s.setup, wide && { width: 344 }]}>
        <Group title="Recording">
          <Text style={s.hint}>CSV or JSON, up to 25 MB. Convert MATLAB files with the Python import utility. JSON files supply their own settings.</Text>
          <Param label="Sample rate (Hz)" hint="CSV only"><Input accessibilityLabel="CSV sample rate in Hz" editable={!running} value={rate} onChangeText={setRate} keyboardType="numeric" /></Param>
          <Param label="Signal type" hint="preprocessed input bypasses filtering"><Choice options={['raw', 'preprocessed'] as const} value={kind} onChange={setKind} labels={{ raw: 'Raw', preprocessed: 'Preprocessed' }} /></Param>
          <Param label="Units" hint="volts are converted to microvolts"><Choice options={['uV', 'V'] as const} value={units} onChange={setUnits} labels={{ uV: 'Microvolts', V: 'Volts' }} /></Param>
          <Btn wide label={recording ? 'Replace recording …' : 'Choose recording …'} onPress={pick} disabled={running} />
        </Group>

        <Group title="Processing">
          <Text style={s.hint}>Window length is fixed at 2 seconds.</Text>
          {([['High-pass (Hz)', high, setHigh, 'zero disables the high-pass'], ['Low-pass (Hz)', low, setLow, 'must stay below Nyquist'], ['Window step (s)', hop, setHop, 'hop between successive windows'], ['Channel pairs', pairs, setPairs, 'asymmetry pairs, e.g. F3:F4,C3:C4']] as const).map(([label, value, setter, hint]) =>
            <Param key={label} label={label} hint={hint}><Input accessibilityLabel={label} editable={!running} value={value} onChangeText={setter} /></Param>)}
        </Group>

        <Group title="Model">
          <Text style={s.hint}>Optional. A JSON file naming the features it consumes and its linear weights. Model files are data only and are never executed.</Text>
          {model
            ? <Readout mono={false} rows={[['Name', model.name], ['Weights', model.weights.length], ['Input', model.input], ['Output', model.output], ['Threshold', model.threshold], ['Labels', `${model.labels[0]} / ${model.labels[1]}`]]} />
            : <Text style={s.hint}>No model loaded. A run still extracts features and measures timing.</Text>}
          <Btn wide label={model ? 'Replace model …' : 'Choose model …'} onPress={pickModel} disabled={running} />
          {!!model && <Btn wide label="Remove model" onPress={() => { stop(); setModel(null); setModelName(''); setRows([]); report.current = null; setProgress(0); setNotice('Model removed. Runs will extract features without scoring.'); }} disabled={running} />}
        </Group>

        <View style={s.row}>
          <Btn wide label={running ? 'Stop Run' : rows.length ? 'Run Again' : 'Start Run'} disabled={!recording} active={running}
            onPress={running ? () => { stop(); setNotice('Run stopped. You can export the completed windows.'); } : start} />
        </View>
      </View>

      <View style={s.results}>
        <Panel title={recording ? `Source Signal ${recording.sampleRate} Hz` : "Source Signal"} flush right={<Text style={s.capMeta}>{running ? 'RUNNING' : recording ? 'READY' : 'NO RECORDING'}</Text>}>
          <SourceScope samples={recording?.samples ?? []} channels={recording?.channels ?? []} rate={recording?.sampleRate ?? 1} />
          <View style={s.track}><View style={[s.fill, { width: `${pct}%` as `${number}%` }]} /></View>
          <StatusBar segments={[
            name || 'No file loaded',
            recording ? `${recording.channels.length} ch · ${recording.kind}` : null,
            `${progress.toLocaleString()} / ${(recording?.samples.length ?? 0).toLocaleString()} samples`,
          ]} />
        </Panel>

        <Panel title="Model output" flush right={<Text style={s.capMeta}>{model ? model.name : 'no model'}</Text>}>
          {model
            ? <>
              <PredictionScope rows={rows} threshold={model.threshold} output={model.output} />
              <View style={s.pad}>
                <Readout rows={[
                  ['Latest window', latest?.prediction == null ? '—' : model.output === 'probability' ? `${(latest.prediction * 100).toFixed(2)} %` : latest.prediction.toPrecision(5)],
                  ['Latest label', latest?.label ?? '—'],
                  ['Mean output', summary.meanScore === null ? '—' : summary.meanScore.toPrecision(5)],
                  ['Range', summary.minScore === null ? '—' : `${summary.minScore.toPrecision(4)} … ${summary.maxScore!.toPrecision(4)}`],
                  ['Scored windows', `${summary.scoredWindows} / ${summary.windows}`],
                  ...Object.entries(summary.labelCounts).map(([label, count]) => [`  ${label}`, `${count}  (${(count / Math.max(1, summary.scoredWindows) * 100).toFixed(1)}%)`] as [string, string]),
                ]} />
              </View>
            </>
            : <Text style={s.empty}>No model loaded. Choose a model file to score every window as it replays.</Text>}
        </Panel>

        <Panel title="Timing" flush right={<Text style={s.capMeta}>2 s window</Text>}>
          <TimingScope rows={rows} />
          <View style={s.pad}>
            <Readout rows={[
              ['Median processing', summary.medianMs === null ? '—' : `${summary.medianMs.toFixed(3)} ms`],
              ['95th percentile', summary.p95Ms === null ? '—' : `${summary.p95Ms.toFixed(3)} ms`],
              ['Median inference', summary.medianInferenceMs === null ? '—' : `${summary.medianInferenceMs.toFixed(3)} ms`],
              ['Maximum queue delay', summary.maxQueueMs === null ? '—' : `${summary.maxQueueMs.toFixed(3)} ms`],
              ['Missed deadlines', rows.length ? summary.missedDeadlines : '—', summary.missedDeadlines ? 'warn' : undefined],
              ['Model file', modelName || '—'],
            ]} />
          </View>
        </Panel>

        <Panel title="Latest window features" flush right={<Text style={s.capMeta}>reference-periodogram-v1</Text>}>
          <Table columns={['Feature', 'Value']} widths={[2, 1]}
            rows={latest ? Object.entries(latest.features).map(([key, value]) => [key, value.toPrecision(6)]) : []} />
          <StatusBar segments={['Reference PSD, spectral entropy and alpha asymmetry', 'Compatibility with Vitor’s pipeline has not been verified']} />
        </Panel>

        <Panel title="Export">
          <View style={s.row}>
            <Btn label="Export report (JSON)" disabled={running || !rows.length} onPress={() => save('json')} />
            <Btn label="Export timing (CSV)" disabled={running || !rows.length} onPress={() => save('csv')} />
          </View>
        </Panel>

        <View accessibilityLiveRegion="polite"><StatusBar segments={[notice]} /></View>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: { gap: 12 },
  cols: { gap: 12, alignItems: 'stretch' },
  setup: { gap: 12 },
  results: { flex: 1, minWidth: 0, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  pad: { padding: 10 },
  hint: { color: C.inkHint, fontFamily: F.ui, fontSize: S.md, lineHeight: 18 },
  capMeta: { color: C.inkDim, fontFamily: F.mono, fontSize: S.sm },
  empty: { color: C.inkHint, fontFamily: F.ui, fontSize: S.md, padding: 18, textAlign: 'center' },
  track: { height: 5, backgroundColor: C.faceDark, borderTopWidth: 1, borderTopColor: C.edge },
  fill: { height: 4, backgroundColor: C.sel },
});
