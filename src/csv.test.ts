import { describe, expect, it } from 'vitest';
import { buildEntries, exportCsv, guessMapping, normaliseCharger, normaliseDate, parseCsv } from './csv';
import { DEFAULT_SETTINGS } from './types';

const HEADER = 'Type,Date,Odometer,TripKM,EffectiveKwh,ChargerKwh,EfficiencyKmPerKwh,BattStartPct,BattEndPct,Cost,ChargeType,Description';

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes and CRLF line endings', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"']
    ]);
  });

  it('drops blank lines and a UTF-8 BOM', () => {
    const rows = parseCsv('﻿Type,Date\n\n\ncharge,2026-06-17\n');
    expect(rows[0][0]).toBe('Type');
    expect(rows).toHaveLength(2);
  });
});

describe('header mapping and normalisation', () => {
  it('maps the export headers automatically', () => {
    const headers = HEADER.split(',');
    const m = guessMapping(headers);
    expect(headers[m.kind!]).toBe('Type');
    expect(headers[m.date!]).toBe('Date');
    expect(headers[m.odometer!]).toBe('Odometer');
    expect(headers[m.units!]).toBe('ChargerKwh');
    expect(headers[m.cost!]).toBe('Cost');
    expect(headers[m.startSoc!]).toBe('BattStartPct');
    expect(headers[m.endSoc!]).toBe('BattEndPct');
    expect(headers[m.chargerType!]).toBe('ChargeType');
    expect(headers[m.notes!]).toBe('Description');
  });

  it('normalises charger names case-insensitively', () => {
    expect(normaliseCharger('home')).toBe('home');
    expect(normaliseCharger('DC')).toBe('dc_public');
    expect(normaliseCharger('DC Public')).toBe('dc_public');
    expect(normaliseCharger('ac public')).toBe('ac_public');
    expect(normaliseCharger('supercharger')).toBeNull();
  });

  it('accepts several date formats and rejects impossible dates', () => {
    expect(normaliseDate('2026-06-17')).toBe('2026-06-17');
    expect(normaliseDate('17-06-2026')).toBe('2026-06-17');
    expect(normaliseDate('17/6/2026')).toBe('2026-06-17');
    expect(normaliseDate('31-02-2026')).toBeNull();
  });
});

describe('buildEntries', () => {
  const headers = HEADER.split(',');
  const mapping = guessMapping(headers);

  it('imports charges and maintenance, converting ₹1 to free when asked', () => {
    const rows = parseCsv(
      [
        'charge,2026-06-17,103,68,4.90,4.67,13.88,80,90,82.67,dc,',
        'charge,2026-06-24,607,245,31.85,31.98,7.69,16,81,1,dc,',
        'maintenance,2026-06-30,1129,,,,,,,1003,,"Rat repellant"'
      ].join('\n')
    );
    const r = buildEntries(rows, mapping, [], { oneRupeeIsFree: true }, '2026-11-18T00:00:00.000Z');
    expect(r.rejects).toEqual([]);
    expect(r.entries).toHaveLength(3);
    expect(r.freeConverted).toBe(1);
    expect(r.entries[1].costInr).toBe(0);
    expect(r.entries[0].chargerType).toBe('dc_public');
    expect(r.entries[2].kind).toBe('maintenance');
    expect(r.entries[2].notes).toBe('Rat repellant');
  });

  it('keeps ₹1 as ₹1 when the option is off', () => {
    const rows = parseCsv('charge,2026-06-24,607,245,31.85,31.98,7.69,16,81,1,dc,');
    const r = buildEntries(rows, mapping, [], { oneRupeeIsFree: false }, 'x');
    expect(r.entries[0].costInr).toBe(1);
  });

  it('skips rows already logged (same type, date and odometer) and reports rejects', () => {
    const rows = parseCsv(
      [
        'charge,2026-06-17,103,68,4.90,4.67,13.88,80,90,82.67,dc,',
        'charge,2026-06-17,103,68,4.90,4.67,13.88,80,90,82.67,dc,',
        'charge,2026-06-18,200,97,1,1,1,10,20,50,spaceport,',
        'charge,not-a-date,300,100,1,1,1,10,20,50,home,'
      ].join('\n')
    );
    const first = buildEntries(rows, mapping, [], { oneRupeeIsFree: true }, 'x');
    expect(first.entries).toHaveLength(1);
    expect(first.duplicates).toBe(1);
    expect(first.rejects.map((r) => r.reason)).toEqual([
      'Charger type "spaceport" not recognised',
      'Date not recognised'
    ]);

    const again = buildEntries(rows, mapping, first.entries, { oneRupeeIsFree: true }, 'x');
    expect(again.entries).toHaveLength(0);
  });

  it('rejects SoC values outside 0–100', () => {
    const rows = parseCsv('charge,2026-06-17,103,68,4.90,4.67,13.88,80,120,82.67,dc,');
    const r = buildEntries(rows, mapping, [], { oneRupeeIsFree: true }, 'x');
    expect(r.entries).toHaveLength(0);
    expect(r.rejects[0].reason).toMatch(/End SoC/);
  });
});

describe('exportCsv', () => {
  it('writes raw and calculated columns in odometer order', () => {
    const rows = parseCsv(
      [
        'charge,2026-06-17,103,68,4.90,4.67,13.88,80,90,82.67,dc,',
        'charge,2026-06-20,326,223,12.25,12.5,18.20,28,53,100,home,'
      ].join('\n')
    );
    const { entries } = buildEntries(rows, guessMapping(HEADER.split(',')), [], { oneRupeeIsFree: true }, '2026-06-20T00:00:00.000Z');
    const out = exportCsv(entries, DEFAULT_SETTINGS).trim().split('\n');
    expect(out[0].split(',')).toContain('EfficiencyKmPerKwh');
    expect(out).toHaveLength(3);
    expect(out[1].startsWith('charge,2026-06-17,103,68,')).toBe(true);
    expect(out[2]).toContain('7.34');
  });
});
