/**
 * A person's headline growth over their record, worked out once for the person page's Overview and their Report
 * (P37), which gave two figures for the same person.
 *
 * Like for like across a reporting change (`factor`, queries `reportingAcross`): an Associate Professor's figure
 * read +55.2% while +27.0% of it was pay, the rest the Sep 2025 ×11/9 in how 9-month pay is reported. Where the
 * appointment percentage moved, actual pay moved with it, so the figure is the full-time rate's growth: a 0.5 FTE
 * Outreach Associate read "−28.9%" in red, of which the rate's share was −7.5% and the rest FTE going 0.65 → 0.2 →
 * 0.5. `fte` is null where no appointment records one (hourly), which never counts as a move.
 */
export function headlineGrowth(
  trend: readonly { salary: number | null; rate?: number | null; fte?: number | null }[],
  factor: number
) {
  const first = trend[0];
  const last = trend[trend.length - 1];
  const total = first?.salary && last?.salary ? (last.salary - first.salary) / first.salary : null;
  const rate = first?.rate && last?.rate ? (last.rate - first.rate) / first.rate : null;
  const payLfl = total != null ? (1 + total) / factor - 1 : null;
  const firstFte = first?.fte ?? null;
  const lastFte = last?.fte ?? null;
  const fteMoved = firstFte != null && lastFte != null && Math.abs(firstFte - lastFte) > 0.005;
  return { total, rate, payLfl, firstFte, lastFte, fteMoved, growth: fteMoved && rate != null ? (1 + rate) / factor - 1 : payLfl };
}
