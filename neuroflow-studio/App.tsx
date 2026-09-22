import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReplayScreen from './src/ReplayScreen';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import Svg, { Line, Polyline } from 'react-native-svg';
import { BUILTIN_MODELS, runModel, validateModel } from './src/models';
import { exportSession } from './src/export';
import { SAMPLE_RATE, preprocess, syntheticSample } from './src/signal';
import { loadModels, loadSessions, saveModels, saveSessions } from './src/storage';
import { DEFAULT_PIPELINE, processPipeline } from './src/pipeline';
import { PARADIGMS } from './src/paradigms';
import { checkCompanion, CompanionStatus, ComputeMode, inferRemote, RemotePrediction } from './src/compute';
import { catalogBoards, nativeBrainFlowAvailable } from './src/headsets';
import { Board, EventMarker, ModelDefinition, OperatorState, ParadigmId, PipelineConfig, PreprocessConfig, Sample, Session } from './src/types';

type Tab = 'Replay' | 'Monitor' | 'Operator' | 'Paradigms' | 'Connect' | 'Compute' | 'Models' | 'Sessions' | 'Settings';
const tabs: Tab[] = ['Replay', 'Monitor', 'Operator', 'Paradigms', 'Connect', 'Compute', 'Models', 'Sessions', 'Settings'];
const initialBoards: Board[] = catalogBoards();

const Button = ({ label, onPress, active, danger }: { label: string; onPress: () => void; active?: boolean; danger?: boolean }) => (
  <Pressable onPress={onPress} style={[styles.button, active && styles.buttonActive, danger && styles.buttonDanger]}><Text style={styles.buttonText}>{label}</Text></Pressable>
);
const Card = ({ title, children }: React.PropsWithChildren<{ title: string }>) => <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;

function SignalChart({ samples, width }: { samples: Sample[]; width: number }) {
  const height = 300;
  const visible = samples.slice(-220);
  return <View style={styles.chart}><Svg width={width} height={height}>
    {Array.from({ length: 8 }, (_, c) => <React.Fragment key={c}>
      <Line x1="0" x2={width} y1={20 + c * 36} y2={20 + c * 36} stroke="#203148" strokeWidth="1" />
      <Polyline fill="none" stroke={['#42e8c6','#7e9cff','#f8bd5a','#ee6f8e','#b58cff','#62d6ff','#8de06c','#ff9b70'][c]} strokeWidth="1.4"
        points={visible.map((s, i) => `${(i / Math.max(1, visible.length - 1)) * width},${20 + c * 36 - Math.max(-15, Math.min(15, (s.channels[c] ?? 0) * 0.3))}`).join(' ')} />
    </React.Fragment>)}
  </Svg></View>;
}

