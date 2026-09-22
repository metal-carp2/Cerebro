import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, F, S } from './theme';

/** A titled instrument panel: hairline box with a gray caption strip. */
export function Panel({ title, right, children, flush }: React.PropsWithChildren<{ title: string; right?: React.ReactNode; flush?: boolean }>) {
  return <View style={k.panel}>
    <View style={k.caption}><Text style={k.captionText}>{title}</Text>{right}</View>
    <View style={flush ? undefined : k.panelBody}>{children}</View>
  </View>;
}

/** Parameter group, after the collapsible sections of the configuration dialog. */
export function Group({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <View style={k.group}>
    <View style={k.groupHead}><Text style={k.tri}>▼</Text><Text style={k.groupTitle}>{title}</Text></View>
    <View style={k.groupBody}>{children}</View>
  </View>;
}

/** Bold parameter name, italic description above the control. */
export function Param({ label, hint, children }: React.PropsWithChildren<{ label: string; hint?: string }>) {
  return <View style={k.param}>
    {!!hint && <Text style={k.hint}>{hint}</Text>}
    <View style={k.paramRow}><Text style={k.paramLabel}>{label}</Text><View style={{ flex: 1, minWidth: 0 }}>{children}</View></View>
  </View>;
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={C.inkHint} {...props} style={[k.input, props.style]} />;
}

export function Btn({ label, onPress, active, disabled, wide, tone }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean; wide?: boolean; tone?: 'default' | 'bad' }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [k.btn, wide && k.btnWide, active && k.btnActive, pressed && k.btnDown, disabled && k.btnOff]}>
    <Text style={[k.btnText, tone === 'bad' && { color: C.bad }, disabled && { color: C.inkHint }]}>{label}</Text>
  </Pressable>;
}

/** Oversized lifecycle control, as in the operator window's Config → Set Config → Suspend row. */
export function BigBtn({ label, onPress, active, disabled }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [k.big, active && k.bigActive, pressed && k.btnDown, disabled && k.btnOff]}>
    <Text style={[k.bigText, disabled && { color: C.inkHint }]}>{label}</Text>
  </Pressable>;
}

export const Arrow = () => <Text style={k.arrow}>➝</Text>;

export function Tabs<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (v: T) => void }) {
  return <View style={k.tabs}>{items.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: value === item }} onPress={() => onChange(item)} style={[k.tab, value === item && k.tabOn]}>
    <Text style={[k.tabText, value === item && k.tabTextOn]}>{item}</Text>
  </Pressable>)}</View>;
}

/** Dense label/value readout: the shape used by the timing and watch windows. */
export function Readout({ rows, mono = true }: { rows: Array<[string, string | number, ('ok' | 'warn' | 'bad')?]>; mono?: boolean }) {
  return <View style={k.readout}>{rows.map(([label, value, tone], i) => <View key={label} style={[k.rrow, i % 2 === 1 && { backgroundColor: C.panelAlt }]}>
    <Text style={k.rlabel}>{label}</Text>
    <Text style={[k.rvalue, mono && { fontFamily: F.mono }, tone === 'ok' && { color: C.ok }, tone === 'warn' && { color: C.warn }, tone === 'bad' && { color: C.bad }]}>{value}</Text>
  </View>)}</View>;
}

export function Table({ columns, rows, widths }: { columns: string[]; rows: Array<Array<string | number>>; widths?: number[] }) {
  const flex = (i: number) => ({ flex: widths?.[i] ?? 1 });
  return <View style={k.table}>
    <View style={k.thead}>{columns.map((c, i) => <Text key={c} style={[k.th, flex(i), i === columns.length - 1 && k.cellRight]}>{c}</Text>)}</View>
    {rows.map((row, r) => <View key={r} style={[k.trow, r % 2 === 1 && { backgroundColor: C.panelAlt }]}>
      {row.map((cell, i) => <Text key={i} selectable numberOfLines={1} style={[k.td, flex(i), i === row.length - 1 && k.cellRight]}>{cell}</Text>)}
    </View>)}
    {!rows.length && <Text style={k.empty}>No rows</Text>}
  </View>;
}

/** Square status lamp. */
export const Lamp = ({ on, tone = 'ok' }: { on: boolean; tone?: 'ok' | 'warn' }) =>
  <View style={[k.lamp, on && { backgroundColor: tone === 'ok' ? C.ok : C.warn, borderColor: tone === 'ok' ? C.ok : C.warn }]} />;

