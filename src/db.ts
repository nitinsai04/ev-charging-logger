import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type LogEntry, type Settings } from './types';

/** A log entry plus a sync flag: dirty = 1 means it still needs pushing to Supabase. */
export interface StoredEntry extends LogEntry {
  dirty: number;
}

interface KvRecord {
  key: string;
  value: unknown;
}

export interface StoredSettings {
  key: 'settings';
  values: Settings;
  updatedAt: string;
  dirty: number;
}

class LoggerDb extends Dexie {
  entries!: Table<StoredEntry, string>;
  kv!: Table<KvRecord, string>;

  constructor() {
    super('ev-charging-logger');
    this.version(1).stores({
      entries: 'id, dirty, updatedAt, odometerKm',
      kv: 'key'
    });
  }
}

export const db = new LoggerDb();

export async function getKv<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function getSettings(): Promise<{ values: Settings; updatedAt: string; dirty: number }> {
  const row = await getKv<{ values: Settings; updatedAt: string; dirty: number }>('settings');
  return row ?? { values: DEFAULT_SETTINGS, updatedAt: new Date(0).toISOString(), dirty: 0 };
}

export async function saveSettings(values: Settings): Promise<void> {
  await setKv('settings', { values, updatedAt: new Date().toISOString(), dirty: 1 });
}

export async function listEntries(): Promise<StoredEntry[]> {
  return db.entries.toArray();
}

export async function saveEntry(entry: LogEntry): Promise<void> {
  await db.entries.put({ ...entry, updatedAt: new Date().toISOString(), dirty: 1 });
}

/** Soft delete: the row stays so the deletion can sync to the other phone. */
export async function deleteEntry(id: string): Promise<void> {
  const existing = await db.entries.get(id);
  if (!existing) return;
  await db.entries.put({ ...existing, deleted: true, updatedAt: new Date().toISOString(), dirty: 1 });
}

export async function importEntries(entries: LogEntry[]): Promise<void> {
  await db.entries.bulkPut(entries.map((e) => ({ ...e, dirty: 1 })));
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}