export default function App() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('Replay');
  const [boards, setBoards] = useState(initialBoards);
  const [connected, setConnected] = useState<Board | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [recorded, setRecorded] = useState<Sample[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>(BUILTIN_MODELS);
  const [selectedModel, setSelectedModel] = useState('focus');
  const [score, setScore] = useState(0);
  const [operatorState, setOperatorState] = useState<OperatorState>('idle');
  const [pipeline, setPipeline] = useState<PipelineConfig>(DEFAULT_PIPELINE);
  const [paradigmId, setParadigmId] = useState<ParadigmId>('cursor');
  const [trial, setTrial] = useState(0);
  const [markers, setMarkers] = useState<EventMarker[]>([]);
  const [subject, setSubject] = useState('P001');
  const [runLabel, setRunLabel] = useState('001');
  const [notes, setNotes] = useState('');
  const [computeMode, setComputeMode] = useState<ComputeMode>('automatic');
  const [companionEndpoint, setCompanionEndpoint] = useState('http://192.168.1.10:8765');
  const [companion, setCompanion] = useState<CompanionStatus | null>(null);
  const [remotePrediction, setRemotePrediction] = useState<RemotePrediction | null>(null);
  const remoteBusy = useRef(false);
  const lastRemoteAt = useRef(0);
  const [notice, setNotice] = useState('Ready');
  const [adbHost, setAdbHost] = useState('192.168.1.10:5555');
  const [privacy, setPrivacy] = useState(true);
  const [filter, setFilter] = useState<PreprocessConfig>({ notchHz: 60, highpassHz: 1, lowpassHz: 45, demean: true });
  const sampleIndex = useRef(0);
  const startedAt = useRef(Date.now());

  useEffect(() => { Promise.all([loadSessions(), loadModels()]).then(([savedSessions, savedModels]) => { setSessions(savedSessions); setModels([...BUILTIN_MODELS, ...savedModels]); }); }, []);
  useEffect(() => {
    if (!streaming || tab === 'Replay') return;
    const timer = setInterval(() => {
      const batch = Array.from({ length: 5 }, () => syntheticSample(sampleIndex.current++, startedAt.current));
      setSamples((old) => preprocess([...old, ...batch].slice(-500), filter));
      if (recording) setRecorded((old) => [...old, ...batch]);
    }, 40);
    return () => clearInterval(timer);
  }, [streaming, recording, filter, tab]);
  useEffect(() => {
    const model = models.find((m) => m.id === selectedModel);
    if (model && samples.length) setScore(runModel(model, processPipeline(samples, pipeline).samples));
  }, [samples, models, selectedModel, pipeline]);
  useEffect(() => {
    const remoteModel = models.find((candidate) => candidate.id === selectedModel);
    if (!companion || computeMode === 'phone' || !remoteModel || samples.length < 8 || remoteBusy.current || Date.now() - lastRemoteAt.current < 500) return;
    remoteBusy.current = true; lastRemoteAt.current = Date.now();
    inferRemote(companionEndpoint, remoteModel, processPipeline(samples, pipeline).samples, SAMPLE_RATE)
      .then((prediction) => { setRemotePrediction(prediction); setScore(prediction.score); })
      .catch(() => { setCompanion(null); setRemotePrediction(null); if (computeMode === 'computer') setNotice('Computer lost; recording continues and phone inference resumed'); })
      .finally(() => { remoteBusy.current = false; });
  }, [samples, companion, computeMode, models, selectedModel, companionEndpoint, pipeline]);
  useEffect(() => {
    if (operatorState !== 'running') return;
    const paradigm = PARADIGMS.find((p) => p.id === paradigmId)!;
    const timer = setInterval(() => {
      setTrial((current) => {
        const next = current + 1;
        setMarkers((old) => [...old, { t: Date.now(), code: 'TrialStart', value: next }]);
        if (next > paradigm.trials) { setOperatorState('complete'); setRecording(false); return current; }
        return next;
      });
    }, paradigm.trialSeconds * 1000);
    return () => clearInterval(timer);
  }, [operatorState, paradigmId]);

  const connect = (board: Board) => { if (board.id !== 'synthetic' && board.id !== 'webserial' && !nativeBrainFlowAvailable()) { setNotice(`${board.name} needs the native BrainFlow Android build`); return; } setConnected({ ...board, status: 'connected' }); setStreaming(true); startedAt.current = Date.now(); sampleIndex.current = 0; setNotice(`Connected to ${board.name}`); setTab('Monitor'); };
  const stopRecording = async () => {
    const session: Session = { id: new Date().toISOString().replace(/[:.]/g, '-'), startedAt: new Date(recorded[0]?.t ?? Date.now()).toISOString(), durationMs: Math.max(0, (recorded.at(-1)?.t ?? 0) - (recorded[0]?.t ?? 0)), boardName: connected?.name ?? 'Unknown', sampleRate: SAMPLE_RATE, samples: recorded, markers, parameters: { subject, runLabel, notes, paradigmId, filter, pipeline, selectedModel } };
    const next = [session, ...sessions]; setSessions(next); await saveSessions(next); setRecording(false); setRecorded([]); setNotice('Recording saved locally');
  };
  const importModel = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' }); if (picked.canceled) return;
      const text = await (await fetch(picked.assets[0]!.uri)).text(); const model = validateModel(JSON.parse(text));
      const imported = [...models.filter((m) => !BUILTIN_MODELS.some((b) => b.id === m.id)), model]; setModels([...BUILTIN_MODELS, ...imported]); await saveModels(imported); setSelectedModel(model.id); setNotice(`Imported ${model.name}`);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not import model'); }
  };
  const exportParameters = () => {
    const config = JSON.stringify({ version: 1, subject, runLabel, paradigmId, filter, pipeline, selectedModel }, null, 2);
    if (Platform.OS === 'web') { const url = URL.createObjectURL(new Blob([config], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'neuroflow-parameters.json'; a.click(); URL.revokeObjectURL(url); setNotice('Parameter file exported'); }
    else setNotice('Parameter export is available with session JSON on Android');
  };
  const importParameters = async () => {
    try { const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' }); if (picked.canceled) return; const value = JSON.parse(await (await fetch(picked.assets[0]!.uri)).text()); if (value.filter) setFilter(value.filter); if (value.pipeline) setPipeline(value.pipeline); if (value.paradigmId) setParadigmId(value.paradigmId); if (value.selectedModel) setSelectedModel(value.selectedModel); if (value.subject) setSubject(value.subject); if (value.runLabel) setRunLabel(value.runLabel); setOperatorState('configured'); setNotice('Parameter file loaded'); } catch { setNotice('Invalid parameter file'); }
  };
  const scan = async () => {
    setNotice('Scanning…');
    if (Platform.OS === 'web' && 'serial' in navigator) {
      try { const port = await (navigator as Navigator & { serial: { requestPort(): Promise<unknown> } }).serial.requestPort(); if (port) setBoards((old) => [...old.filter((b) => b.id !== 'webserial'), { id: 'webserial', name: 'Web Serial EEG device', transport: 'serial', status: 'available' }]); setNotice('Serial device selected'); }
      catch { setNotice('Scan cancelled. Synthetic board remains available.'); }
    } else setNotice('Native Bluetooth/USB discovery requires the BrainFlow native bridge build.');
  };
  const model = useMemo(() => models.find((m) => m.id === selectedModel), [models, selectedModel]);
  const pipelineResult = useMemo(() => processPipeline(samples, pipeline), [samples, pipeline]);
  const paradigm = useMemo(() => PARADIGMS.find((p) => p.id === paradigmId)!, [paradigmId]);
  const connectCompanion = async () => { try { setNotice('Looking for computer…'); const status = await checkCompanion(companionEndpoint); setCompanion(status); setNotice(`Paired with ${status.name}`); } catch (error) { setCompanion(null); setNotice(error instanceof Error ? error.message : 'Computer unavailable'); } };
  const setConfig = () => { if (!connected) { setNotice('Connect a source before applying configuration'); setTab('Connect'); return; } setOperatorState('configured'); setNotice('Configuration validated and applied'); };
  const startRun = () => { if (!connected) return setTab('Connect'); setTrial(1); setMarkers([{ t: Date.now(), code: 'RunStart', value: runLabel }, { t: Date.now(), code: 'TrialStart', value: 1 }]); setRecorded([]); setRecording(true); setStreaming(true); setOperatorState('running'); setNotice(`${paradigm.name} running`); };
  const suspendRun = () => { setOperatorState('suspended'); setMarkers((old) => [...old, { t: Date.now(), code: 'Suspend' }]); setNotice('Run suspended'); };

  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><View style={styles.shell}>
    <View style={styles.header}><View><Text style={styles.brand}>NEUROFLOW</Text><Text style={styles.subtitle}>EEG workbench · local first</Text></View><View style={[styles.dot, connected && styles.dotOnline]} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>{tabs.map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.navItem, tab === item && styles.navActive]}><Text style={[styles.navText, tab === item && styles.navTextActive]}>{item}</Text></Pressable>)}</ScrollView>
    <ScrollView contentContainerStyle={styles.content}>
      {tab === 'Replay' && <ReplayScreen />}
      {tab === 'Monitor' && <>
        <View style={styles.hero}><View><Text style={styles.eyebrow}>{connected ? connected.name : 'NO BOARD CONNECTED'}</Text><Text style={styles.big}>{streaming ? 'LIVE' : 'IDLE'}</Text></View><View><Text style={styles.score}>{Math.round(score * 100)}</Text><Text style={styles.scoreLabel}>{model?.name ?? 'Model score'}</Text></View></View>
        <Card title="Live EEG · processing output"><SignalChart samples={pipelineResult.samples} width={Math.max(280, Math.min(980, width - 60))} /><Text style={styles.meta}>{samples.length ? `${SAMPLE_RATE} Hz · ${pipelineResult.samples[0]?.channels.length ?? 0} channels · ${(pipelineResult.artifactRate * 100).toFixed(1)}% artifacts · control ${pipelineResult.control.toFixed(2)}` : 'Connect a board to begin.'}</Text></Card>
        <View style={styles.row}><Button label={streaming ? 'Pause stream' : 'Start stream'} onPress={() => connected ? setStreaming(!streaming) : setTab('Connect')} active={streaming} />{recording ? <Button label={`Stop & save (${(recorded.length / SAMPLE_RATE).toFixed(1)}s)`} onPress={stopRecording} danger /> : <Button label="Record session" onPress={() => { if (!connected) return setTab('Connect'); setRecorded([]); setRecording(true); }} />}</View>
      </>}
      {tab === 'Operator' && <>
        <View style={styles.hero}><View><Text style={styles.eyebrow}>SYSTEM STATE</Text><Text style={styles.big}>{operatorState.toUpperCase()}</Text></View><View><Text style={styles.score}>{trial}/{paradigm.trials}</Text><Text style={styles.scoreLabel}>trials</Text></View></View>
        <Card title="Operator controls"><Text style={styles.body}>Configure and run the acquisition → processing → application loop. Controls follow a BCI2000-style state machine.</Text><View style={styles.row}><Button label="Set config" onPress={setConfig} active={operatorState === 'configured'} /><Button label={operatorState === 'suspended' ? 'Resume' : 'Start run'} onPress={startRun} active={operatorState === 'running'} /><Button label="Suspend" onPress={suspendRun} danger={operatorState === 'running'} /></View></Card>
        <Card title="Run identity"><Text style={styles.label}>Subject</Text><TextInput value={subject} onChangeText={setSubject} style={styles.input} /><Text style={styles.label}>Run</Text><TextInput value={runLabel} onChangeText={setRunLabel} style={styles.input} /><Text style={styles.label}>Operator notes</Text><TextInput value={notes} onChangeText={setNotes} multiline style={[styles.input, { minHeight: 74 }]} /></Card>
        <View style={styles.moduleGrid}>{[
          ['SOURCE', connected?.name ?? 'Disconnected', connected ? 'online' : 'offline'],
          ['PROCESSING', `${pipeline.spatialFilter} → ${model?.name ?? 'none'}`, samples.length ? 'online' : 'idle'],
          ['APPLICATION', paradigm.name, operatorState],
          ['TIMING', `${(1000 / SAMPLE_RATE).toFixed(1)} ms/sample`, pipelineResult.artifactRate < .1 ? 'nominal' : 'warning'],
        ].map(([name, detail, status]) => <View key={name} style={styles.module}><Text style={styles.eyebrow}>{name}</Text><Text style={styles.itemTitle}>{detail}</Text><Text style={styles.meta}>{status}</Text></View>)}</View>
        <Card title="State and event log">{markers.slice(-8).reverse().map((marker, index) => <Text key={`${marker.t}-${index}`} style={styles.logLine}>{new Date(marker.t).toLocaleTimeString()}  {marker.code}  {String(marker.value ?? '')}</Text>)}{!markers.length && <Text style={styles.meta}>No state transitions yet.</Text>}</Card>
      </>}
      {tab === 'Paradigms' && <>
        <Card title="Application modules"><Text style={styles.body}>Choose a task or feedback paradigm. Trial boundaries and stimuli are timestamped into the same session timeline as EEG samples.</Text></Card>
        {PARADIGMS.map((p) => <Pressable key={p.id} onPress={() => setParadigmId(p.id)} style={[styles.listItem, paradigmId === p.id && styles.selected]}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>{p.name}</Text><Text style={styles.body}>{p.description}</Text><Text style={styles.meta}>{p.trials} trials · {p.trialSeconds}s · {p.output}</Text></View><Text style={styles.chevron}>{paradigmId === p.id ? '●' : '○'}</Text></Pressable>)}
        {paradigmId === 'cursor' && <Card title="Cursor feedback preview"><View style={styles.cursorField}><View style={[styles.target, { top: `${Math.max(2, Math.min(84, 43 - pipelineResult.control * 40))}%` as `${number}%` }]} /><View style={[styles.cursor, { top: `${Math.max(4, Math.min(88, 46 - score * 35))}%` as `${number}%` }]} /></View><Text style={styles.meta}>Live model score controls the cursor; target position changes by trial in a production protocol.</Text></Card>}
        {paradigmId === 'p300' && <Card title="P300 speller preview"><View style={styles.matrix}>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789_'.split('').map((char, i) => <Pressable key={char} onPress={() => setMarkers((old) => [...old, { t: Date.now(), code: 'Target', value: char }])} style={[styles.cell, trial % 6 === i % 6 && styles.cellFlash]}><Text style={styles.cellText}>{char}</Text></Pressable>)}</View></Card>}
        {paradigmId === 'stimulus' && <Card title="Stimulus preview"><View style={styles.stimulus}><Text style={styles.stimulusText}>{trial % 2 ? 'LEFT HAND' : 'RIGHT HAND'}</Text></View><Button label="Add response marker" onPress={() => setMarkers((old) => [...old, { t: Date.now(), code: 'Response', value: 'tap' }])} /></Card>}
      </>}
      {tab === 'Connect' && <>
        <Card title="Board discovery"><Text style={styles.body}>Use the synthetic board immediately, or scan for a browser serial device. Production Bluetooth/USB boards use a small native BrainFlow bridge.</Text><View style={styles.row}><Button label="Scan devices" onPress={scan} /><Button label="Refresh" onPress={() => setBoards(initialBoards)} /></View></Card>
        {boards.map((board) => <View key={board.id} style={styles.listItem}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>{board.name}</Text><Text style={styles.meta}>{board.transport.toUpperCase()} · {board.id === 'synthetic' || nativeBrainFlowAvailable() ? board.status : 'native adapter required'}</Text></View><Button label={connected?.id === board.id ? 'Connected' : 'Connect'} active={connected?.id === board.id} onPress={() => connect(board)} /></View>)}
        <Card title="ADB development bridge"><Text style={styles.body}>ADB connects this development computer to an Android device. Run <Text style={styles.code}>adb connect HOST:PORT</Text> on the computer, then install/open the Android build. It does not discover EEG boards.</Text><TextInput value={adbHost} onChangeText={setAdbHost} style={styles.input} placeholderTextColor="#718198" /><Button label="Copy host setting" onPress={() => setNotice(`Run on host: adb connect ${adbHost}`)} /></Card>
      </>}
      {tab === 'Compute' && <>
        <View style={styles.hero}><View><Text style={styles.eyebrow}>INFERENCE ROUTER</Text><Text style={styles.big}>{companion && computeMode !== 'phone' ? 'COMPUTER' : 'PHONE'}</Text></View><View><Text style={styles.score}>{remotePrediction ? `${remotePrediction.latencyMs}` : '—'}</Text><Text style={styles.scoreLabel}>remote latency ms</Text></View></View>
        <Card title="Compute policy"><Text style={styles.body}>Phone mode never sends EEG to another device. Automatic uses the paired computer when reachable and falls back locally. Computer preferred attempts remote inference while acquisition and recording remain on the phone.</Text><View style={styles.row}>{(['phone', 'automatic', 'computer'] as const).map((mode) => <Button key={mode} label={mode === 'phone' ? 'Phone only' : mode === 'automatic' ? 'Automatic' : 'Computer preferred'} active={computeMode === mode} onPress={() => setComputeMode(mode)} />)}</View></Card>
        <Card title="Pair a computer"><Text style={styles.label}>Companion address</Text><TextInput value={companionEndpoint} onChangeText={setCompanionEndpoint} autoCapitalize="none" keyboardType="url" style={styles.input} /><View style={styles.row}><Button label={companion ? 'Reconnect' : 'Connect'} active={!!companion} onPress={connectCompanion} />{companion && <Button label="Disconnect" onPress={() => { setCompanion(null); setRemotePrediction(null); setNotice('Computer disconnected'); }} />}</View></Card>
        <Card title="Connection status">{companion ? <><Text style={styles.itemTitle}>{companion.name} · v{companion.version}</Text><Text style={styles.meta}>Backends: {companion.backends.join(', ')}</Text><Text style={styles.meta}>Models: {companion.models.join(', ')}</Text><Text style={styles.meta}>Latest: {remotePrediction ? `${remotePrediction.label} ${(remotePrediction.score * 100).toFixed(1)}% via ${remotePrediction.backend}` : 'waiting for EEG window'}</Text></> : <Text style={styles.body}>No computer paired. The app is processing locally and can continue recording if a companion disconnects.</Text>}</Card>
        <Card title="Privacy boundary"><Text style={styles.body}>The companion service is local-network only and stores nothing. Phone-only mode prevents transmission. Before production use, pairing should add mutual authentication and transport encryption.</Text></Card>
      </>}
      {tab === 'Models' && <>
        <Card title="Foundational model library"><Text style={styles.body}>Choose a built-in signal heuristic or import a portable linear model JSON. Scores update against the live preprocessed window.</Text><Button label="Import model JSON" onPress={importModel} /></Card>
        {models.map((m) => <Pressable key={m.id} onPress={() => setSelectedModel(m.id)} style={[styles.listItem, selectedModel === m.id && styles.selected]}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>{m.name}</Text><Text style={styles.body}>{m.description}</Text><Text style={styles.meta}>{m.kind} · {m.inputChannels} channels · {m.windowSize} samples</Text></View><Text style={styles.chevron}>{selectedModel === m.id ? '●' : '○'}</Text></Pressable>)}
      </>}
      {tab === 'Sessions' && <>
        <Card title="Recording history"><Text style={styles.body}>Sessions stay on this device. Export CSV for analysis tools or JSON for lossless round-tripping.</Text></Card>
        {!sessions.length && <Text style={styles.empty}>No sessions yet. Start a recording from Monitor.</Text>}
        {sessions.map((s) => <View key={s.id} style={styles.listItem}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>{new Date(s.startedAt).toLocaleString()}</Text><Text style={styles.meta}>{s.boardName} · {(s.durationMs / 1000).toFixed(1)}s · {s.samples.length} samples</Text></View><View style={styles.row}><Button label="CSV" onPress={() => exportSession(s, 'csv').then((p) => setNotice(`Exported ${p}`))} /><Button label="JSON" onPress={() => exportSession(s, 'json').then((p) => setNotice(`Exported ${p}`))} /></View></View>)}
      </>}
      {tab === 'Settings' && <>
        <Card title="Built-in preprocessing"><Text style={styles.label}>High-pass Hz</Text><TextInput keyboardType="numeric" value={String(filter.highpassHz)} onChangeText={(v) => setFilter({ ...filter, highpassHz: Number(v) || 0 })} style={styles.input} /><Text style={styles.label}>Low-pass Hz</Text><TextInput keyboardType="numeric" value={String(filter.lowpassHz)} onChangeText={(v) => setFilter({ ...filter, lowpassHz: Number(v) || 0 })} style={styles.input} /><Text style={styles.label}>Mains notch</Text><View style={styles.row}>{([0, 50, 60] as const).map((n) => <Button key={n} label={n ? `${n} Hz` : 'Off'} active={filter.notchHz === n} onPress={() => setFilter({ ...filter, notchHz: n })} />)}</View></Card>
        <Card title="Signal processing pipeline"><Text style={styles.label}>Channels</Text><View style={styles.row}>{Array.from({ length: 8 }, (_, i) => <Button key={i} label={`Ch ${i + 1}`} active={pipeline.channels.includes(i)} onPress={() => setPipeline({ ...pipeline, channels: pipeline.channels.includes(i) ? pipeline.channels.filter((c) => c !== i) : [...pipeline.channels, i].sort() })} />)}</View><Text style={styles.label}>Spatial filter</Text><View style={styles.row}>{(['none', 'car', 'laplacian'] as const).map((spatialFilter) => <Button key={spatialFilter} label={spatialFilter.toUpperCase()} active={pipeline.spatialFilter === spatialFilter} onPress={() => setPipeline({ ...pipeline, spatialFilter })} />)}</View><Text style={styles.label}>Artifact rejection threshold (µV)</Text><TextInput keyboardType="numeric" value={String(pipeline.artifactThresholdUv)} onChangeText={(v) => setPipeline({ ...pipeline, artifactThresholdUv: Number(v) || 100 })} style={styles.input} /><Button label={pipeline.normalize ? 'Normalizer on ✓' : 'Normalizer off'} active={pipeline.normalize} onPress={() => setPipeline({ ...pipeline, normalize: !pipeline.normalize })} /></Card>
        <Card title="Parameter files"><Text style={styles.body}>Save and restore source, processing, classifier, task, and run settings as a portable JSON configuration.</Text><View style={styles.row}><Button label="Load parameters" onPress={importParameters} /><Button label="Save parameters" onPress={exportParameters} /></View></Card>
        <Card title="Privacy"><Text style={styles.body}>Local-first mode stores sessions and imported model metadata only in this app’s storage. Firebase sync is intentionally off until you add a project and consent flow.</Text><Button label={privacy ? 'Local only ✓' : 'Cloud sync'} active={privacy} onPress={() => { setPrivacy(true); setNotice('Local-only privacy mode enabled'); }} /></Card>
      </>}
    </ScrollView>
    <View style={styles.toast}><Text style={styles.toastText}>{notice}</Text></View>
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#071019' }, shell: { flex: 1, backgroundColor: '#071019' }, header: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: '#e8fff9', fontWeight: '900', fontSize: 23, letterSpacing: 3 }, subtitle: { color: '#718198', fontSize: 12, marginTop: 2 }, dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#435064' }, dotOnline: { backgroundColor: '#42e8c6', shadowColor: '#42e8c6', shadowOpacity: 1, shadowRadius: 8 }, nav: { maxHeight: 45, borderBottomWidth: 1, borderBottomColor: '#172538' }, navContent: { paddingHorizontal: 16 }, navItem: { paddingHorizontal: 10, paddingVertical: 12 }, navActive: { borderBottomColor: '#42e8c6', borderBottomWidth: 2 }, navText: { color: '#718198', fontSize: 12, fontWeight: '700' }, navTextActive: { color: '#dffcf5' }, content: { padding: 18, gap: 14, paddingBottom: 80, maxWidth: 1040, width: '100%', alignSelf: 'center' }, hero: { backgroundColor: '#0d1926', borderRadius: 16, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#42e8c6', fontSize: 11, letterSpacing: 1.5, fontWeight: '800' }, big: { color: '#f2f7fa', fontSize: 38, fontWeight: '200', letterSpacing: 3 }, score: { color: '#f2f7fa', fontSize: 42, textAlign: 'right', fontWeight: '800' }, scoreLabel: { color: '#718198', fontSize: 11 }, card: { backgroundColor: '#0d1926', borderColor: '#172b40', borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 }, cardTitle: { color: '#eef8fa', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }, chart: { backgroundColor: '#09131e', borderRadius: 8, overflow: 'hidden' }, meta: { color: '#718198', fontSize: 11, marginTop: 5 }, body: { color: '#aebdca', fontSize: 13, lineHeight: 20 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, button: { backgroundColor: '#16263a', borderColor: '#29415b', borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8 }, buttonActive: { backgroundColor: '#116052', borderColor: '#42e8c6' }, buttonDanger: { backgroundColor: '#742f43', borderColor: '#ee6f8e' }, buttonText: { color: '#eef8fa', fontSize: 12, fontWeight: '700' }, listItem: { backgroundColor: '#0d1926', borderColor: '#172b40', borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }, selected: { borderColor: '#42e8c6', backgroundColor: '#10251f' }, itemTitle: { color: '#eef8fa', fontSize: 14, fontWeight: '800' }, chevron: { color: '#42e8c6', fontSize: 18 }, input: { backgroundColor: '#08131e', borderColor: '#29415b', borderWidth: 1, color: '#eef8fa', padding: 10, borderRadius: 8 }, label: { color: '#8fa1b3', fontSize: 12, fontWeight: '700' }, code: { color: '#42e8c6', fontFamily: Platform.select({ web: 'monospace', default: 'monospace' }) }, empty: { color: '#718198', textAlign: 'center', padding: 30 }, toast: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: '#172538', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }, toastText: { color: '#c8d6e1', fontSize: 11 }, moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, module: { flexGrow: 1, flexBasis: 200, backgroundColor: '#0d1926', borderWidth: 1, borderColor: '#172b40', borderRadius: 12, padding: 14, gap: 5 }, logLine: { color: '#91a6b7', fontSize: 11, fontFamily: Platform.select({ web: 'monospace', default: 'monospace' }) }, cursorField: { height: 220, backgroundColor: '#08131e', borderRadius: 10, overflow: 'hidden' }, target: { position: 'absolute', right: 8, width: 12, height: 35, backgroundColor: '#f8bd5a', borderRadius: 4 }, cursor: { position: 'absolute', left: '48%', width: 22, height: 22, borderRadius: 11, backgroundColor: '#42e8c6' }, matrix: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, cell: { width: '14.5%', minWidth: 38, aspectRatio: 1, backgroundColor: '#14243a', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }, cellFlash: { backgroundColor: '#eef8fa' }, cellText: { color: '#42e8c6', fontSize: 17, fontWeight: '900' }, stimulus: { height: 220, borderRadius: 10, backgroundColor: '#eef8fa', justifyContent: 'center', alignItems: 'center' }, stimulusText: { color: '#071019', fontSize: 28, fontWeight: '900', letterSpacing: 3 },
});
