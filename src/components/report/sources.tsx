import type { ReactNode } from 'react';
import { List, Text, Anchor } from '@mantine/core';

// ── Citations — every reputable source the brief can footnote. Keep url text visible (not just an
//    href): a printed page can't be clicked. ──
export type CitationKey =
  | 'uwSalaryGuidelines' | 'bls' | 'wisStat' | 'uwHrGrades' | 'ufas'
  | 'workInstitute' | 'gallup' | 'cap';

export interface Citation { label: string; detail: string; url?: string }

export const CITATIONS: Record<CitationKey, Citation> = {
  uwSalaryGuidelines: {
    label: 'UW–Madison Office of Human Resources, Salary Administration Guidelines',
    detail: 'Sections cited: Compression (≥5% non-exempt / ≥8% exempt differential for distinct experience differences); Supervisors or Managers and Subordinates (≥15%); Parity Adjustment; Market Adjustments (market-competitive range = 85%–115% compa-ratio / 25%–75% position-in-range); Performance Adjustments (generally 5–10%); Pay Plan Adjustments; Retention Bonus.',
    url: 'https://hr.wisc.edu/docs/compensation/salary-administration-guidelines.pdf',
  },
  bls: {
    label: 'U.S. Bureau of Labor Statistics',
    detail: 'Consumer Price Index for All Urban Consumers (CPI-U), U.S. city average, all items, series CUUR0000SA0.',
    url: 'https://www.bls.gov/cpi/',
  },
  wisStat: {
    label: 'Wisconsin Public Records Law',
    detail: 'Wis. Stat. §§ 19.31–19.39.',
    url: 'https://docs.legis.wisconsin.gov/statutes/statutes/19/ii',
  },
  uwHrGrades: {
    label: 'UW–Madison Office of Human Resources',
    detail: 'Salary structure / pay grades (Title & Total Compensation).',
    url: 'https://hr.wisc.edu/',
  },
  ufas: {
    label: 'United Faculty and Academic Staff (AFT Local 223)',
    detail: 'Source of the open-records requests this dataset is built from.',
    url: 'https://ufas223.org/',
  },
  workInstitute: {
    label: 'Work Institute, 2020 Retention Report',
    detail: 'Estimates the cost of replacing an employee at roughly one-third of their annual salary at the median.',
  },
  gallup: {
    label: 'Gallup (2019), "This Fixable Problem Costs U.S. Businesses $1 Trillion"',
    detail: 'Estimates replacement cost at one-half to two times annual salary for specialized or hard-to-fill roles.',
    url: 'https://www.gallup.com/workplace/247391/fixable-problem-costs-businesses-trillion.aspx',
  },
  cap: {
    label: 'Center for American Progress (2012), Boushey & Glynn',
    detail: '"There Are Significant Business Costs to Replacing Employees" — median replacement cost ≈ 21% of annual salary.',
    url: 'https://www.americanprogress.org/article/there-are-significant-business-costs-to-replacing-employees/',
  },
};

