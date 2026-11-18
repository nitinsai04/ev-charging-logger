import { useState } from 'react';
import { buildEntries, guessMapping, MAPPING_LABELS, parseCsv, REQUIRED_FIELDS, type ColumnMapping, type MappingField } from './csv';
import { exportCsvFile, exportJsonFile } from './backup';
import { importEntries } from './db';
import type { LogEntry, Settings } from './types';
import type { SupabaseConfig } from './sync';
import { testConnection } from './sync';

interface Props {
  settings: Settings;
  entries: LogEntry[];
  cloud: SupabaseConfig | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  onSaveSettings: (s: Settings) => Promise<void>;
  onSaveCloud: (cfg: SupabaseConfig | null) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onDataChanged: () => Promise<void>;
  onBackupDone: () => void;
}

const MAPPABLE: MappingField[] = ['kind', 'date', 'odometer', 'units', 'cost', 'startSoc', 'endSoc', 'chargerType', 'notes'];

export default function SettingsView(props: Props) {
  const { settings, entries, cloud, lastSyncedAt, syncing } = props;
  return (
    <>
      <VehicleGroup settings={settings} onSave={props.onSaveSettings} />
      <CloudGroup cloud={cloud} lastSyncedAt={lastSyncedAt} syncing={syncing} onSave={props.onSaveCloud} onSyncNow={props.onSyncNow} />
      <DataGroup settings={settings} entries={entries} onBackupDone={props.onBackupDone} onImported={props.onDataChanged} />
      <p className="settings-foot">EV Ledger · stored on this device and in your own Supabase project. Add to Home Screen for full-screen use.</p>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function VehicleGroup({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
  const [form, setForm] = useState({
    modelName: settings.modelName,
    batteryKwh: String(settings.batteryKwh),
    deliveryBaselineKm: String(settings.deliveryBaselineKm),
    benchmarkCar: settings.benchmarkCar,
    benchmarkMileage: String(settings.benchmarkMileage),
    benchmarkPetrolPrice: String(settings.benchmarkPetrolPrice)
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setMsg(null);
    const nums = {
      batteryKwh: Number(form.batteryKwh),
      deliveryBaselineKm: Number(form.deliveryBaselineKm),
      benchmarkMileage: Number(form.benchmarkMileage),
      benchmarkPetrolPrice: Number(form.benchmarkPetrolPrice)
    };
    if (Object.values(nums).some((n) => !Number.isFinite(n) || n <= 0)) return setErr('All numbers must be positive.');
    await onSave({ modelName: form.modelName.trim(), benchmarkCar: form.benchmarkCar.trim(), ...nums });
    setMsg('Saved. Every figure is recalculated from your raw logs.');
  }

  const row = (label: string, key: keyof typeof form, inputMode: 'text' | 'decimal' = 'decimal') => (
    <div className="settings-row">
      <span className="row-label">{label}</span>
      <input
        inputMode={inputMode}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <>
      <Group title="Vehicle">
        <div className="settings-row">
          <span className="row-label">EV model</span>
          <input type="text" value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} />
        </div>
        {row('Battery capacity (kWh)', 'batteryKwh')}
        {row('Delivery odometer (km)', 'deliveryBaselineKm')}
      </Group>
      <Group title={`Petrol comparison · ${settings.benchmarkCar}`}>
        <div className="settings-row">
          <span className="row-label">Benchmark car</span>
          <input type="text" value={form.benchmarkCar} onChange={(e) => setForm({ ...form, benchmarkCar: e.target.value })} />
        </div>
        {row('Mileage (km/l)', 'benchmarkMileage')}
        {row('Petrol price (₹/l)', 'benchmarkPetrolPrice')}
        <div className="settings-block">
          <button className="btn" onClick={save}>Save changes</button>
          {err && <div className="error">{err}</div>}
          {msg && <div className="ok-text">{msg}</div>}
        </div>
      </Group>
    </>
  );
}

function CloudGroup({
  cloud,
  lastSyncedAt,
  syncing,
  onSave,
  onSyncNow
}: {
  cloud: SupabaseConfig | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  onSave: (cfg: SupabaseConfig | null) => Promise<void>;
  onSyncNow: () => Promise<void>;
}) {
  const [url, setUrl] = useState(cloud?.url ?? '');
  const [key, setKey] = useState(cloud?.anonKey ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    setErr(null);
    setMsg(null);
    const cfg = { url: url.trim().replace(/\/$/, ''), anonKey: key.trim() };
    if (!/^https:\/\/.+\.supabase\.co$/.test(cfg.url) || !cfg.anonKey) {
      return setErr('Paste the Project URL (https://xxxx.supabase.co) and the anon public key.');
    }
    setBusy(true);
    try {
      await testConnection(cfg);
      await onSave(cfg);
      await onSyncNow();
      setMsg('Connected and synced.');
    } catch (e) {
      setErr(`Could not connect: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect cloud sync? Data stays on this device.')) return;
    await onSave(null);
    setUrl('');
    setKey('');
    setMsg('Disconnected. Data stays on this device.');
  }

  if (cloud) {
    return (
      <Group title="Cloud sync">
        <div className="settings-action-row">
          <span className="row-label">
            Connected<br />
            <span className="muted">{cloud.url.replace('https://', '')}</span>
          </span>
          <span className="pill ac">Live</span>
        </div>
        <div className="settings-block">
          <div className="muted" style={{ marginBottom: 12 }}>
            {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString('en-IN')}` : 'Not synced yet'}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => onSyncNow()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn secondary" onClick={disconnect}>Disconnect</button>
          </div>
          {msg && <div className="ok-text">{msg}</div>}
        </div>
      </Group>
    );
  }

  return (
    <Group title="Cloud sync">
      <div className="settings-row">
        <span className="row-label">Project URL</span>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoCapitalize="off" autoCorrect="off" />
      </div>
      <div className="settings-row">
        <span className="row-label">Anon key</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="public key" autoCapitalize="off" autoCorrect="off" />
      </div>
      <div className="settings-block">
        <p className="muted">Use the anon public key only. Never paste the service-role key.</p>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect & sync'}</button>
        </div>
        {err && <div className="error">{err}</div>}
        {msg && <div className="ok-text">{msg}</div>}
      </div>
    </Group>
  );
}

function DataGroup({
  settings,
  entries,
  onBackupDone,
  onImported
}: {
  settings: Settings;
  entries: LogEntry[];
  onBackupDone: () => void;
  onImported: () => Promise<void>;
}) {
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
      onBackupDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <Group title="Backup">
        <div className="settings-action-row" onClick={() => run(() => exportCsvFile(entries, settings))}>
          <span className="row-label">Export as CSV</span>
          <span className="chev">›</span>
        </div>
        <div className="settings-action-row" onClick={() => run(() => exportJsonFile(entries, settings))}>
          <span className="row-label">Export JSON backup</span>
          <span className="chev">›</span>
        </div>
        <div className="settings-block">
          <p className="muted">On iPhone the share sheet lets you save to Files or iCloud Drive.</p>
          {err && <div className="error">{err}</div>}
        </div>
      </Group>
      <ImportGroup entries={entries} onImported={onImported} />
    </>
  );
}

function ImportGroup({ entries, onImported }: { entries: LogEntry[]; onImported: () => Promise<void> }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [oneRupeeFree, setOneRupeeFree] = useState(true);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setErr(null);
    setDone(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error('The file needs a header row and at least one data row.');
      const [hdr, ...body] = parsed;
      setFileName(file.name);
      setHeaders(hdr);
      setRows(body);
      setMapping(guessMapping(hdr));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
  const preview =
    headers.length && missing.length === 0
      ? buildEntries(rows, mapping, entries, { oneRupeeIsFree: oneRupeeFree }, new Date().toISOString())
      : null;

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      await importEntries(preview.entries);
      await onImported();
      setDone(`Imported ${preview.entries.length} entries.`);
      setHeaders([]);
      setRows([]);
      setMapping({});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group title="Import">
      <div className="settings-block">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="csvfile">Choose a CSV file</label>
          <input
            id="csvfile"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          {fileName && <span className="hint">{fileName} · {rows.length} data rows</span>}
        </div>
      </div>

      {headers.length > 0 && (
        <>
          <div className="settings-block">
            <div className="table-wrap">
              <table className="map">
                <tbody>
                  {MAPPABLE.map((field) => (
                    <tr key={field}>
                      <th>
                        {MAPPING_LABELS[field]}
                        {REQUIRED_FIELDS.includes(field) ? ' *' : ''}
                      </th>
                      <td>
                        <select
                          value={mapping[field] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMapping((m) => ({ ...m, [field]: v === '' ? undefined : Number(v) }));
                          }}
                        >
                          <option value="">Not in file</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && (
              <div className="error">Map the required columns: {missing.map((m) => MAPPING_LABELS[m]).join(', ')}.</div>
            )}
          </div>

          <div className="settings-row">
            <span className="row-label">Treat ₹1 sessions as free</span>
            <input type="checkbox" checked={oneRupeeFree} onChange={(e) => setOneRupeeFree(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--mint)' }} />
          </div>

          <div className="settings-block">
            {preview && (
              <div className="preview">
                <div>
                  <b>{preview.entries.length}</b> new entries will be imported
                </div>
                <div>{preview.duplicates} duplicates skipped</div>
                {preview.freeConverted > 0 && <div>{preview.freeConverted} ₹1 sessions stored as free (₹0)</div>}
                {preview.rejects.length > 0 && (
                  <div style={{ color: 'var(--amber)' }}>
                    {preview.rejects.length} rows rejected. First: line {preview.rejects[0].line}, {preview.rejects[0].reason}
                  </div>
                )}
              </div>
            )}
            <button className="btn" onClick={commit} disabled={!preview || preview.entries.length === 0 || busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </>
      )}

      {(err || done) && (
        <div className="settings-block">
          {err && <div className="error">{err}</div>}
          {done && <div className="ok-text">{done}</div>}
        </div>
      )}
    </Group>
  );
}
