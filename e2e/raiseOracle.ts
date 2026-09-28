import { PAY } from './oracle';

/**
 * Continuing raises on ACTUAL pay, stated independently of the app and of scripts/lib/raise-steps.mjs: the
 * same person with one paid appointment on each side, in the same job code at the same FTE, on a pay basis
 * that is the same quantity — unknown on either side counts, Annual → 12 Month is a relabel, and Academic →
 * 9 Month (the Sep 2025 reporting change) is not a raise.
 *
 * Between consecutive canonical snapshots (the Pre-TTC twin dropped), or with `pair` between exactly those
 * two. Defines the CTEs `snaps`, `one` and `cr` (fr, tt, dfr, dto, person_key, job, pay_from, pay_to, r) for
 * a query to continue: `${raisesCte()} SELECT … FROM cr`.
 */
export function raisesCte(pair?: { from: string; to: string }): string {
  const step = pair ? `a.snapshot_id = '${pair.from}' AND b.snapshot_id = '${pair.to}'` : 'sb.i = sa.i + 1';
  return `WITH snaps AS (SELECT snapshot_id, CAST(min(snapshot_date) AS VARCHAR) d,
                               row_number() OVER (ORDER BY min(snapshot_date), snapshot_id) i
                        FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1),
     one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(coalesce(nullif(fte, 0), 1)) f,
                    lower(any_value(comp_basis)) b, any_value(${PAY}) pay
             FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING count(*) = 1),
     cr AS (SELECT a.snapshot_id fr, b.snapshot_id tt, sa.d dfr, sb.d dto, a.person_key, a.job, a.pay pay_from, b.pay pay_to, b.pay / a.pay - 1 r
            FROM one a JOIN snaps sa USING (snapshot_id)
            JOIN one b ON b.person_key = a.person_key AND b.job = a.job AND b.f = a.f
            JOIN snaps sb ON sb.snapshot_id = b.snapshot_id
            WHERE ${step} AND a.job IS NOT NULL AND a.pay > 0 AND b.pay > 0
              AND (a.b IS NULL OR b.b IS NULL OR a.b = b.b OR (a.b = 'annual' AND b.b = '12 month')))`;
}
