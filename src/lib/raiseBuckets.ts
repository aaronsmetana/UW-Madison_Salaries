/**
 * One way to bucket raises, for every raise distribution on the site (Divisions → Changes and the
 * Reports raise cycle): 1% bins, a bin of its own for no change at all, and open-ended tails.
 *
 * A bin `k > 0` holds raises above (k−1)% up to k%; `k < 0` holds cuts below (k+1)% down to k%; `0`
 * holds exactly no change, which under the continuing-raise rule is genuine stagnation. 5% bins hid
 * the pay-plan spikes (2%, 3%, 4%) inside one bar.
 */
export const RAISE_BIN_LO = -10;
export const RAISE_BIN_HI = 20;

/** Changes this small are rounding in the source, not a raise. */
const ZERO = 0.00005;

export function raiseBucket(r: number): number {
  if (Math.abs(r) < ZERO) return 0;
  const pct = r * 100;
  if (pct > RAISE_BIN_HI) return RAISE_BIN_HI + 1;
  if (pct < RAISE_BIN_LO) return RAISE_BIN_LO - 1;
  return r > 0 ? Math.ceil(pct - 1e-9) : Math.floor(pct + 1e-9);
}

/** The same bucket in SQL, for distributions computed in the database. */
export function raiseBucketSql(r: string): string {
  return `CASE WHEN abs(${r}) < ${ZERO} THEN 0
     WHEN ${r} * 100 > ${RAISE_BIN_HI} THEN ${RAISE_BIN_HI + 1}
     WHEN ${r} * 100 < ${RAISE_BIN_LO} THEN ${RAISE_BIN_LO - 1}
     WHEN ${r} > 0 THEN CAST(ceil(${r} * 100 - 1e-9) AS INTEGER)
     ELSE CAST(floor(${r} * 100 + 1e-9) AS INTEGER) END`;
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
