import { useSearchParams } from 'react-router-dom';
import { useControls } from '../state/controls';
import { useSummary } from './hooks';

export interface PeriodSnap {
  id: string;
  label: string;
  date: string;
}

/** The snapshot before `to` that a period starts at unless another is chosen: the last one dated earlier, so the
 *  Nov 2021 pair (one date) are not each other's "before". */
function defaultFrom(snaps: readonly PeriodSnap[], to: PeriodSnap | null): PeriodSnap | null {
  if (!to) return null;
  const earlier = snaps.slice(0, snaps.indexOf(to));
  return [...earlier].reverse().find((s) => s.date < to.date) ?? earlier[earlier.length - 1] ?? null;
}

/**
 * The Divisions page's one period (D1): the control bar's snapshot is its end and `?from=` its start, by default
 * the snapshot before. The figures' changes, the median growth, the Changes tab and the Trends tab's shading all
 * read this pair. It was three time controls and a fourth period: the bar's snapshot, two pickers inside the growth
 * tile, the Changes tab's From and To, and figures compared with the snapshot before.
 *
 * `setPeriod(from, to?)` moves the start, and the end with it where one is given; a start that is the default for
 * its end is left out of the address.
 */
export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const { activeSnapshot } = useControls();
  const { data: summary } = useSummary();
  const snaps: readonly PeriodSnap[] = summary?.snapshots ?? [];
  const latest = snaps[snaps.length - 1] ?? null;
  const to = (activeSnapshot ? snaps.find((s) => s.id === activeSnapshot) : null) ?? latest;
  const earlier = to ? snaps.slice(0, snaps.indexOf(to)) : [];
  const asked = params.get('from');
  const from = earlier.find((s) => s.id === asked) ?? defaultFrom(snaps, to);

  const setPeriod = (fromId: string | null, toId?: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        let end = to;
        if (toId !== undefined) {
          end = (toId ? snaps.find((s) => s.id === toId) : null) ?? latest;
          if (!end || end.id === latest?.id) n.delete('snap');
          else n.set('snap', end.id);
        }
        if (!fromId || fromId === defaultFrom(snaps, end)?.id) n.delete('from');
        else n.set('from', fromId);
        return n;
      },
      { replace: true }
    );

  return { snaps, from, to, earlier, setPeriod };
}
