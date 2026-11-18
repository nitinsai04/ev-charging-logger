import { useMemo } from 'react';
import { computeSummary, fmtInr, fmtNum } from './calc';
import SavingsChart from './SavingsChart';
import type { LogEntry, Settings } from './types';
import { CHARGER_LABELS } from './types';

interface Props {
  entries: LogEntry[];
  settings: Settings;
  backup: { show: boolean; reason: string };
  onBackup: () => void;
}

const CHARGER_COLORS: Record<string, string> = {
  home: 'var(--blue)',
  dc_public: 'var(--amber)',
  ac_public: 'var(--mint)'
};

export default function Dashboard({ entries, settings, backup, onBackup }: Props) {
  const s = useMemo(() => computeSummary(entries, settings), [entries, settings]);
  const chargeTotal = s.byCharger.reduce((sum, c) => sum + c.totalCostInr, 0);
  const savingsPositive = s.netSavingsInr >= 0;
  const hasData = s.totalTrackedKm > 0;

  return (
    <>
      {backup.show && (
        <div className="banner">
          <span>{backup.reason} Back up your ledger.</span>
          <button className="btn secondary" style={{ width: 'auto', padding: '8px 12px', fontSize: 13 }} onClick={onBackup}>
            Backup
          </button>
        </div>
      )}

      <div className="hero-card">
        <div className="label">Cost per kilometer</div>
        <div className="hero-value mono">
          <span className="unit">₹</span>
          <span>{s.evPerKmInr === null ? '0.00' : fmtNum(s.evPerKmInr, 2)}</span>
          <span className="unit">/km</span>
        </div>
        <div className="hero-foot">
          {hasData
            ? `Benchmark ${settings.benchmarkCar}: ₹${fmtNum(s.benchmarkPerKmInr, 2)}/km. ${
                savingsPositive
                  ? `You are ₹${fmtNum(s.benchmarkPerKmInr - (s.evPerKmInr ?? 0), 2)}/km ahead.`
                  : 'Currently above the petrol benchmark.'
              }`
            : 'Log a charge to see your real running cost.'}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card spent">
          <div className="label">Total spent</div>
          <div className="value mono">{fmtInr(s.totalEvSpendInr)}</div>
          <div className="sub">{s.byCharger.reduce((n, c) => n + c.sessions, 0)} sessions</div>
        </div>
        <div className="stat-card saved">
          <div className="label">Saved vs i20</div>
          <div className="value mono">{fmtInr(s.netSavingsInr)}</div>
          <div className="sub">
            <span className={savingsPositive ? 'badge' : 'badge neg'}>
              {savingsPositive ? 'Ahead' : 'Behind'}
            </span>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Total km driven</div>
          <div className="value mono">{fmtNum(s.totalTrackedKm, 0)}</div>
          <div className="sub">Odometer {fmtNum(s.latestOdometerKm, 0)} km</div>
        </div>
        <div className="stat-card">
          <div className="label">Total kWh added</div>
          <div className="value mono">{fmtNum(s.totalKwh, 1)}</div>
          <div className="sub">Avg {s.avgCostPerKwh === null ? '—' : `₹${fmtNum(s.avgCostPerKwh, 2)}/kWh`}</div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Efficiency</div>
          <div className="value mono">
            {s.avgEfficiencyKmPerKwh === null ? '—' : fmtNum(s.avgEfficiencyKmPerKwh, 2)}
          </div>
          <div className="sub">
            {s.estimatedFullChargeRangeKm === null
              ? 'km/kWh · needs a valid trip'
              : `km/kWh · ≈ ${fmtNum(s.estimatedFullChargeRangeKm, 0)} km range`}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Battery pack</div>
          <div className="value mono">{fmtNum(settings.batteryKwh, 0)} kWh</div>
          <div className="sub">{settings.modelName}</div>
        </div>
      </div>

      <div className="chart-card">
        <div className="card-head">
          <span className="label">Savings over time</span>
        </div>
        <div className="chart-wrap">
          <SavingsChart entries={entries} settings={settings} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="label">By charger type</span>
          <span className="muted">Maintenance {fmtInr(s.maintenanceTotalInr)}</span>
        </div>
        {s.byCharger.map((c) => (
          <div key={c.type} className="charger-row">
            <span>
              <span className={`pill ${c.type}`}>{CHARGER_LABELS[c.type]}</span>
            </span>
            <span className="amount mono">{fmtInr(c.totalCostInr)}</span>
            <span className="meta">
              {c.sessions} sessions · {fmtNum(c.totalKwh, 1)} kWh · avg{' '}
              {c.avgCostPerKwh === null ? '—' : `₹${fmtNum(c.avgCostPerKwh, 2)}`}/kWh
            </span>
          </div>
        ))}
        <div className="bar" aria-label="Spend split by charger type">
          {s.byCharger.map((c) => (
            <span
              key={c.type}
              style={{
                width: chargeTotal > 0 ? `${(c.totalCostInr / chargeTotal) * 100}%` : '0%',
                background: CHARGER_COLORS[c.type]
              }}
            />
          ))}
        </div>
        {s.excludedTrips > 0 && (
          <div className="muted" style={{ marginTop: 10 }}>
            {s.excludedTrips} trip(s) excluded from efficiency (first trip or unlogged top-up).
          </div>
        )}
      </div>
    </>
  );
}
