import { useMemo } from 'react';
import { computeTrips, fmtInr } from './calc';
import type { LogEntry, Settings } from './types';

interface Props {
  entries: LogEntry[];
  settings: Settings;
}

/** Cumulative savings against the petrol benchmark, one point per charging trip. */
export default function SavingsChart({ entries, settings }: Props) {
  const points = useMemo(() => {
    let running = 0;
    return computeTrips(entries, settings).map((t) => {
      running += t.savingsInr;
      return { date: t.entry.date, value: running };
    });
  }, [entries, settings]);

  if (points.length < 2) {
    return (
      <div className="muted" style={{ padding: '18px 0' }}>
        Log at least two charges to see savings build up.
      </div>
    );
  }

  const W = 320;
  const H = 150;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 22;
  const values = points.map((p) => p.value);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const span = maxV - minV || 1;
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - minV) / span) * (H - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const base = y(minV).toFixed(1);
  const area = `${line} L${x(points.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  const last = points[points.length - 1];
  const lastX = x(points.length - 1);
  const lastY = y(last.value);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative savings over time">
      <defs>
        <linearGradient id="savingsFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--mint)', stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: 'var(--mint)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--border)' }} strokeDasharray="3 4" />
      <path d={area} fill="url(#savingsFill)" />
      <path
        d={line}
        fill="none"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ stroke: 'var(--mint)' }}
      />
      <circle cx={lastX} cy={lastY} r="4.5" strokeWidth="2" style={{ fill: 'var(--mint)', stroke: 'var(--surface)' }} />
      <text x={lastX} y={lastY - 10} textAnchor="end" fontSize="11" fontWeight="700" style={{ fill: 'var(--mint)' }}>
        {fmtInr(last.value)}
      </text>
      <text x={padL} y={H - 4} fontSize="10" style={{ fill: 'var(--text-dim)' }}>
        {points[0].date}
      </text>
      <text x={W - padR} y={H - 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--text-dim)' }}>
        {last.date}
      </text>
    </svg>
  );
}