// ── Policy — the UW Salary Administration Guidelines' own rules, expressed as data so the report can
//    compute with them (not just quote them). Every quote below is verbatim from the published PDF. ──
export const POLICY = {
  supervisorDifferential: 0.15, // "Supervisors or Managers and Subordinates"
  directorDifferential: 0.20, // "Directors or Managers and Subordinate Directors or Managers" (cited, not yet wired to a picker)
  /** The guideline's own formula: pay differential = (higher salary − lower salary) / lower salary. */
  payDifferential: (higher: number, lower: number): number => (higher - lower) / lower,
  supervisorQuote: 'At least 15% difference in pay between supervisors or managers and their non-managing subordinates.',
  source: 'uwSalaryGuidelines' as CitationKey,

  // ── Compression — the guideline's suggested minimum differentials where two employees in the same or
  //    similar title have "distinct differences" in knowledge, skills, experience, and abilities. ──
  compressionDifferential: { exempt: 0.08, nonExempt: 0.05 },
  compressionQuote:
    'Compression exists when there is little difference in salary between employees who have distinct differences in their respective knowledge, skills, experience, abilities, and/or reporting structures or organizational structure stance.',
  // Our operationalization of the guideline's "distinct difference" example (a same-title employee with
  // 3 years of experience vs. one with 8): a peer with at least 5 fewer years of UW tenure. Footnoted.
  distinctExperienceGapYears: 5,
  /** The compression floor that applies to a given FLSA status (exempt → 8%, non-exempt → 5%). A null
   *  status falls back to the more conservative 5% (under-claims rather than over-claims). */
  compressionFloor: (exempt: boolean | null): number =>
    exempt === true ? 0.08 : 0.05,

  // ── Market Adjustments — "market competitive range is +/-15% of midpoint, which results in a range of
  //    85%–115% compa-ratio or 25%–75% PIR". Below it, "a market competitive pay request can be made". ──
  marketCompetitive: { compaLow: 0.85, compaHigh: 1.15, pirLow: 0.25, pirHigh: 0.75 },
  marketRequestQuote: 'a market competitive pay request can be made for OHR to review and approve',
  marketRangeQuote:
    'a competitive range of +/-15% of the salary grade or market midpoint, which is 85%–115% compa-ratio or 25%–75% PIR',
  /** The guideline's grade-position vocabulary, keyed off compa-ratio (compa takes precedence over PIR
   *  when the two disagree at a band edge). <85% Emerging, 85–115% Established, >115% Advanced. */
  gradePosition: (compa: number): 'Emerging in Grade' | 'Established in Grade' | 'Advanced in Grade' =>
    compa < 0.85 ? 'Emerging in Grade' : compa > 1.15 ? 'Advanced in Grade' : 'Established in Grade',

  // ── Performance Adjustments — "generally, a performance adjustment of 5-10% may be appropriate"; the
  //    annual-review matrix (performance level × position in grade). Ranges are [low, high] fractions. ──
  performanceAdjustment: {
    general: [0.05, 0.10] as const,
    // cols: Emerging / Established / Advanced in Grade (matches the guideline's own matrix)
    matrix: {
      exemplary: { emerging: [0.04, 0.06], established: [0.03, 0.05], advanced: [0.01, 0.03] },
      meets: { emerging: [0.03, 0.05], established: [0.02, 0.04], advanced: [0.00, 0.02] },
    },
  } as const,

  // ── Parity vs. Equity — the guideline reserves "equity adjustment" for protected-category inequities;
  //    the applicable request terms for a same-title imbalance are parity / compression adjustments. ──
  parityQuote:
    'Balanced salary relationships should be maintained for staff within the same job title or who perform comparable job duties, taking into consideration distinguishing factors such as performance, knowledge, skills, experience, and education/certification/licenses.',
  parityRemedyQuote: 'a parity or compression adjustment may be provided to rectify the situation',
  equityAdjustmentScope:
    'The guidelines reserve "equity adjustment" for inequities in categories protected by state and federal law (race, color, sex, national origin, age, disability, veteran status); the applicable request terms for a same-title imbalance are a parity or compression adjustment.',

  // ── Pay plan, retention & hiring bonuses — the guideline's other instruments (cited for context). ──
  payPlanQuote:
    "Pay plan adjustments are the Legislature's Joint Committee on Employment Relations (JCOER) approved compensation adjustments.",
  retentionBonusQuote:
    "This bonus can be awarded, when necessary, to retain a valuable employee (i.e., specialized skill set, consistently outstanding performer, etc.) when increasing the employee's salary is not advised due to parity, range consideration, etc.",
  hiringBonusMax: 0.15, // "The hiring bonus amount can be up to 15% of the proposed starting salary."
};

// ── Presentational: numbered footnote markers + the Notes/Sources lists that anchor them. ──

/** Superscript footnote marker linking to the Notes & Methodology list. Renders nothing when `n` is
 *  0 or less (the claim it would annotate isn't in this printing — see `ReportBrief`'s `fn()` helper). */
export function Sup({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <sup className="footnote-ref">
      <a href="#report-notes" aria-label={`note ${n}`}>{n}</a>
    </sup>
  );
}

/** Numbered "Notes & Methodology" list — one entry per computed claim actually rendered this printing. */
export function NotesList({ notes }: { notes: ReactNode[] }) {
  if (!notes.length) return null;
  return (
    <List id="report-notes" type="ordered" size="xs" c="dimmed" spacing={4} styles={{ item: { paddingLeft: 4 } }}>
      {notes.map((n, i) => <List.Item key={i}>{n}</List.Item>)}
    </List>
  );
}

/** Numbered "Sources" list — the citation's label + detail + a plainly-visible URL (print can't click). */
export function SourcesList({ ids }: { ids: CitationKey[] }) {
  if (!ids.length) return null;
  return (
    <List type="ordered" size="xs" c="dimmed" spacing={4} styles={{ item: { paddingLeft: 4 } }}>
      {ids.map((id) => {
        const c = CITATIONS[id];
        return (
          <List.Item key={id}>
            <Text span fw={600} c="dimmed">{c.label}.</Text> {c.detail}
            {/* URL shown as visible text (a printed page can't be clicked) but also linked on screen.
               print.css renders anchors as plain inherited text, so the printed page is unchanged. */}
            {c.url && <> <Anchor href={c.url} target="_blank" rel="noopener noreferrer" c="dimmed" inherit>{c.url}</Anchor></>}
          </List.Item>
        );
      })}
    </List>
  );
}
