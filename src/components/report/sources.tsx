import type { ReactNode } from 'react';
import { List, Text } from '@mantine/core';

// ── Citations — every reputable source the brief can footnote. Keep url text visible (not just an
//    href): a printed page can't be clicked. ──
export type CitationKey =
  | 'uwSalaryGuidelines' | 'bls' | 'wisStat' | 'uwHrGrades' | 'ufas'
  | 'workInstitute' | 'gallup' | 'cap';

export interface Citation { label: string; detail: string; url?: string }

export const CITATIONS: Record<CitationKey, Citation> = {
  uwSalaryGuidelines: {
    label: 'UW–Madison Office of Human Resources, Salary Administration Guidelines',
    detail: '"Supervisors or Managers and Subordinates" — at least a 15% pay differential between a supervisor/manager and a non-managing subordinate.',
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

// ── Policy — the UW Salary Administration Guidelines' own supervisory-differential rule, expressed
//    as data so the report can compute with it (not just quote it). ──
export const POLICY = {
  supervisorDifferential: 0.15, // "Supervisors or Managers and Subordinates"
  directorDifferential: 0.20, // "Directors or Managers and Subordinate Directors or Managers" (cited, not yet wired to a picker)
  /** The guideline's own formula: pay differential = (higher salary − lower salary) / lower salary. */
  payDifferential: (higher: number, lower: number): number => (higher - lower) / lower,
  supervisorQuote: 'At least 15% difference in pay between supervisors or managers and their non-managing subordinates.',
  source: 'uwSalaryGuidelines' as CitationKey,
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
            {c.url && <Text span c="dimmed"> {c.url}</Text>}
          </List.Item>
        );
      })}
    </List>
  );
}
