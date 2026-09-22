import { Platform } from 'react-native';

/**
 * Desktop instrument chrome, in the lineage of BCI2000's operator and parameter
 * windows: square corners, hairline borders, gray window face, dense readouts,
 * and black scopes with cyan annotation and a yellow sample cursor. No shadows,
 * no rounded cards, no decorative gradients.
 */
export const C = {
  // Window chrome
  face: '#f0f0f0',
  faceDark: '#e4e4e4',
  panel: '#ffffff',
  panelAlt: '#f7f7f7',
  titleBar: '#e8e8e8',

  // Lines
  edge: '#9a9a9a',
  edgeSoft: '#c9c9c9',
  grid: '#e3e3e3',

  // Type
  ink: '#101010',
  inkDim: '#4a4a4a',
  inkHint: '#6d6d6d',

  // Controls
  btn: '#fdfdfd',
  btnEdge: '#adadad',
  btnDown: '#cce4f7',
  sel: '#0078d4',
  selFill: '#cce4f7',

  // Semantics
  ok: '#107c41',
  warn: '#b45309',
  bad: '#b02a2a',

  // Scope
  scope: '#000000',
  scopeEdge: '#2a3b44',
  scopeGrid: '#16222a',
  scopeAxis: '#33bcd4',
  scopeInk: '#7fd4e4',
  cursor: '#ffe000',
} as const;

/** Channel traces: instrument phosphor, not a brand palette. */
export const TRACES = ['#e8e8e8', '#b9a7d6', '#7fd4e4', '#e0c274', '#d59a9a', '#9ad5a8', '#c8c8c8', '#8fa9d6'] as const;

export const F = {
  ui: Platform.select({ web: '"Segoe UI", Tahoma, Geneva, Verdana, system-ui, sans-serif', default: 'System' })!,
  mono: Platform.select({ web: 'Consolas, "Cascadia Mono", "Courier New", monospace', default: 'Courier' })!,
} as const;

export const S = { xs: 10, sm: 11, md: 12, lg: 13, xl: 15, readout: 26 } as const;
