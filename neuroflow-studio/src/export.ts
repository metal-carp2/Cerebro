import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Session } from './types';

function csv(session: Session): string {
  const rows = ['timestamp_ms,' + Array.from({ length: 8 }, (_, i) => `ch${i + 1}_uv`).join(',')];
  session.samples.forEach((s) => rows.push([s.t, ...s.channels.map((v) => v.toFixed(5))].join(',')));
  return rows.join('\n');
}

export async function exportSession(session: Session, format: 'csv' | 'json'): Promise<string> {
  const contents = format === 'csv' ? csv(session) : JSON.stringify(session, null, 2);
  const filename = `neuroflow-${session.id}.${format}`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([contents], { type: format === 'csv' ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    return filename;
  }
  const uri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, contents);
  return uri;
}
