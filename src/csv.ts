import { computeTrips, sortByOdometer } from './calc';
import type { ChargerType, EntryKind, LogEntry, Settings } from './types';

/** Parses CSV text into rows, honouring quoted fields with commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type MappingField =
  | 'kind'
  | 'date'
  | 'odometer'
  | 'units'
  | 'cost'
  | 'startSoc'
  | 'endSoc'
  | 'chargerType'
  | 'notes';

export type ColumnMapping = Partial<Record<MappingField, number>>;

export const MAPPING_LABELS: Record<MappingField, string> = {
  kind: 'Type (charge / maintenance)',
  date: 'Date',
  odometer: 'Odometer (km)',
  units: 'Units consumed (kWh)',
  cost: 'Cost (₹)',
  startSoc: 'Start SoC (%)',
  endSoc: 'End SoC (%)',
  chargerType: 'Charger type',
  notes: 'Notes / description'
};

export const REQUIRED_FIELDS: MappingField[] = ['date', 'odometer', 'cost'];

const HEADER_HINTS: Record<MappingField, string[]> = {
  kind: ['type'],
  date: ['date'],
  odometer: ['odometer', 'odo', 'odometerkm'],
  units: ['chargerkwh', 'units', 'unitskwh', 'kwh'],
  cost: ['cost', 'totalcost', 'costinr', 'amount'],
  startSoc: ['battstartpct', 'startsoc', 'startsoc%', 'start'],
  endSoc: ['battendpct', 'endsoc', 'endsoc%', 'end'],
  chargerType: ['chargetype', 'charger', 'chargertype'],
  notes: ['description', 'notes', 'note']
};

/** Guesses which CSV column holds which field, by matching normalised header names. */
export function guessMapping(headers: string[]): ColumnMapping {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9%]/g, ''));
  const mapping: ColumnMapping = {};
  (Object.keys(HEADER_HINTS) as MappingField[]).forEach((field) => {
    const idx = norm.findIndex((h) => HEADER_HINTS[field].includes(h));
    if (idx >= 0) mapping[field] = idx;
  });
  return mapping;
}

export function normaliseCharger(raw: string): ChargerType | null {
  const v = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (v === 'home') return 'home';
  if (v === 'dc' || v === 'dc public' || v === 'dcpublic') return 'dc_public';
  if (v === 'ac' || v === 'ac public' || v === 'acpublic') return 'ac_public';
  return null;
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY and returns YYYY-MM-DD. */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return toIso(+m[3], +m[2], +m[1]);
  return null;
}

function toIso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[₹,%\s]/g, '');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export interface ImportOptions {
  /** Treat ₹1 as the marker for a free charge and store it as ₹0. */
  oneRupeeIsFree: boolean;
}

export interface ImportResult {
  entries: LogEntry[];
  rejects: { line: number; reason: string }[];
  duplicates: number;
  freeConverted: number;
}

