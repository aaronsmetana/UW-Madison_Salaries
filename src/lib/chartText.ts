/** Wrap a chart label onto at most two balanced lines (≤maxLine chars each) so it reads without
 *  truncation when it fits, and degrades to an ellipsis (rather than overflowing the chart) when it
 *  can't be split short enough — e.g. one long unbroken word. */
export function wrapChartTitle(s: string, maxLine = 26): string[] {
  const words = s.split(/\s+/);
  if (s.length <= 20 || words.length === 1) {
    return s.length <= maxLine ? [s] : [`${s.slice(0, maxLine - 1)}…`];
  }
  let best: string[] | null = null;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) <= maxLine && Math.abs(a.length - b.length) < bestDiff) {
      best = [a, b];
      bestDiff = Math.abs(a.length - b.length);
    }
  }
  if (best) return best;
  const mid = Math.ceil(words.length / 2);
  const a = words.slice(0, mid).join(' ');
  const b = words.slice(mid).join(' ');
  const clip = (line: string) => (line.length <= maxLine ? line : `${line.slice(0, maxLine - 1)}…`);
  return [clip(a), clip(b)];
}
