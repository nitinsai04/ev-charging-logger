import { useMemo, useState } from 'react';
import { computeTrips, fmtInr, fmtNum } from './calc';
import { CHARGER_LABELS, type ChargerType, type EntryKind, type LogEntry, type Settings } from './types';

interface Props {
  initial: LogEntry | null; // null = new entry
  entries: LogEntry[]; // all live entries, for the live trip preview
  settings: Settings;
  defaultKind: EntryKind;
  onSave: (entry: LogEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

const toText = (n: number | undefined) => (n === undefined ? '' : String(n));

function parseOptional(s: string): number | undefined {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const CHARGER_CLASS: Record<ChargerType, string> = { home: 'home', dc_public: 'dc', ac_public: 'ac' };

export default function LogSheet({ initial, entries, settings, defaultKind, onSave, onDelete, onClose }: Props) {
  const [kind, setKind] = useState<EntryKind>(initial?.kind ?? defaultKind);
  const [date, setDate] = useState(initial?.date ?? today());
  const [charger, setCharger] = useState<ChargerType | undefined>(initial?.chargerType ?? 'home');
  const [odo, setOdo] = useState(toText(initial?.odometerKm));
  const [units, setUnits] = useState(toText(initial?.unitsKwh));
  const [cost, setCost] = useState(toText(initial?.costInr));
  const [startSoc, setStartSoc] = useState(toText(initial?.startSoc));
  const [endSoc, setEndSoc] = useState(toText(initial?.endSoc));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());

  const odometerNum = parseOptional(odo);
  const unitsNum = parseOptional(units);
  const costNum = parseOptional(cost);

  // Live preview uses the same engine as the dashboard.
  const preview = useMemo(() => {
    if (kind !== 'charge' || odometerNum === undefined || Number.isNaN(odometerNum)) return null;
    const draft: LogEntry = {
      id,
      kind: 'charge',
      date,
      odometerKm: odometerNum,
      chargerType: charger,
      unitsKwh: unitsNum === undefined || Number.isNaN(unitsNum) ? undefined : unitsNum,
      costInr: costNum === undefined || Number.isNaN(costNum) ? 0 : costNum,
      startSoc: parseOptional(startSoc),
      endSoc: parseOptional(endSoc),
      notes: '',
      updatedAt: '',
      deleted: false
    };
    const others = entries.filter((e) => e.id !== id);
    return computeTrips([...others, draft], settings).find((t) => t.entry.id === id) ?? null;
  }, [kind, odometerNum, date, charger, unitsNum, costNum, startSoc, endSoc, entries, settings, id]);

  const perKwh = costNum !== undefined && !Number.isNaN(costNum) && unitsNum && unitsNum > 0 ? costNum / unitsNum : null;

  function submit() {
    setError(null);
    if (!date) return setError('Pick a date.');
    if (odometerNum === undefined || Number.isNaN(odometerNum) || odometerNum < 0) {
      return setError('Enter the odometer reading in km.');
    }
    if (costNum === undefined || Number.isNaN(costNum) || costNum < 0) {
      return setError('Enter the cost in ₹. Use 0 for free charging.');
    }
    const now = new Date().toISOString();
    if (kind === 'maintenance') {
      return onSave({ id, kind, date, odometerKm: odometerNum, costInr: costNum, notes: notes.trim(), updatedAt: now, deleted: false });
    }
    if (!charger) return setError('Pick a charger type.');
    const s = parseOptional(startSoc);
    const e = parseOptional(endSoc);
    if ([s, e].some((v) => v !== undefined && (Number.isNaN(v) || v < 0 || v > 100))) {
      return setError('Battery % must be between 0 and 100.');
    }
    if (unitsNum !== undefined && (Number.isNaN(unitsNum) || unitsNum < 0)) {
      return setError('kWh must be a positive number.');
    }
    onSave({
      id,
      kind,
      date,
      odometerKm: odometerNum,
      chargerType: charger,
      unitsKwh: unitsNum,
      costInr: costNum,
      startSoc: s,
      endSoc: e,
      notes: notes.trim(),
      updatedAt: now,
      deleted: false
    });
  }

  const title = initial ? 'Edit entry' : kind === 'charge' ? 'Add charge' : 'Add maintenance';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <h2>{title}</h2>

        {!initial && (
          <div className="type-pills" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
            <button type="button" className={kind === 'charge' ? 'on' : ''} onClick={() => setKind('charge')}>Charge</button>
            <button type="button" className={kind === 'maintenance' ? 'on' : ''} onClick={() => setKind('maintenance')}>Maintenance</button>
          </div>
        )}

        {kind === 'charge' && (
          <div className="field">
            <span className="label-text">Charge type</span>
            <div className="type-pills">
              {(Object.keys(CHARGER_LABELS) as ChargerType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${charger === t ? 'on' : ''} ${CHARGER_CLASS[t]}`}
                  onClick={() => setCharger(t)}
                >
                  {CHARGER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="odo">Odometer (km)</label>
          <input id="odo" inputMode="decimal" value={odo} onChange={(ev) => setOdo(ev.target.value)} placeholder="e.g. 10181" />
          {preview && preview.tripKm > 0 && (
            <span className="hint">
              Trip since last entry <b className="mono" style={{ color: 'var(--mint)' }}>+{fmtNum(preview.tripKm, 0)} km</b>
              {preview.efficiencyKmPerKwh !== null && ` · ${fmtNum(preview.efficiencyKmPerKwh, 2)} km/kWh`}
              {preview.efficiencyNote === 'unlogged-top-up' && ' · N/A (unlogged top-up)'}
            </span>
          )}
          {preview && preview.tripKm <= 0 && (
            <span className="hint" style={{ color: 'var(--amber)' }}>
              Odometer must be higher than the previous entry.
            </span>
          )}
        </div>

        {kind === 'charge' && (
          <>
            <div className="row2">
              <div className="field">
                <label htmlFor="units">Units at charger (kWh)</label>
                <input id="units" inputMode="decimal" value={units} onChange={(ev) => setUnits(ev.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cost">Cost (₹)</label>
                <input id="cost" inputMode="decimal" value={cost} onChange={(ev) => setCost(ev.target.value)} placeholder="0 = free" />
                <span className="hint">₹/kWh {perKwh === null ? '—' : fmtInr(perKwh, 2)}</span>
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="start">Battery start (%)</label>
                <input id="start" inputMode="numeric" value={startSoc} onChange={(ev) => setStartSoc(ev.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="end">Battery finish (%)</label>
                <input id="end" inputMode="numeric" value={endSoc} onChange={(ev) => setEndSoc(ev.target.value)} />
              </div>
            </div>
          </>
        )}

        {kind === 'maintenance' && (
          <div className="field">
            <label htmlFor="mcost">Cost (₹)</label>
            <input id="mcost" inputMode="decimal" value={cost} onChange={(ev) => setCost(ev.target.value)} />
          </div>
        )}

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            placeholder={kind === 'charge' ? 'Charger network, trip note' : 'What was done'}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="btn-row" style={{ marginTop: 6 }}>
          <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>Save</button>
        </div>

        {initial && (
          <button
            className="btn danger"
            type="button"
            style={{ marginTop: 10 }}
            onClick={() => {
              if (window.confirm('Delete this entry?')) onDelete(initial.id);
            }}
          >
            Delete entry
          </button>
        )}
      </div>
    </div>
  );
}
