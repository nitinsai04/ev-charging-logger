export type ChargerType = 'home' | 'dc_public' | 'ac_public';
export type EntryKind = 'charge' | 'maintenance';

export interface LogEntry {
  id: string;
  kind: EntryKind;
  date: string; // YYYY-MM-DD
  odometerKm: number;
  chargerType?: ChargerType; // charge entries only
  unitsKwh?: number; // energy billed at the charger
  costInr: number; // 0 = free charging
  startSoc?: number; // 0-100
  endSoc?: number; // 0-100
  notes: string;
  updatedAt: string; // ISO timestamp, set on every local change
  deleted: boolean; // soft delete so deletions sync
}

export interface Settings {
  modelName: string;
  batteryKwh: number;
  deliveryBaselineKm: number;
  benchmarkCar: string;
  benchmarkMileage: number; // km per litre
  benchmarkPetrolPrice: number; // ₹ per litre
}

export const DEFAULT_SETTINGS: Settings = {
  modelName: 'Maruti e Vitara (49 kWh)',
  batteryKwh: 49,
  deliveryBaselineKm: 35,
  benchmarkCar: 'Hyundai i20 Petrol IVT',
  benchmarkMileage: 11,
  benchmarkPetrolPrice: 105
};

export const CHARGER_LABELS: Record<ChargerType, string> = {
  home: 'Home',
  dc_public: 'DC Fast',
  ac_public: 'Public AC'
};
