import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, getKv, getSettings, setKv, type StoredEntry } from './db';
import type { LogEntry, Settings } from './types';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  at: string;
}

const SETTINGS_ID = 'default';

interface RemoteLog {
  id: string;
  kind: LogEntry['kind'];
  date: string;
  odometer_km: number;
  charger_type: LogEntry['chargerType'] | null;
  units_kwh: number | null;
  cost_inr: number;
  start_soc: number | null;
  end_soc: number | null;
  notes: string | null;
  deleted: boolean;
  updated_at: string;
}

interface RemoteSettings {
  id: string;
  model_name: string;
  battery_kwh: number;
  delivery_baseline_km: number;
  benchmark_car: string;
  benchmark_mileage: number;
  benchmark_petrol_price: number;
  updated_at: string;
}

export function makeClient(cfg: SupabaseConfig): SupabaseClient {
  return createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
}

/** Checks the URL and key by reading the settings table. */
export async function testConnection(cfg: SupabaseConfig): Promise<void> {
  const client = makeClient(cfg);
  const { error } = await client.from('vehicle_settings').select('id').limit(1);
  if (error) throw new Error(error.message);
}

function toRemoteLog(e: StoredEntry): RemoteLog {
  return {
    id: e.id,
    kind: e.kind,
    date: e.date,
    odometer_km: e.odometerKm,
    charger_type: e.chargerType ?? null,
    units_kwh: e.unitsKwh ?? null,
    cost_inr: e.costInr,
    start_soc: e.startSoc ?? null,
    end_soc: e.endSoc ?? null,
    notes: e.notes || null,
    deleted: e.deleted,
    updated_at: e.updatedAt
  };
}

function fromRemoteLog(r: RemoteLog): LogEntry {
  return {
    id: r.id,
    kind: r.kind,
    date: r.date,
    odometerKm: Number(r.odometer_km),
    chargerType: r.charger_type ?? undefined,
    unitsKwh: r.units_kwh === null ? undefined : Number(r.units_kwh),
    costInr: Number(r.cost_inr),
    startSoc: r.start_soc === null ? undefined : Number(r.start_soc),
    endSoc: r.end_soc === null ? undefined : Number(r.end_soc),
    notes: r.notes ?? '',
    updatedAt: new Date(r.updated_at).toISOString(),
    deleted: r.deleted
  };
}

function toRemoteSettings(s: Settings, updatedAt: string): RemoteSettings {
  return {
    id: SETTINGS_ID,
    model_name: s.modelName,
    battery_kwh: s.batteryKwh,
    delivery_baseline_km: s.deliveryBaselineKm,
    benchmark_car: s.benchmarkCar,
    benchmark_mileage: s.benchmarkMileage,
    benchmark_petrol_price: s.benchmarkPetrolPrice,
    updated_at: updatedAt
  };
}

function fromRemoteSettings(r: RemoteSettings): Settings {
  return {
    modelName: r.model_name,
    batteryKwh: Number(r.battery_kwh),
    deliveryBaselineKm: Number(r.delivery_baseline_km),
    benchmarkCar: r.benchmark_car,
    benchmarkMileage: Number(r.benchmark_mileage),
    benchmarkPetrolPrice: Number(r.benchmark_petrol_price)
  };
}

/**
 * Two-way sync. Local changes are pushed first; then remote rows changed since the
 * last pull are merged in. Conflicts resolve last-write-wins on updated_at.
 */
export async function syncNow(cfg: SupabaseConfig): Promise<SyncResult> {
  const client = makeClient(cfg);
  const startedAt = new Date().toISOString();
  let pushed = 0;
  let pulled = 0;

  // 1. Push dirty log entries.
  const dirtyEntries = await db.entries.where('dirty').equals(1).toArray();
  if (dirtyEntries.length) {
    const { error } = await client
      .from('charge_logs')
      .upsert(dirtyEntries.map(toRemoteLog), { onConflict: 'id' });
    if (error) throw new Error(`Push failed: ${error.message}`);
    for (const e of dirtyEntries) {
      // Only clear the flag if the row wasn't edited again while we were pushing.
      const current = await db.entries.get(e.id);
      if (current && current.updatedAt === e.updatedAt) {
        await db.entries.update(e.id, { dirty: 0 });
      }
    }
    pushed += dirtyEntries.length;
  }

  // 2. Push dirty settings.
  const settings = await getSettings();
  if (settings.dirty === 1) {
    const { error } = await client
      .from('vehicle_settings')
      .upsert(toRemoteSettings(settings.values, settings.updatedAt), { onConflict: 'id' });
    if (error) throw new Error(`Settings push failed: ${error.message}`);
    await setKv('settings', { ...settings, dirty: 0 });
    pushed += 1;
  }

  // 3. Pull remote log changes since the last pull.
  const since = (await getKv<string>('lastPulledAt')) ?? new Date(0).toISOString();
  const { data: logs, error: logErr } = await client
    .from('charge_logs')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });
  if (logErr) throw new Error(`Pull failed: ${logErr.message}`);

  let newest = since;
  for (const raw of (logs ?? []) as RemoteLog[]) {
    const remote = fromRemoteLog(raw);
    const local = await db.entries.get(remote.id);
    const remoteIsNewer = !local || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
    if (remoteIsNewer) {
      await db.entries.put({ ...remote, dirty: 0 });
      pulled++;
    }
    if (Date.parse(raw.updated_at) > Date.parse(newest)) newest = raw.updated_at;
  }

  // 4. Pull settings if the remote copy is newer than the local one.
  const { data: remoteSettings, error: setErr } = await client
    .from('vehicle_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (setErr) throw new Error(`Settings pull failed: ${setErr.message}`);
  if (remoteSettings) {
    const current = await getSettings();
    const remoteAt = (remoteSettings as RemoteSettings).updated_at;
    if (current.dirty === 0 && Date.parse(remoteAt) > Date.parse(current.updatedAt)) {
      await setKv('settings', {
        values: fromRemoteSettings(remoteSettings as RemoteSettings),
        updatedAt: new Date(remoteAt).toISOString(),
        dirty: 0
      });
      pulled++;
    }
  }

  await setKv('lastPulledAt', Date.parse(newest) > Date.parse(since) ? newest : startedAt);
  await setKv('lastSyncedAt', new Date().toISOString());
  return { pushed, pulled, at: new Date().toISOString() };
}
