import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { Timing } from './replay';
import { C, F, S, TRACES } from './theme';

/** Decimate to at most `limit` points so long windows stay cheap to draw. */
function thin<T>(rows: T[], limit: number): Array<[T, number]> {
  const stride = Math.max(1, Math.floor(rows.length / limit));
  const out: Array<[T, number]> = [];
  for (let i = 0; i < rows.length; i += stride) out.push([rows[i]!, i]);
  return out;
}

/**
 * Stacked multi-channel source scope with a sweep cursor at the write head,
 * after the operator's live source-signal window.
 */
export function SourceScope({ samples, channels, rate, live }: { samples: number[][]; channels: string[]; rate: number; live?: boolean }) {
  const visible = channels.slice(0, 8);
  // Keep the graticule at full height before a recording is open, so the panel
  // does not collapse to a strip.
  const lanes = visible.length || 8;
  const lane = 40, top = 14, left = 46, right = 14, w = 880;
  const h = top + lanes * lane + 30;
  const pw = w - left - right;
  const seconds = samples.length / Math.max(1, rate);
  return <View accessibilityLabel="Live source signal" style={{ backgroundColor: C.scope, width: '100%', aspectRatio: w / h }}>
    <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
      {Array.from({ length: 9 }, (_, i) => <Line key={i} x1={left + i * pw / 8} x2={left + i * pw / 8} y1={top - 6} y2={top + lanes * lane} stroke={C.scopeGrid} />)}
      {visible.map((name, c) => {
        const mid = top + c * lane + lane / 2;
        let peak = 1;
        for (const row of samples) peak = Math.max(peak, Math.abs(row[c] ?? 0));
        return <React.Fragment key={name}>
          <SvgText x={6} y={mid + 4} fontSize={11} fill={C.scopeAxis}>{name.length > 5 ? name.slice(0, 5) : name}</SvgText>
          <Line x1={left} x2={w - right} y1={mid} y2={mid} stroke={C.scopeGrid} />
          <Polyline fill="none" stroke={TRACES[c % TRACES.length]} strokeWidth={1}
            points={thin(samples, 700).map(([row, i]) => `${left + i / Math.max(1, samples.length - 1) * pw},${mid - (row[c] ?? 0) / peak * (lane / 2 - 3)}`).join(' ')} />
        </React.Fragment>;
      })}
      <Line x1={left} x2={w - right} y1={top + lanes * lane} y2={top + lanes * lane} stroke={C.scopeAxis} />
      {Array.from({ length: 9 }, (_, i) => <SvgText key={i} x={left + i * pw / 8} y={top + lanes * lane + 16} textAnchor="middle" fontSize={10} fill={C.scopeInk}>
        {(seconds * i / 8).toFixed(1)}s
      </SvgText>)}
      {!!samples.length && live && <Line x1={w - right} x2={w - right} y1={top - 6} y2={top + lanes * lane} stroke={C.cursor} strokeWidth={2} />}
      {!samples.length && <SvgText x={left + pw / 2} y={top + lanes * lane / 2} textAnchor="middle" fontSize={14} fill={C.scopeInk}>No source samples</SvgText>}
      <SvgText x={w - right} y={h - 4} textAnchor="end" fontSize={10} fill={C.scopeInk}>per-channel autoscale</SvgText>
    </Svg>
    {channels.length > 8 && <Text style={{ color: C.inkHint, fontFamily: F.ui, fontSize: S.sm, padding: 4 }}>Scope shows the first 8 channels.</Text>}
  </View>;
}

