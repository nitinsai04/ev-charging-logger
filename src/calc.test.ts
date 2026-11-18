import { describe, expect, it } from 'vitest';
import { computeSummary, computeTrips } from './calc';
import { DEFAULT_SETTINGS, type LogEntry } from './types';

const S = DEFAULT_SETTINGS; // 49 kWh, baseline 35 km, 11 km/l, ₹105/l

function charge(p: Partial<LogEntry> & { id: string; odometerKm: number }): LogEntry {
  return {
    kind: 'charge',
    date: '2026-06-01',
    chargerType: 'home',
    costInr: 100,
    notes: '',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deleted: false,
    ...p
  };
}

describe('computeTrips (SoC-delta method)', () => {
  it('uses the delivery baseline for the first trip and marks efficiency N/A', () => {
    const [t] = computeTrips([charge({ id: 'a', odometerKm: 103, endSoc: 90, startSoc: 80 })], S);
    expect(t.tripKm).toBe(68);
    expect(t.efficiencyKmPerKwh).toBeNull();
    expect(t.efficiencyNote).toBe('first-trip');
  });

  it('computes energy from the previous end SoC minus this start SoC', () => {
    const trips = computeTrips(
      [
        charge({ id: 'a', odometerKm: 103, startSoc: 80, endSoc: 90 }),
        charge({ id: 'b', odometerKm: 326, startSoc: 28, endSoc: 53 })
      ],
      S
    );
    const t = trips[1];
    expect(t.tripKm).toBe(223);
    // (90 - 28)% of 49 kWh = 30.38 kWh; 223 / 30.38 = 7.34 km/kWh
    expect(t.energyUsedKwh).toBeCloseTo(30.38, 2);
    expect(t.efficiencyKmPerKwh).toBeCloseTo(7.34, 2);
  });

  it('flags an unlogged top-up instead of producing a negative or distorted value', () => {
    const trips = computeTrips(
      [
        charge({ id: 'a', odometerKm: 103, startSoc: 80, endSoc: 50 }),
        charge({ id: 'b', odometerKm: 200, startSoc: 60, endSoc: 90 })
      ],
      S
    );
    expect(trips[1].efficiencyKmPerKwh).toBeNull();
    expect(trips[1].efficiencyNote).toBe('unlogged-top-up');
  });

  it('sorts by odometer even when entries were added out of order', () => {
    const trips = computeTrips(
      [
        charge({ id: 'late', odometerKm: 326, startSoc: 28, endSoc: 53 }),
        charge({ id: 'early', odometerKm: 103, startSoc: 80, endSoc: 90 })
      ],
      S
    );
    expect(trips.map((t) => t.entry.id)).toEqual(['early', 'late']);
    expect(trips[1].tripKm).toBe(223);
  });

  it('ignores soft-deleted entries and maintenance rows', () => {
    const trips = computeTrips(
      [
        charge({ id: 'a', odometerKm: 103 }),
        charge({ id: 'gone', odometerKm: 200, deleted: true }),
        { id: 'm', kind: 'maintenance', date: '2026-08-16', odometerKm: 150, costInr: 600, notes: 'Wash', updatedAt: '', deleted: false }
      ],
      S
    );
    expect(trips.map((t) => t.entry.id)).toEqual(['a']);
  });

  it('treats ₹0 (free) as a real cost and counts the full petrol equivalent as savings', () => {
    const [, t] = computeTrips(
      [
        charge({ id: 'a', odometerKm: 103, startSoc: 80, endSoc: 90 }),
        charge({ id: 'b', odometerKm: 113, startSoc: 40, endSoc: 60, costInr: 0 })
      ],
      S
    );
    expect(t.petrolCostInr).toBeCloseTo((10 / 11) * 105, 6);
    expect(t.savingsInr).toBeCloseTo((10 / 11) * 105, 6);
  });

  it('recalculates petrol cost when the benchmark changes', () => {
    const entries = [charge({ id: 'a', odometerKm: 103 })];
    const base = computeTrips(entries, S)[0].petrolCostInr;
    const changed = computeTrips(entries, { ...S, benchmarkPetrolPrice: 110 })[0].petrolCostInr;
    expect(changed).toBeCloseTo((base / 105) * 110, 6);
  });
});

describe('computeSummary', () => {
  it('produces the dashboard totals from raw logs', () => {
    const entries: LogEntry[] = [
      charge({ id: 'a', odometerKm: 103, unitsKwh: 4.67, costInr: 82.67, chargerType: 'dc_public', startSoc: 80, endSoc: 90 }),
      charge({ id: 'b', odometerKm: 326, unitsKwh: 12.5, costInr: 100, chargerType: 'home', startSoc: 28, endSoc: 53 }),
      charge({ id: 'c', odometerKm: 362, unitsKwh: 0, costInr: 0, chargerType: 'dc_public', startSoc: 42, endSoc: 82 })
    ];
    const s = computeSummary(entries, S);
    expect(s.latestOdometerKm).toBe(362);
    expect(s.totalTrackedKm).toBe(327); // 362 - 35
    expect(s.totalEvSpendInr).toBeCloseTo(182.67, 6);
    expect(s.totalKwh).toBeCloseTo(17.17, 6);
    expect(s.equivalentPetrolInr).toBeCloseTo((327 / 11) * 105, 6);
    expect(s.netSavingsInr).toBeCloseTo((327 / 11) * 105 - 182.67, 6);
    expect(s.benchmarkPerKmInr).toBeCloseTo(9.545, 3);
    // Valid trips: only the 223 km and 36 km trips (the first trip is N/A).
    expect(s.validTrips).toBe(2);
    expect(s.avgEfficiencyKmPerKwh).not.toBeNull();
    const dc = s.byCharger.find((c) => c.type === 'dc_public')!;
    expect(dc.sessions).toBe(2);
    expect(dc.totalCostInr).toBeCloseTo(82.67, 6);
    expect(dc.avgCostPerKwh).toBeCloseTo(82.67 / 4.67, 6);
  });

  it('returns empty-state values without dividing by zero', () => {
    const s = computeSummary([], S);
    expect(s.latestOdometerKm).toBe(35);
    expect(s.totalTrackedKm).toBe(0);
    expect(s.evPerKmInr).toBeNull();
    expect(s.avgEfficiencyKmPerKwh).toBeNull();
    expect(s.avgCostPerKwh).toBeNull();
  });
});
