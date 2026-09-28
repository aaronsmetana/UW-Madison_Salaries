/**
 * Title categories: the job group a title belongs to, read off the letters its job code starts with.
 *
 * Every title since the Title & Total Compensation study carries a code like IT031 or RE042 — two letters
 * and a number — and the letters are its job group: all 140 IT codes are information-technology titles,
 * all RE codes research titles. HR publishes the groups by name (hr.wisc.edu, "Job Groups & Sub-Groups")
 * but not their letters, so each pair below was matched from the titles that carry it. One pair covers two
 * of HR's groups: IC holds the clinical and CHS professor titles (Clinical Faculty) and the adjunct and
 * visiting ones (Instructional Category), and is named for both.
 *
 * The Pre-TTC twin's codes (X01NN, 94680) have no such letters and belong to no group here.
 */
export const JOB_FAMILIES: Readonly<Record<string, string>> = {
  AD: 'Administration',
  AE: 'Academic Services and Student Experience',
  AN: 'Animal Care Services',
  AR: 'Arts',
  AT: 'Athletics',
  AV: 'Advancement Services',
  CC: 'Category C',
  CM: 'Communications and Marketing',
  CP: 'Compliance, Legal and Protection',
  DS: 'Dining, Events, Hospitality Services, and Sales',
  EI: 'Diversity, Equity and Inclusion',
  EX: 'Executive',
  FA: 'Faculty',
  FN: 'Finance',
  FP: 'Facilities and Capital Planning',
  HR: 'Human Resources',
  HS: 'Health and Wellness Services',
  IC: 'Clinical Faculty and Instructional Category',
  IT: 'Information Technology',
  LM: 'Libraries, Archives and Museums',
  OE: 'Outreach and Community Engagement',
  PB: 'Public Broadcasting',
  PD: 'Post Degree Training',
  RE: 'Research',
  SA: 'Student Assistant',
  SC: 'Sponsored Programs, Grants and Contracts',
  TE: 'Temporary Employee',
  TL: 'Teaching and Learning',
};

/** A TTC job code's group letters: "IT031" → "IT". Null for a code without them. */
export function familyOf(jobCode: string | null | undefined): string | null {
  return jobCode?.match(/^([A-Z]{2})\d/)?.[1] ?? null;
}

/** `familyOf` in SQL: the group letters of a job-code column, or NULL. */
export const familySql = (col: string) => `nullif(regexp_extract(${col}, '^([A-Z]{2})[0-9]', 1), '')`;

/**
 * A group as a picker shows it: HR's name and its letters, "Information Technology (IT)". A group HR does
 * not list says what it holds instead — its letters and its largest title — rather than a guess at a name.
 */
export function familyLabel(code: string, largestTitle?: string | null): string {
  const name = JOB_FAMILIES[code];
  if (name) return `${name} (${code})`;
  return largestTitle ? `${code} (${largestTitle} and others)` : code;
}
