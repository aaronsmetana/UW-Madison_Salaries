/**
 * CPI-U (Consumer Price Index for All Urban Consumers, U.S. city average, all items, NSA) annual
 * averages, used to express a past year's salary in today's purchasing power ("real dollars").
 *
 * 2021–2024 are BLS's published annual averages (bls.gov/cpi — historical-cpi-u supplemental
 * files). 2025 and 2026 aren't full published annual averages yet — 2025 had a data-collection
 * gap (Oct/Nov, 2025 lapse in appropriations) and 2026 is a partial year — so both are approximated
 * by applying BLS's reported year-over-year inflation rates (~2.6% avg for 2025; ~4.2% for the
 * 12 months ending May 2026) forward from the prior year. Treat any figure using a 2025/2026 base
 * as approximate; re-derive once BLS publishes final annual averages.
 */
const CPI_U_ANNUAL: Record<number, number> = {
  2021: 270.97,
  2022: 292.655,
  2023: 304.702,
  2024: 313.689,
  2025: 321.85, // approx (see file comment)
  2026: 335.4, // approx (see file comment)
};

const YEARS = Object.keys(CPI_U_ANNUAL).map(Number);
export const REAL_BASE_YEAR = Math.max(...YEARS);
const MIN_YEAR = Math.min(...YEARS);

/** Converts `amount` earned in `fromYear` to its equivalent purchasing power in REAL_BASE_YEAR dollars. */
export function toReal(amount: number, fromYear: number): number {
  const clamped = Math.min(REAL_BASE_YEAR, Math.max(MIN_YEAR, Math.round(fromYear)));
  return amount * (CPI_U_ANNUAL[REAL_BASE_YEAR] / CPI_U_ANNUAL[clamped]);
}
