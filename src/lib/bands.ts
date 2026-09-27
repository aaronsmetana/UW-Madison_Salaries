import { REPORTING_CHANGES } from './queries';

/**
 * UW–Madison's published pay structure, as the app reads it (public/data/grades.json).
 *
 * A grade on a schedule has a range — a minimum and a maximum — or, for most of grades 51–99, a minimum
 * only: HR publishes a floor for them ("75% of Assistant Professor", "Research Intern") and no top. A
 * floor answers one question, whether a rate is below it; it has no midpoint, so no position in range,
 * compa-ratio or market floor.
 *
 * Every figure is in the units the newest data reports pay in: a full-time annual rate, with hourly pay
 * annualized over 2,080 hours and 9-month appointments at their 12-month equivalent (how the source has
 * reported them since Sep 2025).
 */
export interface GradeBand {
  grade: number;
  basis: string;
  min: number;
  /** null for a grade published with a minimum only. */
  max: number | null;
}

/** A band with a top: the only kind a position in range, a compa-ratio or a band bar can be read on. */
export type GradeRange = GradeBand & { max: number };
export const isRange = (b: GradeBand | null | undefined): b is GradeRange => !!b && b.max != null && b.max > b.min;

/**
 * The band for a graded appointment, in the units its own snapshot reports pay in.
 *
 * The published figures are in today's units. Before Sep 2025 the source reported a 9-month appointment
 * as its 9-month amount — the 12-month equivalent × 9/11, exactly HR's own "9-month" column — so a row
 * whose `comp_basis` is the older reporting reads the band scaled the same way (queries
 * `REPORTING_CHANGES`). Read unscaled, every such appointment sat a fifth below its grade.
 */
export function bandFor(
  grades: readonly GradeBand[] | null | undefined,
  grade: number | null | undefined,
  basis: string | null | undefined,
  compBasis?: string | null
): GradeBand | null {
  if (!grades || grade == null) return null;
  const g = grades.find((x) => x.grade === grade && x.basis === basis);
  if (!g) return null;
  const change = REPORTING_CHANGES.find((c) => c.from === compBasis?.trim().toLowerCase());
  if (!change) return g;
  const k = 1 / change.factor;
  return { ...g, min: g.min * k, max: g.max == null ? null : g.max * k };
}

/**
 * Whether a full-time rate is below a band's minimum — by more than HR's own rounding. HR publishes an
 * annual minimum to the dollar and an hourly one to the cent: an hourly worker paid exactly the published
 * $20.42 annualizes to $42,473.60, under the $42,481 annual figure, and is not below anything. Reading the
 * annual figure raw flagged 141 salaried and dozens of hourly appointments at the minimum as below it.
 */
export function belowMinimum(rate: number | null | undefined, band: GradeBand | null | undefined, basis: string | null | undefined): boolean {
  if (rate == null || !(rate > 0) || !band) return false;
  return rate < minimumAt(band.min, basis) - 0.005;
}

/** The lowest rate that is at `min`: the hourly minimum as published, annualized, or the dollar figure. */
export function minimumAt(min: number, basis: string | null | undefined): number {
  return basis === 'hourly' ? (Math.round((min / 2080) * 100) / 100) * 2080 : min - 0.5;
}

/** `belowMinimum` in SQL, for a rate, a band minimum and the appointment's schedule. */
export const belowMinimumSql = (rate: string, min: string, basis: string) =>
  `(${rate} > 0 AND ${rate} < (CASE WHEN ${basis} = 'hourly' THEN round(${min} / 2080, 2) * 2080 ELSE ${min} - 0.5 END) - 0.005)`;

/** `bandFor`'s reporting scale in SQL: what a band figure is multiplied by for a row's `comp_basis`. */
export const bandScaleSql = (compBasis: string) =>
  `(CASE lower(trim(${compBasis})) ${REPORTING_CHANGES.map((c) => `WHEN '${c.from}' THEN ${1 / c.factor}`).join(' ')} ELSE 1 END)`;
