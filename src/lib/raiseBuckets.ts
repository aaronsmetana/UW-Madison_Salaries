/**
 * One way to bucket raises, for every raise distribution on the site (Divisions → Changes and the
 * Reports raise cycle): 1% bins, a bin of its own for no change at all, and open-ended tails.
 *
 * Raises are binned as the site prints them (`fmtChange`): to a tenth of a percent, and under 0.05% as
 * "0%". A bin `k > 0` holds raises printed above (k−1)% up to k%; `k < 0` cuts printed below (k+1)% down
 * to k%; `0` holds pay that did not move. Binned raw, a pay-plan step split across two bars: Sep 2026's
 * 2.0% step, rounded to the cent — a $20.42 hourly rate became $20.83, +2.008% — put 2,156 of its 14,810
 * people in "+3%". 5% bins hid the pay-plan spikes (2%, 3%, 4%) inside one bar.
 */
export const RAISE_BIN_LO = -10;
export const RAISE_BIN_HI = 20;

/** Under this a change prints as "0%" (`fmtChange`): rounding in the source, not a raise. */
const ZERO = 0.0005;

/** A raise in percent as printed: to 0.1, halves away from zero. */
const printed = (r: number) => (Math.sign(r) * Math.floor(Math.abs(r) * 1000 + 0.5)) / 10;

export function raiseBucket(r: number): number {
  if (Math.abs(r) < ZERO) return 0;
  const pct = printed(r);
  if (pct > RAISE_BIN_HI) return RAISE_BIN_HI + 1;
  if (pct < RAISE_BIN_LO) return RAISE_BIN_LO - 1;
  return pct > 0 ? Math.ceil(pct - 1e-9) : Math.floor(pct + 1e-9);
}

/** The same bucket in SQL, for distributions computed in the database. */
export function raiseBucketSql(r: string): string {
  const pct = `(sign(${r}) * floor(abs(${r}) * 1000 + 0.5) / 10)`;
  return `CASE WHEN abs(${r}) < ${ZERO} THEN 0
     WHEN ${pct} > ${RAISE_BIN_HI} THEN ${RAISE_BIN_HI + 1}
     WHEN ${pct} < ${RAISE_BIN_LO} THEN ${RAISE_BIN_LO - 1}
     WHEN ${r} > 0 THEN CAST(ceil(${pct} - 1e-9) AS INTEGER)
     ELSE CAST(floor(${pct} + 1e-9) AS INTEGER) END`;
}

/** A bucket as its axis label: "0%", "+3%", "−2%", and the tails "> +20%" and "< −10%". */
export function raiseBucketLabel(k: number): string {
  if (k === 0) return '0%';
  if (k > RAISE_BIN_HI) return `> +${RAISE_BIN_HI}%`;
  if (k < RAISE_BIN_LO) return `< −${-RAISE_BIN_LO}%`;
  return k > 0 ? `+${k}%` : `−${-k}%`;
}

/** Every bucket from the lower tail to the upper, so an empty bin still takes its place on the axis. */
export function raiseBuckets(): number[] {
  const out: number[] = [];
  for (let k = RAISE_BIN_LO - 1; k <= RAISE_BIN_HI + 1; k++) out.push(k);
  return out;
}
