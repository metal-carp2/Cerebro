import React, { useEffect, useMemo, useRef, useState } from 'react';
import AnalysisScreen from './src/ReplayScreen';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { asLiveModel, BUILTIN_MODELS, LiveModel, runModel } from './src/models';
import { validateModel } from './src/model';
import { exportSession } from './src/export';
import { SAMPLE_RATE, preprocess, syntheticSample } from './src/signal';
import { loadModels, loadSessions, saveModels, saveSessions } from './src/storage';
import { DEFAULT_PIPELINE, processPipeline } from './src/pipeline';
import { PARADIGMS } from './src/paradigms';
import { catalogBoards } from './src/headsets';
import { SourceScope } from './src/InstrumentPlots';
import { Arrow, BigBtn, Btn, Group, Input, Lamp, Panel, Param, Readout, StatusBar, Table, Tabs } from './src/Chrome';
import { C, F, S } from './src/theme';
import { Board, EventMarker, OperatorState, ParadigmId, PipelineConfig, PreprocessConfig, Sample, Session } from './src/types';

type Tab = 'Analysis' | 'Monitor' | 'Operator' | 'Paradigms' | 'Connect' | 'Models' | 'Sessions' | 'Settings';
const tabs = ['Analysis', 'Monitor', 'Operator', 'Paradigms', 'Connect', 'Models', 'Sessions', 'Settings'] as const;
const initialBoards: Board[] = catalogBoards();

