import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Session } from './types';

/**
 * Write a file the user can actually get at. On web this downloads. On iOS/Android
 * the app's document directory is not reachable from the Files app, so the file is
 * handed straight to the share sheet; it stays on disk either way.
 */
export async function deliver(filename: string, contents: string, mimeType: string): Promise<string> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    return filename;
  }
  const uri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, contents);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename, UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json' });
    return filename;
  }
  return uri;
}

function csv(session: Session): string {
  const rows = ['timestamp_ms,' + Array.from({ length: 8 }, (_, i) => `ch${i + 1}_uv`).join(',')];
  session.samples.forEach((s) => rows.push([s.t, ...s.channels.map((v) => v.toFixed(5))].join(',')));
  return rows.join('\n');
}

export async function exportSession(session: Session, format: 'csv' | 'json'): Promise<string> {
  return deliver(`neuroflow-${session.id}.${format}`, format === 'csv' ? csv(session) : JSON.stringify(session, null, 2), format === 'csv' ? 'text/csv' : 'application/json');
}
