import { usd } from '../lib/format';
import { MARK_CURRENT, MARK_TARGET, MarkerLegend } from './markers';

const MARK_MEDIAN = 'var(--mantine-color-gray-6)'; // median — neutral reference

/**
 * Dead-simple pay scale for the negotiation document: a single horizontal line with three labelled
 * markers — current, median, and target — so the gap to close reads at a glance. Any null marker is
 * skipped. Replaces the denser bullet charts on the salary-justification report.
 */
export function SalaryLine({
  current,
  median,
  target,
}: {
  current: number | null;
  median: number | null;
  target: number | null;
}) {
  const vals = [current, median, target].filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1; // headroom so end markers aren't on the edge
  const min = lo - pad;
  const max = hi + pad;
  const at = (x: number) => Math.max(0, Math.min(1, (x - min) / (max - min))) * 100;
  const H = 6;

  const dot = (x: number, color: string, z: number) => (
    <div
      style={{
        position: 'absolute',
        left: `${at(x)}%`,
        top: '50%',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: color,
        border: '2px solid var(--mantine-color-body)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
        transform: 'translate(-50%, -50%)',
        zIndex: z,
      }}
    />
  );

  return (
    <div>
      <div style={{ position: 'relative', height: 22 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: H,
            borderRadius: H / 2,
            background: 'var(--mantine-color-gray-3)',
            transform: 'translateY(-50%)',
          }}
        />
        {median != null && dot(median, MARK_MEDIAN, 1)}
        {current != null && dot(current, MARK_CURRENT, 2)}
        {target != null && dot(target, MARK_TARGET, 3)}
      </div>
      <MarkerLegend
        items={[
          ...(current != null ? [{ color: MARK_CURRENT, round: true, label: `Current ${usd(current)}` }] : []),
          ...(median != null ? [{ color: MARK_MEDIAN, round: true, label: `Median ${usd(median)}` }] : []),
          ...(target != null ? [{ color: MARK_TARGET, round: true, label: `Target ${usd(target)}` }] : []),
        ]}
      />
    </div>
  );
}