/** Builds LogEntry records from parsed rows using the confirmed column mapping. */
export function buildEntries(
  rows: string[][],
  mapping: ColumnMapping,
  existing: LogEntry[],
  opts: ImportOptions,
  now: string
): ImportResult {
  const seen = new Set(existing.map((e) => dedupeKey(e.kind, e.date, e.odometerKm)));
  const entries: LogEntry[] = [];
  const rejects: ImportResult['rejects'] = [];
  let duplicates = 0;
  let freeConverted = 0;

  rows.forEach((row, idx) => {
    const line = idx + 2; // header is line 1
    const get = (f: MappingField) => (mapping[f] !== undefined ? row[mapping[f]!] ?? '' : undefined);

    const rawKind = (get('kind') ?? 'charge').trim().toLowerCase();
    const kind: EntryKind | null =
      rawKind === '' || rawKind === 'charge' ? 'charge' : rawKind === 'maintenance' ? 'maintenance' : null;
    if (!kind) return rejects.push({ line, reason: `Unknown type "${rawKind}"` });

    const date = normaliseDate(get('date') ?? '');
    if (!date) return rejects.push({ line, reason: 'Date not recognised' });

    const odometerKm = parseNumber(get('odometer'));
    if (odometerKm === undefined || Number.isNaN(odometerKm) || odometerKm < 0) {
      return rejects.push({ line, reason: 'Odometer missing or invalid' });
    }

    let costInr = parseNumber(get('cost'));
    if (costInr === undefined || Number.isNaN(costInr) || costInr < 0) {
      return rejects.push({ line, reason: 'Cost missing or invalid' });
    }
    if (kind === 'charge' && opts.oneRupeeIsFree && costInr === 1) {
      costInr = 0;
      freeConverted++;
    }

    const notes = (get('notes') ?? '').trim();
    const key = dedupeKey(kind, date, odometerKm);
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);

    if (kind === 'maintenance') {
      entries.push({
        id: crypto.randomUUID(),
        kind,
        date,
        odometerKm,
        costInr,
        notes,
        updatedAt: now,
        deleted: false
      });
      return;
    }

    const charger = normaliseCharger(get('chargerType') ?? '');
    if (!charger) return rejects.push({ line, reason: `Charger type "${get('chargerType') ?? ''}" not recognised` });

    const startSoc = parseNumber(get('startSoc'));
    const endSoc = parseNumber(get('endSoc'));
    const unitsKwh = parseNumber(get('units'));
    for (const [label, v] of [['Start SoC', startSoc], ['End SoC', endSoc]] as const) {
      if (v !== undefined && (Number.isNaN(v) || v < 0 || v > 100)) {
        return rejects.push({ line, reason: `${label} must be 0–100` });
      }
    }
    if (unitsKwh !== undefined && (Number.isNaN(unitsKwh) || unitsKwh < 0)) {
      return rejects.push({ line, reason: 'Units invalid' });
    }

    entries.push({
      id: crypto.randomUUID(),
      kind,
      date,
      odometerKm,
      chargerType: charger,
      unitsKwh,
      costInr,
      startSoc,
      endSoc,
      notes,
      updatedAt: now,
      deleted: false
    });
  });

  return { entries, rejects, duplicates, freeConverted };
}

function dedupeKey(kind: EntryKind, date: string, odometerKm: number): string {
  return `${kind}|${date}|${odometerKm}`;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXPORT_HEADERS = [
  'Type',
  'Date',
  'Odometer',
  'TripKM',
  'EnergyUsedKwh',
  'EfficiencyKmPerKwh',
  'ChargerKwh',
  'BattStartPct',
  'BattEndPct',
  'Cost',
  'ChargeType',
  'BenchmarkPetrolCost',
  'SavingsInr',
  'Description'
];

/** Full export: raw fields plus calculated columns, one row per entry in odometer order. */
export function exportCsv(entries: LogEntry[], settings: Settings): string {
  const live = entries.filter((e) => !e.deleted);
  const trips = new Map(computeTrips(live, settings).map((t) => [t.entry.id, t]));
  const lines: string[] = [EXPORT_HEADERS.join(',')];

  for (const e of sortByOdometer(live)) {
    const t = trips.get(e.id);
    const f = (n: number | null | undefined, d = 2) =>
      n === null || n === undefined ? '' : n.toFixed(d);
    lines.push(
      [
        e.kind,
        e.date,
        e.odometerKm,
        t ? f(t.tripKm, 0) : '',
        t ? f(t.energyUsedKwh) : '',
        t ? (t.efficiencyKmPerKwh !== null ? f(t.efficiencyKmPerKwh) : t.efficiencyNote ?? '') : '',
        e.unitsKwh ?? '',
        e.startSoc ?? '',
        e.endSoc ?? '',
        e.costInr,
        e.chargerType ?? '',
        t ? f(t.petrolCostInr) : '',
        t ? f(t.savingsInr) : '',
        e.notes
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}