export default function App() {
  const [tab, setTab] = useState<Tab>('Analysis');
  const [boards, setBoards] = useState(initialBoards);
  const [connected, setConnected] = useState<Board | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [recorded, setRecorded] = useState<Sample[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<LiveModel[]>(BUILTIN_MODELS);
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
  const [notice, setNotice] = useState('Ready');
  const [adbHost, setAdbHost] = useState('192.168.1.10:5555');
  const [privacy, setPrivacy] = useState(true);
  const [filter, setFilter] = useState<PreprocessConfig>({ notchHz: 60, highpassHz: 1, lowpassHz: 45, demean: true });
  const sampleIndex = useRef(0);
  const startedAt = useRef(Date.now());

  useEffect(() => { Promise.all([loadSessions(), loadModels()]).then(([savedSessions, savedModels]) => { setSessions(savedSessions); setModels([...BUILTIN_MODELS, ...savedModels]); }); }, []);
  useEffect(() => {
    if (!streaming || tab === 'Analysis') return;
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

  const connect = (board: Board) => { setConnected({ ...board, status: 'connected' }); setStreaming(true); startedAt.current = Date.now(); sampleIndex.current = 0; setNotice(`Connected to ${board.name}`); setTab('Monitor'); };
  const stopRecording = async () => {
    const session: Session = { id: new Date().toISOString().replace(/[:.]/g, '-'), startedAt: new Date(recorded[0]?.t ?? Date.now()).toISOString(), durationMs: Math.max(0, (recorded.at(-1)?.t ?? 0) - (recorded[0]?.t ?? 0)), boardName: connected?.name ?? 'Unknown', sampleRate: SAMPLE_RATE, samples: recorded, markers, parameters: { subject, runLabel, notes, paradigmId, filter, pipeline, selectedModel } };
    const next = [session, ...sessions]; setSessions(next); await saveSessions(next); setRecording(false); setRecorded([]); setNotice('Recording saved locally');
  };
  const importModel = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' }); if (picked.canceled) return;
      const text = await (await fetch(picked.assets[0]!.uri)).text(); const model = asLiveModel(validateModel(JSON.parse(text)));
      const imported = [...models.filter((m) => !BUILTIN_MODELS.some((b) => b.id === m.id)), model]; setModels([...BUILTIN_MODELS, ...imported]); await saveModels(imported); setSelectedModel(model.id);
      setNotice(model.kind === 'linear' && model.input === 'features' ? `Imported ${model.name}. It reads named features, so score it on a recording in Analysis.` : `Imported ${model.name}`);
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
  const setConfig = () => { if (!connected) { setNotice('Connect a source before applying configuration'); setTab('Connect'); return; } setOperatorState('configured'); setNotice('Configuration validated and applied'); };
  const startRun = () => { if (!connected) return setTab('Connect'); setTrial(1); setMarkers([{ t: Date.now(), code: 'RunStart', value: runLabel }, { t: Date.now(), code: 'TrialStart', value: 1 }]); setRecorded([]); setRecording(true); setStreaming(true); setOperatorState('running'); setNotice(`${paradigm.name} running`); };
  const suspendRun = () => { setOperatorState('suspended'); setMarkers((old) => [...old, { t: Date.now(), code: 'Suspend' }]); setNotice('Run suspended'); };

  const scopeRows = useMemo(() => pipelineResult.samples.map((s) => s.channels), [pipelineResult]);
  const scopeNames = useMemo(() => pipeline.channels.map((c) => `Ch${c + 1}`), [pipeline.channels]);

  return <SafeAreaView style={x.safe}><ExpoStatusBar style="dark" /><View style={x.shell}>
    <View style={x.titleBar}>
      <Text style={x.brand}>Cerebro</Text>
      <Text style={x.brandSub}>EEG Operator</Text>
      <View style={{ flex: 1 }} />
      <Lamp on={!!connected} />
      <Text style={x.titleMeta}>{connected ? connected.name : 'No source'}</Text>
      <Text style={x.titleSep}>│</Text>
      <Text style={x.titleMeta}>{operatorState.toUpperCase()}</Text>
    </View>
    <Tabs items={tabs} value={tab} onChange={setTab} />
    <ScrollView contentContainerStyle={x.content}>
      {tab === 'Analysis' && <AnalysisScreen />}

      {tab === 'Monitor' && <>
        <Panel title={`Source Signal ${SAMPLE_RATE} Hz`} flush right={<Text style={x.capMeta}>HP: {filter.highpassHz || 'off'} · LP: {filter.lowpassHz || 'off'} · Notch: {filter.notchHz || 'off'}</Text>}>
          <SourceScope samples={scopeRows} channels={scopeNames} rate={SAMPLE_RATE} live={streaming} />
          <StatusBar segments={[
            samples.length ? `${pipelineResult.samples[0]?.channels.length ?? 0} channels` : 'Connect a board to begin',
            samples.length ? `${(pipelineResult.artifactRate * 100).toFixed(1)}% artifacts` : null,
            samples.length ? `control ${pipelineResult.control.toFixed(3)}` : null,
          ]} />
        </Panel>
        <View style={x.cols}>
          <View style={x.col}>
            <Panel title="Transport">
              <View style={x.row}>
                <Btn label={streaming ? 'Pause stream' : 'Start stream'} active={streaming} onPress={() => connected ? setStreaming(!streaming) : setTab('Connect')} />
                {recording
                  ? <Btn label={`Stop & save (${(recorded.length / SAMPLE_RATE).toFixed(1)}s)`} tone="bad" onPress={stopRecording} />
                  : <Btn label="Record session" onPress={() => { if (!connected) return setTab('Connect'); setRecorded([]); setRecording(true); }} />}
              </View>
            </Panel>
          </View>
          <View style={x.col}>
            <Panel title="Classifier output">
              <Readout rows={[
                ['Model', model?.name ?? 'none'],
                ['Output', score.toFixed(4)],
                ['Percent', `${Math.round(score * 100)}%`],
                ['Acquisition', streaming ? 'streaming' : 'idle', streaming ? 'ok' : undefined],
                ['Recording', recording ? `${(recorded.length / SAMPLE_RATE).toFixed(1)} s` : 'stopped', recording ? 'warn' : undefined],
              ]} />
            </Panel>
          </View>
        </View>
      </>}

      {tab === 'Operator' && <>
        <Panel title="Operator controls">
          <Text style={x.hint}>Configure a source, choose a processing pipeline, and record a run.</Text>
          <View style={x.bigRow}>
            <BigBtn label="Config" onPress={() => setTab('Settings')} />
            <Arrow />
            <BigBtn label="Set Config" onPress={setConfig} active={operatorState === 'configured'} />
            <Arrow />
            <BigBtn label={operatorState === 'suspended' ? 'Resume' : 'Start Run'} onPress={startRun} active={operatorState === 'running'} />
            <Arrow />
            <BigBtn label="Suspend" onPress={suspendRun} active={operatorState === 'suspended'} />
          </View>
          <StatusBar segments={[`${operatorState} — ${paradigm.name}`, `trial ${trial}/${paradigm.trials}`, `${(1000 / SAMPLE_RATE).toFixed(1)} ms/sample`]} />
        </Panel>
        <View style={x.cols}>
          <View style={x.col}>
            <Panel title="Module status" flush>
              <Table columns={['Module', 'Detail', 'State']} widths={[1.1, 2, 1]} rows={[
                ['SOURCE', connected?.name ?? 'Disconnected', connected ? 'online' : 'offline'],
                ['PROCESSING', `${pipeline.spatialFilter} → ${model?.name ?? 'none'}`, samples.length ? 'online' : 'idle'],
                ['APPLICATION', paradigm.name, operatorState],
                ['TIMING', `${(1000 / SAMPLE_RATE).toFixed(1)} ms/sample`, pipelineResult.artifactRate < .1 ? 'nominal' : 'warning'],
              ]} />
            </Panel>
          </View>
          <View style={x.col}>
            <Panel title="Run identity">
              <Param label="Subject"><Input value={subject} onChangeText={setSubject} /></Param>
              <Param label="Run"><Input value={runLabel} onChangeText={setRunLabel} /></Param>
              <Param label="Notes"><Input value={notes} onChangeText={setNotes} multiline style={{ minHeight: 64 }} /></Param>
            </Panel>
          </View>
        </View>
        <Panel title="State and event log" flush>
          <Table columns={['Time', 'Code', 'Value']} widths={[1, 1, 1]}
            rows={markers.slice(-10).reverse().map((m) => [new Date(m.t).toLocaleTimeString(), m.code, String(m.value ?? '')])} />
        </Panel>
      </>}

      {tab === 'Paradigms' && <>
        <Panel title="Application modules">
          <Text style={x.hint}>Trial boundaries and stimuli are timestamped into the same session timeline as the EEG samples.</Text>
          {PARADIGMS.map((p) => <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: paradigmId === p.id }} onPress={() => setParadigmId(p.id)} style={[x.pick, paradigmId === p.id && x.pickOn]}>
            <Text style={x.pickMark}>{paradigmId === p.id ? '◉' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={x.pickTitle}>{p.name}</Text>
              <Text style={x.hint}>{p.description}</Text>
              <Text style={x.meta}>{p.trials} trials · {p.trialSeconds}s · {p.output}</Text>
            </View>
          </Pressable>)}
        </Panel>
        {paradigmId === 'cursor' && <Panel title="Cursor feedback preview" flush>
          <View style={x.field}>
            <View style={[x.target, { top: `${Math.max(2, Math.min(84, 43 - pipelineResult.control * 40))}%` as `${number}%` }]} />
            <View style={[x.cursor, { top: `${Math.max(4, Math.min(88, 46 - score * 35))}%` as `${number}%` }]} />
          </View>
          <StatusBar segments={['Model output drives the cursor', `control ${pipelineResult.control.toFixed(3)}`]} />
        </Panel>}
        {paradigmId === 'p300' && <Panel title="P300 speller preview">
          <View style={x.matrix}>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789_'.split('').map((char, i) => <Pressable key={char} onPress={() => setMarkers((old) => [...old, { t: Date.now(), code: 'Target', value: char }])} style={[x.cell, trial % 6 === i % 6 && x.cellFlash]}><Text style={[x.cellText, trial % 6 === i % 6 && x.cellTextFlash]}>{char}</Text></Pressable>)}</View>
        </Panel>}
        {paradigmId === 'stimulus' && <Panel title="Stimulus preview">
          <View style={x.stimulus}><Text style={x.stimulusText}>{trial % 2 ? 'LEFT HAND' : 'RIGHT HAND'}</Text></View>
          <Btn label="Add response marker" onPress={() => setMarkers((old) => [...old, { t: Date.now(), code: 'Response', value: 'tap' }])} />
        </Panel>}
      </>}

      {tab === 'Connect' && <>
        <Panel title="Board discovery">
          <Text style={x.hint}>Connect the BrainFlow synthetic board immediately, or scan for a browser serial device. Per-vendor headsets are not wired up in this build; they need the native BrainFlow bridge.</Text>
          <View style={x.row}><Btn label="Scan devices" onPress={scan} /><Btn label="Refresh" onPress={() => setBoards(initialBoards)} /></View>
        </Panel>
        <Panel title="Sources">
          {boards.map((board) => <View key={board.id} style={x.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={x.pickTitle}>{board.name}</Text>
              <Text style={x.meta}>{board.transport.toUpperCase()} · {board.status}</Text>
            </View>
            <Btn label={connected?.id === board.id ? 'Connected' : 'Connect'} active={connected?.id === board.id} onPress={() => connect(board)} />
          </View>)}
        </Panel>
        <Group title="ADB development bridge">
          <Text style={x.hint}>ADB connects this development computer to an Android device. It does not discover EEG boards.</Text>
          <Param label="Host" hint="run adb connect HOST:PORT on the computer"><Input value={adbHost} onChangeText={setAdbHost} autoCapitalize="none" /></Param>
          <View style={x.row}><Btn label="Copy host setting" onPress={() => setNotice(`Run on host: adb connect ${adbHost}`)} /></View>
        </Group>
      </>}

      {tab === 'Models' && <>
        <Panel title="Signal models">
          <Text style={x.hint}>Score the live stream with a band-power heuristic or an imported channel model. Models that read named features belong in Analysis, where features are extracted. None of these are pretrained EEG classifiers.</Text>
          <View style={x.row}><Btn label="Import model JSON" onPress={importModel} /></View>
        </Panel>
        <Panel title="Library">
          {models.map((m) => <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ checked: selectedModel === m.id }} onPress={() => setSelectedModel(m.id)} style={[x.pick, selectedModel === m.id && x.pickOn]}>
            <Text style={x.pickMark}>{selectedModel === m.id ? '◉' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={x.pickTitle}>{m.name}</Text>
              <Text style={x.hint}>{m.description}</Text>
              <Text style={x.meta}>{m.kind === 'linear' ? `${m.weights.length} weights · ${m.input} input` : 'band-power heuristic'} · {m.windowSize} samples</Text>
            </View>
          </Pressable>)}
        </Panel>
      </>}

      {tab === 'Sessions' && <>
        <Panel title="Recording history">
          <Text style={x.hint}>Sessions stay on this device. Export CSV for analysis tools or JSON for lossless round-tripping.</Text>
        </Panel>
        <Panel title="Stored runs">
          {!sessions.length && <Text style={x.empty}>No sessions yet. Start a recording from Monitor.</Text>}
          {sessions.map((s) => <View key={s.id} style={x.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={x.pickTitle}>{new Date(s.startedAt).toLocaleString()}</Text>
              <Text style={x.meta}>{s.boardName} · {(s.durationMs / 1000).toFixed(1)}s · {s.samples.length} samples</Text>
            </View>
            <View style={x.row}>
              <Btn label="CSV" onPress={() => exportSession(s, 'csv').then((p) => setNotice(`Exported ${p}`))} />
              <Btn label="JSON" onPress={() => exportSession(s, 'json').then((p) => setNotice(`Exported ${p}`))} />
            </View>
          </View>)}
        </Panel>
      </>}

      {tab === 'Settings' && <>
        <Group title="Built-in preprocessing">
          <Param label="High-pass (Hz)" hint="first-order, applied to the acquisition buffer"><Input keyboardType="numeric" value={String(filter.highpassHz)} onChangeText={(v) => setFilter({ ...filter, highpassHz: Number(v) || 0 })} /></Param>
          <Param label="Low-pass (Hz)" hint="first-order, applied after the high-pass"><Input keyboardType="numeric" value={String(filter.lowpassHz)} onChangeText={(v) => setFilter({ ...filter, lowpassHz: Number(v) || 0 })} /></Param>
          <Param label="Mains notch" hint="mains interference rejection">
            <View style={x.row}>{([0, 50, 60] as const).map((n) => <Btn key={n} label={n ? `${n} Hz` : 'Off'} active={filter.notchHz === n} onPress={() => setFilter({ ...filter, notchHz: n })} />)}</View>
          </Param>
        </Group>
        <Group title="Signal processing pipeline">
          <Param label="Channels" hint="channels admitted to the spatial filter">
            <View style={x.row}>{Array.from({ length: 8 }, (_, i) => <Btn key={i} label={`${i + 1}`} active={pipeline.channels.includes(i)} onPress={() => setPipeline({ ...pipeline, channels: pipeline.channels.includes(i) ? pipeline.channels.filter((c) => c !== i) : [...pipeline.channels, i].sort() })} />)}</View>
          </Param>
          <Param label="Spatial filter" hint="common average or nearest-neighbour Laplacian">
            <View style={x.row}>{(['none', 'car', 'laplacian'] as const).map((spatialFilter) => <Btn key={spatialFilter} label={spatialFilter.toUpperCase()} active={pipeline.spatialFilter === spatialFilter} onPress={() => setPipeline({ ...pipeline, spatialFilter })} />)}</View>
          </Param>
          <Param label="Artifact reject (µV)" hint="samples beyond this magnitude are zeroed and counted"><Input keyboardType="numeric" value={String(pipeline.artifactThresholdUv)} onChangeText={(v) => setPipeline({ ...pipeline, artifactThresholdUv: Number(v) || 100 })} /></Param>
          <Param label="Normalizer" hint="squash the control signal to a bounded range">
            <View style={x.row}><Btn label={pipeline.normalize ? 'On' : 'Off'} active={pipeline.normalize} onPress={() => setPipeline({ ...pipeline, normalize: !pipeline.normalize })} /></View>
          </Param>
        </Group>
        <Group title="Parameter files">
          <Text style={x.hint}>Save and restore source, processing, classifier, task, and run settings as a portable JSON configuration.</Text>
          <View style={x.row}><Btn label="Load Parameters …" onPress={importParameters} /><Btn label="Save Parameters …" onPress={exportParameters} /></View>
        </Group>
        <Group title="Privacy">
          <Text style={x.hint}>Recordings and model metadata are stored on this device. Cloud sync is unavailable.</Text>
          <View style={x.row}><Btn label={privacy ? 'Local only ✓' : 'Local only'} active={privacy} onPress={() => { setPrivacy(true); setNotice('Local-only privacy mode enabled'); }} /></View>
        </Group>
      </>}
    </ScrollView>
    {tab !== 'Analysis' && <StatusBar segments={[notice, connected ? connected.name : 'no source', `${SAMPLE_RATE} Hz`, operatorState]} />}
  </View></SafeAreaView>;
}

const x = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.face },
  shell: { flex: 1, backgroundColor: C.face },
  titleBar: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: C.titleBar, borderBottomWidth: 1, borderBottomColor: C.edge },
  brand: { color: C.ink, fontFamily: F.ui, fontSize: S.xl, fontWeight: '700' },
  brandSub: { color: C.inkDim, fontFamily: F.ui, fontSize: S.md },
  titleMeta: { color: C.inkDim, fontFamily: F.ui, fontSize: S.sm },
  titleSep: { color: C.edge, fontSize: S.sm },
  capMeta: { color: C.inkDim, fontFamily: F.mono, fontSize: S.sm },
  content: { padding: 12, gap: 12, maxWidth: 1280, width: '100%', alignSelf: 'center' },

  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  bigRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' },

  hint: { color: C.inkHint, fontFamily: F.ui, fontSize: S.md, lineHeight: 18 },
  meta: { color: C.inkHint, fontFamily: F.mono, fontSize: S.sm, marginTop: 3 },
  empty: { color: C.inkHint, fontFamily: F.ui, fontSize: S.md, padding: 18, textAlign: 'center' },

  pick: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingHorizontal: 9, paddingVertical: 8, borderWidth: 1, borderColor: C.edgeSoft, backgroundColor: C.panel },
  pickOn: { borderColor: C.sel, backgroundColor: C.selFill },
  pickMark: { color: C.sel, fontSize: S.lg, lineHeight: 18 },
  pickTitle: { color: C.ink, fontFamily: F.ui, fontSize: S.lg, fontWeight: '700' },

  listRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 8, borderWidth: 1, borderColor: C.edgeSoft, backgroundColor: C.panel },

  field: { height: 230, backgroundColor: C.scope, borderBottomWidth: 1, borderBottomColor: C.edge },
  target: { position: 'absolute', right: 10, width: 12, height: 40, backgroundColor: C.cursor },
  cursor: { position: 'absolute', left: '48%', width: 20, height: 20, backgroundColor: C.scopeAxis },
  matrix: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: '15%', minWidth: 34, aspectRatio: 1, backgroundColor: C.scope, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.scopeEdge },
  cellFlash: { backgroundColor: C.scopeAxis },
  cellText: { color: C.scopeInk, fontFamily: F.mono, fontSize: 16, fontWeight: '700' },
  cellTextFlash: { color: C.scope },
  stimulus: { height: 210, backgroundColor: C.scope, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.scopeEdge },
  stimulusText: { color: C.cursor, fontFamily: F.mono, fontSize: 26, fontWeight: '700', letterSpacing: 3 },
});