/** Window-foot status strip with pipe-separated segments. */
export function StatusBar({ segments }: { segments: Array<string | null | undefined> }) {
  const shown = segments.filter(Boolean) as string[];
  return <View style={k.status}>{shown.map((segment, i) => <React.Fragment key={i}>
    {i > 0 && <Text style={k.statusSep}>│</Text>}
    <Text style={[k.statusText, i === 0 && { flex: 1 }]} numberOfLines={1}>{segment}</Text>
  </React.Fragment>)}</View>;
}

const k = StyleSheet.create({
  panel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.edge },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.titleBar, borderBottomWidth: 1, borderBottomColor: C.edge, paddingHorizontal: 8, paddingVertical: 5 },
  captionText: { flex: 1, color: C.ink, fontFamily: F.ui, fontSize: S.md, fontWeight: '600' },
  panelBody: { padding: 10, gap: 8 },

  group: { borderWidth: 1, borderColor: C.edgeSoft, backgroundColor: C.panel },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: C.face, borderBottomWidth: 1, borderBottomColor: C.edgeSoft },
  tri: { color: C.inkDim, fontSize: S.xs },
  groupTitle: { color: C.ink, fontFamily: F.ui, fontSize: S.md, fontWeight: '700' },
  groupBody: { padding: 10, gap: 10 },

  param: { gap: 3 },
  hint: { color: C.inkHint, fontFamily: F.ui, fontSize: S.sm, fontStyle: 'italic' },
  paramRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paramLabel: { width: 132, color: C.ink, fontFamily: F.ui, fontSize: S.md, fontWeight: '700' },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.btnEdge, color: C.ink, fontFamily: F.ui, fontSize: S.lg, paddingHorizontal: 7, paddingVertical: 6, minHeight: 28, borderRadius: 0 },

  btn: { backgroundColor: C.btn, borderWidth: 1, borderColor: C.btnEdge, paddingHorizontal: 11, paddingVertical: 6, minHeight: 28, justifyContent: 'center', borderRadius: 0 },
  btnWide: { flex: 1 },
  btnActive: { backgroundColor: C.selFill, borderColor: C.sel },
  btnDown: { backgroundColor: C.btnDown, borderColor: C.sel },
  btnOff: { backgroundColor: C.faceDark, borderColor: C.edgeSoft },
  btnText: { color: C.ink, fontFamily: F.ui, fontSize: S.md, textAlign: 'center' },

  big: { flexGrow: 1, flexBasis: 110, backgroundColor: C.face, borderWidth: 1, borderColor: C.edge, paddingHorizontal: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
  bigActive: { backgroundColor: C.selFill, borderColor: C.sel },
  bigText: { color: C.ink, fontFamily: F.ui, fontSize: S.xl },
  arrow: { color: C.inkDim, fontSize: S.xl, alignSelf: 'center' },

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 1, borderBottomWidth: 1, borderBottomColor: C.edge, paddingHorizontal: 6, paddingTop: 5 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.faceDark, borderWidth: 1, borderBottomWidth: 0, borderColor: C.edgeSoft, marginBottom: -1 },
  tabOn: { backgroundColor: C.panel, borderColor: C.edge },
  tabText: { color: C.inkDim, fontFamily: F.ui, fontSize: S.md },
  tabTextOn: { color: C.ink, fontWeight: '700' },

  readout: { borderWidth: 1, borderColor: C.edgeSoft },
  rrow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 4 },
  rlabel: { flex: 1, color: C.inkDim, fontFamily: F.ui, fontSize: S.md },
  rvalue: { color: C.ink, fontSize: S.md, textAlign: 'right' },

  table: { borderWidth: 1, borderColor: C.edgeSoft },
  thead: { flexDirection: 'row', backgroundColor: C.face, borderBottomWidth: 1, borderBottomColor: C.edge },
  th: { color: C.ink, fontFamily: F.ui, fontSize: S.sm, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 5 },
  trow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.grid },
  td: { color: C.ink, fontFamily: F.mono, fontSize: S.sm, paddingHorizontal: 7, paddingVertical: 4 },
  cellRight: { textAlign: 'right' },
  empty: { color: C.inkHint, fontFamily: F.ui, fontSize: S.md, padding: 14, textAlign: 'center' },

  lamp: { width: 9, height: 9, borderWidth: 1, borderColor: C.edge, backgroundColor: C.faceDark },

  status: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.face, borderTopWidth: 1, borderTopColor: C.edge, paddingHorizontal: 9, paddingVertical: 5 },
  statusSep: { color: C.edge, fontSize: S.sm },
  statusText: { color: C.inkDim, fontFamily: F.ui, fontSize: S.sm },
});
