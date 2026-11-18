import { useCallback, useEffect, useRef, useState } from 'react';
import Dashboard from './Dashboard';
import LogSheet from './LogSheet';
import SettingsView from './SettingsView';
import { ChargesList, MaintenanceList } from './Lists';
import { fmtNum } from './calc';
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
import { DEFAULT_SETTINGS, type EntryKind, type LogEntry, type Settings } from './types';

type Tab = 'dashboard' | 'charges' | 'maintenance' | 'settings';
type ChipState = 'off' | 'ok' | 'pending' | 'syncing' | 'offline' | 'err';
type Theme = 'dark' | 'light';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◆' },
  { id: 'charges', label: 'Charges', icon: '⚡' },
  { id: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') === 'light' ? 'light' : 'dark'));
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cloud, setCloud] = useState<SupabaseConfig | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [backup, setBackup] = useState({ show: false, reason: '' });
  const [sheet, setSheet] = useState<{ entry: LogEntry | null; kind: EntryKind } | null>(null);
  const [chip, setChip] = useState<{ state: ChipState; text: string }>({ state: 'off', text: 'On device' });
  const [syncing, setSyncing] = useState(false);
  const syncTimer = useRef<number | undefined>(undefined);
  const syncingRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6f4' : '#0b0e11');
  }, [theme]);

  const refresh = useCallback(async () => {
    const live = (await listEntries()).filter((e) => !e.deleted);
    setEntries(live);
    setSettings((await getSettings()).values);
    setCloud((await getKv<SupabaseConfig>('supabase')) ?? null);
    setLastSyncedAt((await getKv<string>('lastSyncedAt')) ?? null);
    setBackup(await backupState(live.length));
    return live;
  }, []);

  const updateChip = useCallback(async (cfg: SupabaseConfig | null) => {
    if (!cfg) return setChip({ state: 'off', text: 'On device' });
    if (!navigator.onLine) return setChip({ state: 'offline', text: 'Offline' });
    const pending = (await db.entries.where('dirty').equals(1).count()) + (await getSettings()).dirty;
    setChip(pending > 0 ? { state: 'pending', text: `${pending} pending` } : { state: 'ok', text: 'Synced' });
  }, []);

  const runSync = useCallback(async (): Promise<void> => {
    const cfg = await getKv<SupabaseConfig>('supabase');
    if (!cfg || syncingRef.current) return;
    if (!navigator.onLine) return updateChip(cfg);
    syncingRef.current = true;
    setSyncing(true);
    setChip({ state: 'syncing', text: 'Syncing' });
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
    await updateChip((await getKv<SupabaseConfig>('supabase')) ?? null);
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

  const fabKind: EntryKind = tab === 'maintenance' ? 'maintenance' : 'charge';
  const showFab = tab === 'dashboard' || tab === 'charges' || tab === 'maintenance';
  const title = tab === 'dashboard' ? settings.modelName : TABS.find((t) => t.id === tab)?.label ?? '';
  const subtitle = `${fmtNum(entries.length ? Math.max(...entries.map((e) => e.odometerKm)) : settings.deliveryBaselineKm, 0)} km on the odometer`;

  return (
    <div className="app">
      <header className="topbar">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          <div className="sub">{tab === 'dashboard' ? subtitle : settings.benchmarkCar}</div>
        </div>
        <div className="topbar-actions">
          <span className={`sync-chip ${chip.state === 'ok' ? 'ok' : chip.state === 'err' ? 'err' : chip.state === 'pending' || chip.state === 'syncing' ? 'pending' : ''}`}>
            {chip.text}
          </span>
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="content">
        <section className={`screen ${tab === 'dashboard' ? 'active' : ''}`}>
          <Dashboard
            entries={entries}
            settings={settings}
            backup={backup}
            onBackup={async () => {
              await exportJsonFile(entries, settings);
              await refresh();
            }}
          />
        </section>

        <section className={`screen ${tab === 'charges' ? 'active' : ''}`}>
          <ChargesList
            entries={entries}
            settings={settings}
            onEdit={(entry) => setSheet({ entry, kind: entry.kind })}
            onAdd={() => setSheet({ entry: null, kind: 'charge' })}
          />
        </section>

        <section className={`screen ${tab === 'maintenance' ? 'active' : ''}`}>
          <MaintenanceList
            entries={entries}
            onEdit={(entry) => setSheet({ entry, kind: entry.kind })}
            onAdd={() => setSheet({ entry: null, kind: 'maintenance' })}
          />
        </section>

        <section className={`screen ${tab === 'settings' ? 'active' : ''}`}>
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
            onBackupDone={() => {
              refresh();
            }}
          />
        </section>
      </main>

      {showFab && (
        <button className="fab" onClick={() => setSheet({ entry: null, kind: fabKind })}>
          + {fabKind === 'charge' ? 'Log charge' : 'Log service'}
        </button>
      )}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="ti">{t.icon}</span>
            <span className="tl">{t.label}</span>
          </button>
        ))}
      </nav>

      {sheet && (
        <LogSheet
          initial={sheet.entry}
          defaultKind={sheet.kind}
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
