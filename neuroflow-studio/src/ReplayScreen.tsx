import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { extractFeatures, parseRecording, preprocessWindow, Recording, Settings, summarize, Timing, validateSettings } from './replay';

const button = { backgroundColor: '#165849', padding: 12, borderRadius: 8, marginVertical: 5 };
const input = { color: '#fff', borderWidth: 1, borderColor: '#526576', padding: 10, marginVertical: 5 };
const textStyle = { color: '#d7e7ed', marginVertical: 5 };
export default function ReplayScreen() {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('128');
  const [kind, setKind] = useState<Recording['kind']>('raw');
  const [units, setUnits] = useState<Recording['units']>('uV');
  const [high, setHigh] = useState('1'), [low, setLow] = useState('40'), [hop, setHop] = useState('2'), [pairs, setPairs] = useState('');
  const [running, setRunning] = useState(false), [notice, setNotice] = useState('Import a recording; no headset required.');
  const [progress, setProgress] = useState(0), [rows, setRows] = useState<Timing[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const report = useRef<{ source: string; metadata: Omit<Recording, 'samples'>; settings: Settings; runtime: string; startedAt: string; completed: boolean } | null>(null);
  const stop = () => { active.current = false; if (timer.current) clearTimeout(timer.current); setRunning(false); };
  useEffect(() => () => { active.current = false; if (timer.current) clearTimeout(timer.current); }, []);
  async function pick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0]!;
      if (asset.size && asset.size > 25 * 1024 * 1024) throw new Error('Use a recording under 25 MB for this in-memory replay.');
      const body = Platform.OS === 'web' ? await (await fetch(asset.uri)).text() : await FileSystem.readAsStringAsync(asset.uri);
      const data = parseRecording(body, asset.name, Number(rate), kind, units);
      stop(); setRecording(data); setName(asset.name); setRows([]); report.current = null; setProgress(0);
      setNotice(`${data.samples.length} samples · ${data.channels.join(', ')} · ${data.sampleRate} Hz · ${data.kind}`);
    } catch (error) { setNotice(String(error)); }
  }
  function start() {
    if (!recording) return;
    try {
      const settings: Settings = { highpass: Number(high), lowpass: Number(low), hopSeconds: Number(hop), pairs };
      validateSettings(recording, settings);
      stop(); setRows([]); setProgress(0); active.current = true; setRunning(true);
      const { samples, ...metadata } = recording;
      report.current = { source: name, metadata, settings, runtime: Platform.OS, startedAt: new Date().toISOString(), completed: false };
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
          const row: Timing = { window: index++, endSample: end, queueMs: Math.max(0, began - due), preprocessingMs: filtered - began, featureMs: finished - filtered, totalMs: finished - began, missedDeadline: finished > due + interval, inferenceMs: null, prediction: null, features };
          setRows(old => [...old, row]); setProgress(end); end += step;
          if (end > samples.length) { report.current!.completed = true; stop(); setNotice('Replay complete. Model inference is not installed. Partial final window was omitted.'); return; }
          timer.current = setTimeout(processNext, Math.max(0, started + end / recording.sampleRate * 1000 - performance.now()));
        } catch (error) { stop(); setNotice(`Replay stopped: ${String(error)}`); }
      };
      timer.current = setTimeout(processNext, windowSize / recording.sampleRate * 1000);
      setNotice('Replaying at recorded speed on this device. Model: not installed.');
    } catch (error) { setNotice(String(error)); }
  }
  async function save(format: 'json' | 'csv') {
    try {
      if (!report.current || !rows.length) throw new Error('Run replay before exporting.');
      const content = format === 'json' ? JSON.stringify({ ...report.current, schemaVersion: 1, featureImplementation: 'reference-periodogram-v1', model: null, summary: summarize(rows), windows: rows }, null, 2) : ['window,endSample,queueMs,preprocessingMs,featureMs,totalMs,missedDeadline,inferenceMs,prediction', ...rows.map(r => [r.window,r.endSample,r.queueMs,r.preprocessingMs,r.featureMs,r.totalMs,r.missedDeadline,'',''].join(','))].join('\n');
      const filename = `cerebro-timing-${Date.now()}.${format}`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); setNotice(`Downloaded ${filename}`);
      } else { const uri = `${FileSystem.documentDirectory}${filename}`; await FileSystem.writeAsStringAsync(uri, content); setNotice(`Saved to app storage: ${uri}`); }
    } catch (error) { setNotice(String(error)); }
  }
  const summary = summarize(rows);
  return <View>
    <Text style={[textStyle, { fontSize: 22 }]}>Recorded EEG · phone processing benchmark</Text>
    <Text style={textStyle}>Two-second windows. Predictions and calibration are pending Vitor’s model. These reference features are not EEGPROC-compatible model inputs yet.</Text>
    <Text style={textStyle}>{notice}</Text>
    {!running && <>
      <Text style={textStyle}>CSV sample rate (JSON contains its own metadata)</Text><TextInput style={input} value={rate} onChangeText={setRate} keyboardType="numeric" />
      <Pressable style={button} onPress={() => setKind(kind === 'raw' ? 'preprocessed' : 'raw')}><Text style={textStyle}>CSV input: {kind}</Text></Pressable>
      <Pressable style={button} onPress={() => setUnits(units === 'uV' ? 'V' : 'uV')}><Text style={textStyle}>CSV units: {units}</Text></Pressable>
      <Pressable style={button} onPress={pick}><Text style={textStyle}>Import CSV / JSON</Text></Pressable>
      {([['High-pass Hz', high, setHigh], ['Low-pass Hz', low, setLow], ['Window hop seconds', hop, setHop], ['Asymmetry pairs, e.g. F3:F4', pairs, setPairs]] as const).map(([label,value,setter]) => <View key={label}><Text style={textStyle}>{label}</Text><TextInput style={input} value={value} onChangeText={setter} /></View>)}
      <Pressable style={button} onPress={start}><Text style={textStyle}>Start / restart replay</Text></Pressable>
    </>}
    {running && <Pressable style={button} onPress={() => { stop(); setNotice('Stopped. Export the partial report or restart from the beginning.'); }}><Text style={textStyle}>Stop replay</Text></Pressable>}
    <Text style={textStyle}>{name} · processed through sample {progress} / {recording?.samples.length ?? 0}</Text>
    <Text style={textStyle}>Windows: {summary.windows} · median {summary.medianMs?.toFixed(2) ?? '—'} ms · p95 {summary.p95Ms?.toFixed(2) ?? '—'} ms</Text>
    <Text style={textStyle}>Missed deadlines: {summary.missedDeadlines} · maximum queue delay {summary.maxQueueMs?.toFixed(2) ?? '—'} ms · inference: not measured</Text>
    {!running && rows.length > 0 && <View><Pressable style={button} onPress={() => save('json')}><Text style={textStyle}>Export report + features JSON</Text></Pressable><Pressable style={button} onPress={() => save('csv')}><Text style={textStyle}>Export timing CSV</Text></Pressable></View>}
    <Text style={textStyle}>Latest features</Text><Text style={textStyle}>{JSON.stringify(rows.at(-1)?.features ?? {}, null, 2)}</Text>
  </View>;
}
