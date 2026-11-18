import { exportCsv } from './csv';
import { getKv, setKv } from './db';
import type { LogEntry, Settings } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupState {
  show: boolean;
  reason: string;
}

/** Shows the backup reminder after 30 days, or after 10 new entries since the last export. */
export async function backupState(liveCount: number, now = Date.now()): Promise<BackupState> {
  const lastExportAt = await getKv<string>('lastExportAt');
  const countAtExport = (await getKv<number>('countAtExport')) ?? 0;
  if (!lastExportAt) {
    return liveCount > 0
      ? { show: true, reason: 'You have not exported a backup yet.' }
      : { show: false, reason: '' };
  }
  const days = (now - Date.parse(lastExportAt)) / DAY_MS;
  const newEntries = liveCount - countAtExport;
  if (days >= 30) return { show: true, reason: `Last backup was ${Math.floor(days)} days ago.` };
  if (newEntries >= 10) return { show: true, reason: `${newEntries} entries since your last backup.` };
  return { show: false, reason: '' };
}

async function markExported(liveCount: number): Promise<void> {
  await setKv('lastExportAt', new Date().toISOString());
  await setKv('countAtExport', liveCount);
}

/** Saves a file. On iOS this opens the share sheet so it can go to Files or iCloud Drive. */
export async function saveFile(name: string, content: string, type: string): Promise<void> {
  const file = new File([content], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCsvFile(entries: LogEntry[], settings: Settings): Promise<void> {
  const live = entries.filter((e) => !e.deleted);
  const stamp = new Date().toISOString().slice(0, 10);
  await saveFile(`ev-charging-${stamp}.csv`, exportCsv(live, settings), 'text/csv');
  await markExported(live.length);
}

export async function exportJsonFile(entries: LogEntry[], settings: Settings): Promise<void> {
  const live = entries.filter((e) => !e.deleted);
  const stamp = new Date().toISOString().slice(0, 10);
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), settings, entries }, null, 2);
  await saveFile(`ev-charging-backup-${stamp}.json`, payload, 'application/json');
  await markExported(live.length);
}