/** Model output across the replayed run, with the decision threshold drawn in. */
export function PredictionScope({ rows, threshold, output }: { rows: Timing[]; threshold: number; output: 'probability' | 'score' }) {
  const w = 880, h = 250, left = 52, top = 16, pw = 812, ph = 198;
  const scored = rows.filter(r => r.prediction !== null);
  const values = scored.map(r => r.prediction!);
  const lo = output === 'probability' ? 0 : Math.min(threshold, ...values, 0);
  const hi = output === 'probability' ? 1 : Math.max(threshold, ...values, lo + 1e-9);
  const span = hi - lo || 1;
  const y = (value: number) => top + ph - (value - lo) / span * ph;
  const step = pw / Math.max(1, scored.length - 1);
  return <View accessibilityLabel="Model output per window" style={{ backgroundColor: C.scope, width: '100%', aspectRatio: w / h }}>
    <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
      <Rect x={left} y={top} width={pw} height={ph} fill={C.scope} stroke={C.scopeEdge} />
      {[0, 1, 2, 3, 4].map(i => <React.Fragment key={i}>
        <Line x1={left} x2={left + pw} y1={top + i * ph / 4} y2={top + i * ph / 4} stroke={C.scopeGrid} />
        <SvgText x={left - 8} y={top + i * ph / 4 + 4} textAnchor="end" fontSize={11} fill={C.scopeInk}>{(hi - span * i / 4).toFixed(2)}</SvgText>
      </React.Fragment>)}
      <Line x1={left} x2={left + pw} y1={y(threshold)} y2={y(threshold)} stroke={C.cursor} strokeWidth={1.25} strokeDasharray="6 4" />
      <SvgText x={left + pw - 4} y={y(threshold) - 6} textAnchor="end" fontSize={11} fill={C.cursor}>threshold {threshold}</SvgText>
      {scored.length > 1 && <Polyline fill="none" stroke={TRACES[0]} strokeWidth={1.4} points={scored.map((r, i) => `${left + i * step},${y(r.prediction!)}`).join(' ')} />}
      {scored.length === 1 && <Line x1={left} x2={left + pw} y1={y(values[0]!)} y2={y(values[0]!)} stroke={TRACES[0]} strokeWidth={1.4} />}
      <SvgText x={12} y={14} fontSize={11} fill={C.scopeAxis}>{output === 'probability' ? 'p' : 'score'}</SvgText>
      <SvgText x={left + pw / 2} y={h - 4} textAnchor="middle" fontSize={11} fill={C.scopeAxis}>Window ({scored.length} scored)</SvgText>
      {!scored.length && <SvgText x={left + pw / 2} y={top + ph / 2} textAnchor="middle" fontSize={14} fill={C.scopeInk}>Load a model and start a run to see its output</SvgText>}
    </Svg>
  </View>;
}

/** Compute and queue latency per window, in the manner of the operator timing window. */
export function TimingScope({ rows }: { rows: Timing[] }) {
  const w = 880, h = 150, left = 48, top = 12, pw = 818, ph = 104;
  const data = rows.slice(-90), max = Math.max(1, ...data.map(r => r.totalMs + r.queueMs)) * 1.15;
  return <View style={{ backgroundColor: C.scope, width: '100%', aspectRatio: w / h }}><Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
    {[0, 1, 2, 3].map(i => <React.Fragment key={i}>
      <Line x1={left} x2={left + pw} y1={top + i * ph / 3} y2={top + i * ph / 3} stroke={C.scopeGrid} />
      <SvgText x={left - 5} y={top + i * ph / 3 + 4} textAnchor="end" fill={C.scopeInk} fontSize={10}>{(max * (1 - i / 3)).toFixed(1)}</SvgText>
    </React.Fragment>)}
    {(['totalMs', 'queueMs'] as const).map((key, i) => <Polyline key={key} fill="none" stroke={i ? C.cursor : C.scopeAxis} strokeWidth={1.4}
      points={data.map((r, j) => `${left + j / Math.max(1, data.length - 1) * pw},${top + ph - r[key] / max * ph}`).join(' ')} />)}
    {!data.length && <SvgText x={left + pw / 2} y={top + ph / 2} textAnchor="middle" fill={C.scopeInk} fontSize={12}>Timing appears after the first window</SvgText>}
    <SvgText x={10} y={12} fill={C.scopeAxis} fontSize={10}>ms</SvgText>
    <SvgText x={left + pw / 2} y={h - 3} textAnchor="middle" fill={C.scopeInk} fontSize={10}>Last {data.length} windows — cyan: compute, yellow: queue</SvgText>
  </Svg></View>;
}
