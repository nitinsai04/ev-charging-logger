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
  onSaveSettings: (s: Settings) => Promise<void>;
  onSaveCloud: (cfg: SupabaseConfig | null) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onDataChanged: () => Promise<void>;
  onBackupDone: () => void;
  syncing: boolean;
}

const MAPPABLE: MappingField[] = ['kind', 'date', 'odometer', 'units', 'cost', 'startSoc', 'endSoc', 'chargerType', 'notes'];

export default function SettingsView(props: Props) {
  const { settings, entries, cloud, lastSyncedAt, syncing } = props;
  return (
    <div className="content">
      <VehicleForm settings={settings} onSave={props.onSaveSettings} />
      <CloudCard cloud={cloud} lastSyncedAt={lastSyncedAt} syncing={syncing} onSave={props.onSaveCloud} onSyncNow={props.onSyncNow} />
      <BackupCard entries={entries} settings={settings} onBackupDone={props.onBackupDone} />
      <ImportCard entries={entries} onImported={props.onDataChanged} />
    </div>
  );
}

function VehicleForm({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
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
    if (Object.values(nums).some((n) => !Number.isFinite(n) || n <= 0)) {
      return setErr('All numbers must be positive.');
    }
    await onSave({ modelName: form.modelName.trim(), benchmarkCar: form.benchmarkCar.trim(), ...nums });
    setMsg('Saved. Dashboard recalculated from your raw logs.');
  }

  return (
    <div className="card">
      <h2>Vehicle & benchmark</h2>
      <div className="field">
        <label>EV model</label>
        <input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Usable battery (kWh)</label>
          <input inputMode="decimal" value={form.batteryKwh} onChange={(e) => setForm({ ...form, batteryKwh: e.target.value })} />
        </div>
        <div className="field">
          <label>Delivery odometer (km)</label>
          <input inputMode="decimal" value={form.deliveryBaselineKm} onChange={(e) => setForm({ ...form, deliveryBaselineKm: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Benchmark car</label>
        <input value={form.benchmarkCar} onChange={(e) => setForm({ ...form, benchmarkCar: e.target.value })} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Benchmark mileage (km/l)</label>
          <input inputMode="decimal" value={form.benchmarkMileage} onChange={(e) => setForm({ ...form, benchmarkMileage: e.target.value })} />
        </div>
        <div className="field">
          <label>Petrol price (₹/l)</label>
          <input inputMode="decimal" value={form.benchmarkPetrolPrice} onChange={(e) => setForm({ ...form, benchmarkPetrolPrice: e.target.value })} />
        </div>
      </div>
      <span className="muted">Changes apply to all history. Trip distances and efficiencies are recalculated from the raw logs each time.</span>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-text">{msg}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn" onClick={save}>Save settings</button>
      </div>
    </div>
  );
}

function CloudCard({
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
    if (!window.confirm('Disconnect cloud sync? Data stays on this phone.')) return;
    await onSave(null);
    setUrl('');
    setKey('');
    setMsg('Disconnected. Data stays on this phone.');
  }

  return (
    <div className="card">
      <h2>Cloud sync (your Supabase)</h2>
      {cloud ? (
        <>
          <div className="muted" style={{ marginBottom: 10 }}>
            Connected to {cloud.url.replace('https://', '')}.{' '}
            {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString('en-IN')}.` : 'Not synced yet.'}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => onSyncNow()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn secondary" onClick={disconnect}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Project URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxx.supabase.co" autoCapitalize="off" autoCorrect="off" />
          </div>
          <div className="field">
            <label>Anon public key</label>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ… or sb_publishable_…" autoCapitalize="off" autoCorrect="off" />
            <span className="hint">Use the anon/publishable key only. Never paste the service-role key.</span>
          </div>
          <button className="btn" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect & sync'}</button>
        </>
      )}
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-text">{msg}</div>}
    </div>
  );
}

function BackupCard({ entries, settings, onBackupDone }: { entries: LogEntry[]; settings: Settings; onBackupDone: () => void }) {
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
    <div className="card">
      <h2>Backup</h2>
      <div className="btn-row">
        <button className="btn" onClick={() => run(() => exportCsvFile(entries, settings))}>Export CSV</button>
        <button className="btn secondary" onClick={() => run(() => exportJsonFile(entries, settings))}>Export JSON</button>
      </div>
      <p className="muted">On iPhone, the share sheet lets you save to Files or iCloud Drive. The CSV includes calculated columns.</p>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function ImportCard({ entries, onImported }: { entries: LogEntry[]; onImported: () => Promise<void> }) {
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
  const preview = headers.length && missing.length === 0
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
    <div className="card">
      <h2>Import CSV</h2>
      <div className="field">
        <label htmlFor="csvfile">Choose a CSV file</label>
        <input id="csvfile" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        {fileName && <span className="hint">{fileName} · {rows.length} data rows</span>}
      </div>

      {headers.length > 0 && (
        <>
          <h2 style={{ marginTop: 6 }}>Map columns</h2>
          <div className="table-wrap">
            <table className="map">
              <tbody>
                {MAPPABLE.map((field) => (
                  <tr key={field}>
                    <th>{MAPPING_LABELS[field]}{REQUIRED_FIELDS.includes(field) ? ' *' : ''}</th>
                    <td>
                      <select
                        value={mapping[field] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMapping((m) => ({ ...m, [field]: v === '' ? undefined : Number(v) }));
                        }}
                      >
                        <option value="">— not in file —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && <div className="error">Map the required columns: {missing.map((m) => MAPPING_LABELS[m]).join(', ')}.</div>}
          <div className="field" style={{ marginTop: 14 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={oneRupeeFree} onChange={(e) => setOneRupeeFree(e.target.checked)} style={{ width: 20, height: 20 }} />
              Treat ₹1 charging sessions as free (store ₹0)
            </label>
          </div>

          {preview && (
            <div className="preview">
              <div><b>{preview.entries.length}</b> new entries will be imported</div>
              <div>{preview.duplicates} duplicates skipped (same type, date and odometer already logged)</div>
              {preview.freeConverted > 0 && <div>{preview.freeConverted} ₹1 sessions stored as ₹0</div>}
              {preview.rejects.length > 0 && (
                <div style={{ color: 'var(--warn)' }}>
                  {preview.rejects.length} rows rejected, e.g. line {preview.rejects[0].line}: {preview.rejects[0].reason}
                </div>
              )}
            </div>
          )}

          <button className="btn" onClick={commit} disabled={!preview || preview.entries.length === 0 || busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </>
      )}
      {err && <div className="error">{err}</div>}
      {done && <div className="ok-text">{done}</div>}
    </div>
  );
}
