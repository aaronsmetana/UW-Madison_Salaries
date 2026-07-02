/** Plain-language definitions for HR/payroll jargon shown around the app — this audience is union
 *  members looking up their own or a colleague's pay, not HR analysts. */
export const GLOSSARY = {
  ttc: 'Title & Total Compensation — a 2021 UW System-wide restructuring that renamed and reclassified nearly every job title and grade at once. Treat title changes right at that boundary as relabels, not promotions.',
  flsa: 'Fair Labor Standards Act status. "Exempt" employees are not eligible for overtime pay; "Non-Exempt" employees are.',
  fte: 'Full-Time Equivalent — the share of a full-time appointment this role represents (1.00 = full-time, 0.5 = half-time). Actual pay scales by FTE; the "rate" shown elsewhere is always the full-time-equivalent salary.',
  grade: "The university's official pay-grade/band classification, which sets a minimum and maximum salary for the role.",
  basis: 'The compensation period the salary rate is based on — e.g. a 12-month/annual appointment vs. a 9-month/academic-year one.',
  percentile: 'The share of a comparison group this person is paid more than. Being at the 75th percentile means being paid more than 75% of that group.',
  actualPay: 'What was actually paid for the appointment — the full-time rate scaled by FTE (appointment %).',
  rate: 'The full-time-equivalent salary for the role, before scaling by FTE — what a full-time (100% FTE) appointment would pay.',
  tenure: 'Years since this person was hired, based on their recorded date of hire.',
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
