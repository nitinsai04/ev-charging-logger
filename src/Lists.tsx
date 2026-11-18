import { useMemo } from 'react';
import { computeTrips, fmtInr, fmtNum, sortByOdometer } from './calc';
import { CHARGER_LABELS, type LogEntry, type Settings } from './types';

interface ChargesProps {
  entries: LogEntry[];
  settings: Settings;
  onEdit: (entry: LogEntry) => void;
  onAdd: () => void;
}

export function ChargesList({ entries, settings, onEdit, onAdd }: ChargesProps) {
  const trips = useMemo(() => computeTrips(entries, settings), [entries, settings]);
  const newestFirst = useMemo(() => [...trips].reverse(), [trips]);

  return (
    <>
      <div className="list-header">
        <h2>Charges</h2>
        <button className="add-btn" onClick={onAdd} aria-label="Log charge">+</button>
      </div>

      {newestFirst.length === 0 && (
        <div className="empty-state">
          <p>No charges yet. Tap + to log your first session.</p>
        </div>
      )}

      {newestFirst.map((t) => {
        const e = t.entry;
        const soc = e.startSoc !== undefined && e.endSoc !== undefined ? `${e.endSoc}% → ${e.startSoc}%` : '—';
        const perKwh = e.unitsKwh && e.unitsKwh > 0 ? e.costInr / e.unitsKwh : null;
        const eff =
          t.efficiencyKmPerKwh !== null
            ? `${fmtNum(t.efficiencyKmPerKwh, 2)} km/kWh`
            : t.efficiencyNote === 'unlogged-top-up'
              ? 'N/A · unlogged top-up'
              : 'N/A';
        return (
          <button key={e.id} className="log-card" onClick={() => onEdit(e)}>
            <div className="top">
              <span className="date">{e.date}</span>
              <span className={`pill ${e.chargerType ?? ''}`}>{e.chargerType ? CHARGER_LABELS[e.chargerType] : ''}</span>
            </div>
            <div className="top">
              <span className="muted">
                {fmtNum(e.odometerKm, 0)} km
                {t.tripKm > 0 && ` · +${fmtNum(t.tripKm, 0)} km`}
              </span>
              <span className="cost mono">{e.costInr === 0 ? 'Free' : fmtInr(e.costInr)}</span>
            </div>
            <div className="grid">
              <span>Battery <b>{soc}</b></span>
              <span>Added <b>{e.unitsKwh !== undefined ? `${fmtNum(e.unitsKwh, 2)} kWh` : '—'}</b></span>
              <span>Efficiency <b>{eff}</b></span>
              <span>₹/kWh <b>{perKwh === null ? '—' : `₹${fmtNum(perKwh, 2)}`}</b></span>
            </div>
            {e.notes && <div className="notes">{e.notes}</div>}
          </button>
        );
      })}
    </>
  );
}

interface MaintProps {
  entries: LogEntry[];
  onEdit: (entry: LogEntry) => void;
  onAdd: () => void;
}

export function MaintenanceList({ entries, onEdit, onAdd }: MaintProps) {
  const items = useMemo(
    () => sortByOdometer(entries.filter((e) => e.kind === 'maintenance')).reverse(),
    [entries]
  );
  const total = items.reduce((sum, e) => sum + e.costInr, 0);

  return (
    <>
      <div className="list-header">
        <h2>Maintenance</h2>
        <button className="add-btn" onClick={onAdd} aria-label="Log maintenance">+</button>
      </div>

      {items.length > 0 && (
        <div className="stat-card" style={{ marginBottom: 14 }}>
          <div className="label">Total maintenance</div>
          <div className="value mono">{fmtInr(total)}</div>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty-state">
          <p>No maintenance logged. Tap + to add a service, wash or repair.</p>
        </div>
      )}

      {items.map((e) => (
        <button key={e.id} className="log-card" onClick={() => onEdit(e)}>
          <div className="top">
            <span className="date">{e.date}</span>
            <span className="pill">Maintenance</span>
          </div>
          <div className="top">
            <span className="muted">{fmtNum(e.odometerKm, 0)} km</span>
            <span className="cost mono">{fmtInr(e.costInr)}</span>
          </div>
          {e.notes && <div className="notes">{e.notes}</div>}
        </button>
      ))}
    </>
  );
}
