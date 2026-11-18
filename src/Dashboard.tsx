import { useMemo } from 'react';
import { computeSummary, computeTrips, fmtInr, fmtNum } from './calc';
import type { LogEntry, Settings } from './types';
import { CHARGER_LABELS } from './types';

interface Props {
  entries: LogEntry[];
  settings: Settings;
  backup: { show: boolean; reason: string };
  onEdit: (entry: LogEntry) => void;
  onBackup: () => void;
}

const CHARGER_COLORS: Record<string, string> = {
  home: '#2563eb',
  dc_public: '#dc2626',
  ac_public: '#ca8a04'
};

export default function Dashboard({ entries, settings, backup, onEdit, onBackup }: Props) {
  const summary = useMemo(() => computeSummary(entries, settings), [entries, settings]);
  const trips = useMemo(() => computeTrips(entries, settings), [entries, settings]);
  const recent = useMemo(() => [...trips].reverse().slice(0, 25), [trips]);

  const totalSpend = summary.totalEvSpendInr;
  const chargeTotal = summary.byCharger.reduce((s, c) => s + c.totalCostInr, 0);
  const savingsPositive = summary.netSavingsInr >= 0;

  return (
    <div className="content">
      {backup.show && (
        <div className="banner">
          <span>{backup.reason} Back up your data.</span>
          <button className="btn secondary" style={{ width: 'auto', padding: '8px 12px' }} onClick={onBackup}>
            Backup to Files/iCloud
          </button>
        </div>
      )}

      <div className="kpi-grid">
        <div className="card kpi wide">
          <div className="label">Total odometer</div>
          <div className="value">{fmtNum(summary.latestOdometerKm, 0)} km</div>
          <div className="sub">
            {fmtNum(summary.totalTrackedKm, 0)} km tracked (latest − {settings.deliveryBaselineKm} km)
          </div>
        </div>

        <div className="card kpi wide">
          <div className="label">EV charging vs {settings.benchmarkCar}</div>
          <div className="value">
            {fmtInr(totalSpend)} <span className="muted">vs</span> {fmtInr(summary.equivalentPetrolInr)}
          </div>
          <div className="sub">EV spend vs equivalent petrol spend</div>
          <div style={{ marginTop: 10 }}>
            <span className={savingsPositive ? 'badge' : 'badge neg'}>
              Net savings {fmtInr(summary.netSavingsInr)}
            </span>
          </div>
        </div>

        <div className="card kpi">
          <div className="label">Running cost</div>
          <div className="value">
            {summary.evPerKmInr === null ? '—' : `₹${fmtNum(summary.evPerKmInr, 2)}`}
            <span className="muted" style={{ fontSize: 14 }}>/km</span>
          </div>
          <div className="sub">Benchmark ₹{fmtNum(summary.benchmarkPerKmInr, 2)}/km</div>
        </div>

        <div className="card kpi">
          <div className="label">Average efficiency</div>
          <div className="value">
            {summary.avgEfficiencyKmPerKwh === null ? '—' : fmtNum(summary.avgEfficiencyKmPerKwh, 2)}
            <span className="muted" style={{ fontSize: 14 }}> km/kWh</span>
          </div>
          <div className="sub">
            {summary.estimatedFullChargeRangeKm === null
              ? 'Needs at least one valid trip'
              : `≈ ${fmtNum(summary.estimatedFullChargeRangeKm, 0)} km per full charge`}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>By charger type</h2>
        {summary.byCharger.map((c) => (
          <div key={c.type} className="charger-row">
            <div>
              <span className={`pill ${c.type}`}>{CHARGER_LABELS[c.type]}</span>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 700 }}>{fmtInr(c.totalCostInr)}</div>
            <div className="meta">
              {c.sessions} sessions · {fmtNum(c.totalKwh, 1)} kWh · avg{' '}
              {c.avgCostPerKwh === null ? '—' : `₹${fmtNum(c.avgCostPerKwh, 2)}`}/kWh
            </div>
          </div>
        ))}
        <div className="bar" aria-label="Spend split by charger type">
          {summary.byCharger.map((c) => (
            <span
              key={c.type}
              style={{
                width: chargeTotal > 0 ? `${(c.totalCostInr / chargeTotal) * 100}%` : '0%',
                background: CHARGER_COLORS[c.type]
              }}
            />
          ))}
        </div>
        <div className="muted">
          Maintenance (not counted above): {fmtInr(summary.maintenanceTotalInr)}
          {summary.excludedTrips > 0 && ` · ${summary.excludedTrips} trip(s) excluded from efficiency`}
        </div>
      </div>

      <h2 className="muted" style={{ fontSize: 13, margin: '6px 4px 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Recent
      </h2>

      {recent.length === 0 && <div className="empty">No entries yet. Tap + Log charge to add one.</div>}

      {recent.map((t) => {
        const e = t.entry;
        const isMaint = e.kind === 'maintenance';
        if (isMaint) {
          return (
            <button key={e.id} className="log-card" onClick={() => onEdit(e)}>
              <div className="top">
                <span className="date">{e.date}</span>
                <span className="pill">Maintenance</span>
              </div>
              <div className="grid">
                <span>Odometer <b>{fmtNum(e.odometerKm, 0)} km</b></span>
                <span>Cost <b>{fmtInr(e.costInr)}</b></span>
                <span style={{ gridColumn: '1 / -1' }}>{e.notes || '—'}</span>
              </div>
            </button>
          );
        }
        const soc =
          e.startSoc !== undefined && e.endSoc !== undefined ? `${e.endSoc}% → ${e.startSoc}%` : null;
        return (
          <button key={e.id} className="log-card" onClick={() => onEdit(e)}>
            <div className="top">
              <span className="date">{e.date}</span>
              <span className={`pill ${e.chargerType ?? ''}`}>
                {e.chargerType ? CHARGER_LABELS[e.chargerType] : ''}
              </span>
            </div>
            <div className="top">
              <span className="muted">
                Odometer <b style={{ color: 'var(--text)' }}>{fmtNum(e.odometerKm, 0)} km</b>
                {t.tripKm > 0 && ` · +${fmtNum(t.tripKm, 0)} km`}
              </span>
              <span className="cost">{fmtInr(e.costInr)}</span>
            </div>
            <div className="grid">
              <span>SoC <b>{soc ?? '—'}</b></span>
              <span>Units <b>{e.unitsKwh !== undefined ? `${fmtNum(e.unitsKwh, 2)} kWh` : '—'}</b></span>
              <span>
                Efficiency{' '}
                <b>
                  {t.efficiencyKmPerKwh !== null
                    ? `${fmtNum(t.efficiencyKmPerKwh, 2)} km/kWh`
                    : t.efficiencyNote === 'unlogged-top-up'
                      ? 'N/A (unlogged top-up)'
                      : 'N/A'}
                </b>
              </span>
              <span>
                ₹/kWh{' '}
                <b>
                  {e.unitsKwh && e.unitsKwh > 0 ? `₹${fmtNum(e.costInr / e.unitsKwh, 2)}` : '—'}
                </b>
              </span>
            </div>
            {e.notes && <div className="muted">{e.notes}</div>}
          </button>
        );
      })}
    </div>
  );
}
