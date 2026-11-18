import { CHARGER_LABELS, type ChargerType, type LogEntry, type Settings } from './types';

export type EfficiencyNote =
  | 'first-trip'
  | 'unlogged-top-up'
  | 'missing-soc'
  | 'bad-odometer';

export interface TripResult {
  entry: LogEntry;
  tripKm: number; // D_i
  energyUsedKwh: number | null; // E_used,i (SoC-delta method)
  efficiencyKmPerKwh: number | null;
  efficiencyNote: EfficiencyNote | null;
  petrolCostInr: number; // C_petrol,i
  savingsInr: number; // petrol cost minus EV cost for this charge
}

export interface ChargerBreakdown {
  type: ChargerType;
  label: string;
  sessions: number;
  totalCostInr: number;
  totalKwh: number;
  avgCostPerKwh: number | null;
}

export interface Summary {
  latestOdometerKm: number;
  totalTrackedKm: number;
  totalEvSpendInr: number;
  totalKwh: number;
  avgCostPerKwh: number | null;
  equivalentPetrolInr: number;
  netSavingsInr: number;
  evPerKmInr: number | null;
  benchmarkPerKmInr: number;
  avgEfficiencyKmPerKwh: number | null;
  estimatedFullChargeRangeKm: number | null;
  validTrips: number;
  excludedTrips: number;
  maintenanceTotalInr: number;
  byCharger: ChargerBreakdown[];
}

/** Chronological order by odometer; date and id break ties so results are stable. */
export function sortByOdometer(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.odometerKm - b.odometerKm ||
      a.date.localeCompare(b.date) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Computes every charging trip from the raw logged fields.
 * Nothing derived is stored, so changing settings or editing history
 * recalculates everything. Maintenance entries are ignored here.
 */
export function computeTrips(entries: LogEntry[], settings: Settings): TripResult[] {
  const charges = sortByOdometer(entries.filter((e) => e.kind === 'charge' && !e.deleted));
  const results: TripResult[] = [];

  charges.forEach((entry, index) => {
    const prev = index > 0 ? charges[index - 1] : undefined;
    const tripKm = prev
      ? entry.odometerKm - prev.odometerKm
      : entry.odometerKm - settings.deliveryBaselineKm;

    let energyUsedKwh: number | null = null;
    let efficiencyKmPerKwh: number | null = null;
    let efficiencyNote: EfficiencyNote | null = null;

    if (tripKm <= 0) {
      efficiencyNote = 'bad-odometer';
    } else if (!prev) {
      efficiencyNote = 'first-trip';
    } else if (prev.endSoc === undefined || entry.startSoc === undefined) {
      efficiencyNote = 'missing-soc';
    } else {
      const socUsed = prev.endSoc - entry.startSoc;
      if (socUsed <= 0) {
        efficiencyNote = 'unlogged-top-up';
      } else {
        energyUsedKwh = (socUsed / 100) * settings.batteryKwh;
        efficiencyKmPerKwh = tripKm / energyUsedKwh;
      }
    }

    const petrolCostInr =
      tripKm > 0 ? (tripKm / settings.benchmarkMileage) * settings.benchmarkPetrolPrice : 0;

    results.push({
      entry,
      tripKm,
      energyUsedKwh,
      efficiencyKmPerKwh,
      efficiencyNote,
      petrolCostInr,
      savingsInr: petrolCostInr - entry.costInr
    });
  });

  return results;
}

export function computeSummary(entries: LogEntry[], settings: Settings): Summary {
  const live = entries.filter((e) => !e.deleted);
  const charges = live.filter((e) => e.kind === 'charge');
  const trips = computeTrips(live, settings);

  const latestOdometerKm = charges.length
    ? Math.max(...charges.map((c) => c.odometerKm))
    : settings.deliveryBaselineKm;
  const totalTrackedKm = Math.max(0, latestOdometerKm - settings.deliveryBaselineKm);

  const totalEvSpendInr = charges.reduce((sum, c) => sum + c.costInr, 0);
  const totalKwh = charges.reduce((sum, c) => sum + (c.unitsKwh ?? 0), 0);
  const kwhCostBase = charges
    .filter((c) => (c.unitsKwh ?? 0) > 0)
    .reduce((sum, c) => sum + c.costInr, 0);

  const equivalentPetrolInr =
    (totalTrackedKm / settings.benchmarkMileage) * settings.benchmarkPetrolPrice;

  const valid = trips.filter((t) => t.efficiencyKmPerKwh !== null);
  const validKm = valid.reduce((sum, t) => sum + t.tripKm, 0);
  const validKwh = valid.reduce((sum, t) => sum + (t.energyUsedKwh ?? 0), 0);
  const avgEfficiencyKmPerKwh = validKwh > 0 ? validKm / validKwh : null;

  const byCharger: ChargerBreakdown[] = (Object.keys(CHARGER_LABELS) as ChargerType[]).map((type) => {
    const group = charges.filter((c) => c.chargerType === type);
    const totalCostInr = group.reduce((sum, c) => sum + c.costInr, 0);
    const totalKwhType = group.reduce((sum, c) => sum + (c.unitsKwh ?? 0), 0);
    const costWithUnits = group
      .filter((c) => (c.unitsKwh ?? 0) > 0)
      .reduce((sum, c) => sum + c.costInr, 0);
    return {
      type,
      label: CHARGER_LABELS[type],
      sessions: group.length,
      totalCostInr,
      totalKwh: totalKwhType,
      avgCostPerKwh: totalKwhType > 0 ? costWithUnits / totalKwhType : null
    };
  });

  return {
    latestOdometerKm,
    totalTrackedKm,
    totalEvSpendInr,
    totalKwh,
    avgCostPerKwh: totalKwh > 0 ? kwhCostBase / totalKwh : null,
    equivalentPetrolInr,
    netSavingsInr: equivalentPetrolInr - totalEvSpendInr,
    evPerKmInr: totalTrackedKm > 0 ? totalEvSpendInr / totalTrackedKm : null,
    benchmarkPerKmInr: settings.benchmarkPetrolPrice / settings.benchmarkMileage,
    avgEfficiencyKmPerKwh,
    estimatedFullChargeRangeKm: avgEfficiencyKmPerKwh !== null
      ? avgEfficiencyKmPerKwh * settings.batteryKwh
      : null,
    validTrips: valid.length,
    excludedTrips: trips.length - valid.length,
    maintenanceTotalInr: live
      .filter((e) => e.kind === 'maintenance')
      .reduce((sum, e) => sum + e.costInr, 0),
    byCharger
  };
}

export function fmtInr(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return '₹' + value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function fmtNum(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}
