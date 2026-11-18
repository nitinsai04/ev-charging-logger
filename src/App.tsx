import { useCallback, useEffect, useRef, useState } from 'react';
import Dashboard from './Dashboard';
import LogSheet from './LogSheet';
import SettingsView from './SettingsView';
import { backupState, exportJsonFile } from './backup';
import {
  db,
  deleteEntry,
  getKv,
  getSettings,
  listEntries,
  requestPersistentStorage,
  saveEntry,
  saveSettings,
  setKv
} from './db';
import { syncNow, type SupabaseConfig } from './sync';
import { DEFAULT_SETTINGS, type LogEntry, type Settings } from './types';

type Tab = 'dashboard' | 'settings';
type ChipState = 'off' | 'ok' | 'pending' | 'syncing' | 'offline' | 'err';

interface ChipInfo {
  state: ChipState;
  text: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cloud, setCloud] = useState<SupabaseConfig | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [backup, setBackup] = useState({ show: false, reason: '' });
  const [sheet, setSheet] = useState<{ entry: LogEntry | null } | null>(null);
  const [chip, setChip] = useState<ChipInfo>({ state: 'off', text: 'Local only' });
  const [syncing, setSyncing] = useState(false);
  const syncTimer = useRef<number | undefined>(undefined);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const all = await listEntries();
    const live = all.filter((e) => !e.deleted);
    setEntries(live);
    setSettings((await getSettings()).values);
    setCloud((await getKv<SupabaseConfig>('supabase')) ?? null);
    setLastSyncedAt((await getKv<string>('lastSyncedAt')) ?? null);
    setBackup(await backupState(live.length));
    return live;
  }, []);

  const updateChip = useCallback(async (cfg: SupabaseConfig | null) => {
    if (!cfg) return setChip({ state: 'off', text: 'Local only' });
    if (!navigator.onLine) return setChip({ state: 'offline', text: 'Offline · changes saved' });
    const pending = await db.entries.where('dirty').equals(1).count();
    const settingsDirty = (await getSettings()).dirty;
    const n = pending + settingsDirty;
    setChip(n > 0 ? { state: 'pending', text: `Pending (${n})` } : { state: 'ok', text: 'Synced' });
  }, []);

  const runSync = useCallback(async (): Promise<void> => {
    const cfg = await getKv<SupabaseConfig>('supabase');
    if (!cfg || syncingRef.current) return;
    if (!navigator.onLine) return updateChip(cfg);
    syncingRef.current = true;
    setSyncing(true);
    setChip({ state: 'syncing', text: 'Syncing…' });
    try {
      await syncNow(cfg);
      await refresh();
      await updateChip(cfg);
    } catch (e) {
      setChip({ state: 'err', text: 'Sync failed' });
      console.error(e);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refresh, updateChip]);

  const scheduleSync = useCallback(() => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      runSync();
    }, 1500);
  }, [runSync]);

  // Startup: load data, ask iOS to keep storage, and sync if connected.
  useEffect(() => {
    (async () => {
      await requestPersistentStorage();
      await refresh();
      const cfg = await getKv<SupabaseConfig>('supabase');
      await updateChip(cfg ?? null);
      if (cfg) runSync();
    })();
    const onOnline = () => runSync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') runSync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, runSync, updateChip]);

  async function handleSave(entry: LogEntry) {
    await saveEntry(entry);
    setSheet(null);
    await refresh();
    await updateChip(await getKv<SupabaseConfig>('supabase') ?? null);
    scheduleSync();
  }

  async function handleDelete(id: string) {
    await deleteEntry(id);
    setSheet(null);
    await refresh();
    scheduleSync();
  }

  async function handleSaveSettings(s: Settings) {
    await saveSettings(s);
    await refresh();
    scheduleSync();
  }

  async function handleSaveCloud(cfg: SupabaseConfig | null) {
    await setKv('supabase', cfg);
    await refresh();
    await updateChip(cfg);
  }

  async function handleBackupNow() {
    await exportJsonFile(entries, settings);
    await refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{tab === 'dashboard' ? 'EV Charging' : 'Settings'}</h1>
          <div className="muted" style={{ fontSize: 12 }}>{settings.modelName}</div>
        </div>
        <span className={`sync-chip ${chip.state === 'ok' ? 'ok' : chip.state === 'err' ? 'err' : ''}`}>
          {chip.text}
        </span>
      </header>

      {tab === 'dashboard' ? (
        <Dashboard
          entries={entries}
          settings={settings}
          backup={backup}
          onEdit={(entry) => setSheet({ entry })}
          onBackup={handleBackupNow}
        />
      ) : (
        <SettingsView
          settings={settings}
          entries={entries}
          cloud={cloud}
          lastSyncedAt={lastSyncedAt}
          syncing={syncing}
          onSaveSettings={handleSaveSettings}
          onSaveCloud={handleSaveCloud}
          onSyncNow={runSync}
          onDataChanged={async () => {
            await refresh();
            scheduleSync();
          }}
          onBackupDone={() => refresh()}
        />
      )}

      {tab === 'dashboard' && (
        <button className="fab" onClick={() => setSheet({ entry: null })}>+ Log charge</button>
      )}

      <nav className="tabbar">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </nav>

      {sheet && (
        <LogSheet
          initial={sheet.entry}
          entries={entries}
          settings={settings}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
