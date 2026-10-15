import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Group, Paper, SimpleGrid, Stack, Text, Title, type AnchorProps } from '@mantine/core';
import { Eyebrow } from '../Eyebrow';

/**
 * What the About-the-data page's tabs share: its tabs and which holds each section, the two pay views, the
 * fields a record shows and never holds, and a list of rules (a term beside its explanation).
 */

export type AboutTab = 'overview' | 'accuracy' | 'method' | 'ranges' | 'snapshots' | 'renames';

export const ABOUT_TABS: { value: AboutTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'accuracy', label: 'Accuracy & privacy' },
  { value: 'method', label: 'How it’s built' },
  { value: 'ranges', label: 'Salary ranges' },
  { value: 'snapshots', label: 'Snapshots' },
  { value: 'renames', label: 'Renames & duplicates' },
];

/**
 * Every section's tab, by its id. A link to `/data#<id>` — the old page's eleven "Jump to" anchors, a pay band's
 * "salary structure", a person's "TTC", the matching rule — opens the tab that holds it and lands on it.
 */
export const SECTION_TAB: Record<string, AboutTab> = {
  'whats-new': 'overview', source: 'overview', rely: 'overview', 'pay-views': 'overview', 'privacy-summary': 'overview', 'pipeline-summary': 'overview',
  disclaimer: 'accuracy', 'leaves-out': 'accuracy', describes: 'accuracy', 'source-changed': 'accuracy', identity: 'accuracy', privacy: 'accuracy',
  pipeline: 'method', 'how-it-works': 'method', methodology: 'method',
  'salary-ranges': 'ranges', 'range-chart': 'ranges', 'minimum-only': 'ranges', 'band-rules': 'ranges',
  'snapshot-glance': 'snapshots', snapshots: 'snapshots', ttc: 'snapshots', 'scope-change': 'snapshots', mapping: 'snapshots',
  departments: 'renames', duplicates: 'renames',
};

/** A link to a section of this page by its id, on whichever tab holds it (`SECTION_TAB`): the address's hash
 *  chooses the tab, and the page lands on the section. */
export function SectionLink({ id, children, ...rest }: { id: string; children: ReactNode } & AnchorProps) {
  return <Anchor component={Link} to={{ pathname: '/data', hash: `#${id}` }} {...rest}>{children}</Anchor>;
}

/** The columns one appointment row carries. Kept here so the count a label gives can't drift from the list,
 *  and `data-about.spec.ts` checks it against the manifest. */
export const RECORD_FIELDS = [
  'name', 'title', 'job code', 'school', 'department', 'grade', 'basis', 'salary',
  'FTE-adjusted salary', 'base pay', 'FTE', 'pay-rate type', 'FLSA status',
  'employee category', 'employee type', 'hire date',
] as const;

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** A static file's size from a HEAD request, so a download button can say what it hands over. */
export function useFileSize(url: string): string | null {
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const len = r.headers.get('content-length');
        if (!cancelled && len) setSize(formatBytes(Number(len)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return size;
}

/** One pay view: its name, its formula in the mono register, and what it is for. */
function PayView({ title, formula, children }: { title: string; formula: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md" className="pay-view">
      <Group justify="space-between" align="baseline" gap="xs" wrap="wrap">
        <Title order={3} fz="md" fw={650}>{title}</Title>
        <code className="formula-pill">{formula}</code>
      </Group>
      <Text size="sm" c="dimmed" mt={6}>{children}</Text>
    </Paper>
  );
}

/** The two ways the Pay control reads pay — the same two the Overview sums up and How it's built details. */
export function PayViews() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" className="pay-views">
      <PayView title="Actual pay" formula="rate × FTE">
        Closest to what the person was paid. Hourly staff with no FTE on file count at their full listed rate.
      </PayView>
      <PayView title="Full-time rate" formula="listed annual rate">
        What the role pays at 100%. For part-time staff this is more than they earned. Pay bands and same-title
        rankings use it.
      </PayView>
    </SimpleGrid>
  );
}

const SHOWN = ['Name', 'Title', 'Department', 'School', 'Pay', 'FTE', 'Hire date'];
const NEVER = ['Home address', 'Contact details', 'ID numbers', 'Demographics'];

/** What a record shows, as released, and what is never collected — the second set in dashed chips. */
export function RecordChips({ shownLabel = 'Shown, as released', note }: { shownLabel?: string; note?: ReactNode }) {
  return (
    <Stack gap={8} className="record-chips">
      <Eyebrow>{shownLabel}</Eyebrow>
      <Group gap={6} wrap="wrap" className="record-chips-shown">
        {SHOWN.map((s) => <span key={s} className="field-chip">{s}</span>)}
      </Group>
      <Eyebrow style={{ marginTop: 4 }}>Never collected</Eyebrow>
      <Group gap={6} wrap="wrap" className="record-chips-never">
        {NEVER.map((s) => <span key={s} className="field-chip field-chip-never">{s}</span>)}
      </Group>
      {note && <Text size="xs" c="dimmed" mt={2}>{note}</Text>}
    </Stack>
  );
}

export interface Rule { id?: string; term: ReactNode; text: ReactNode; link?: ReactNode }

/** Rules as rows: the term in bold beside its explanation, and a link where one leads on. */
export function RuleRows({ rows, className }: { rows: Rule[]; className?: string }) {
  return (
    <dl className={`rule-rows${className ? ` ${className}` : ''}`}>
      {rows.map((r, i) => (
        <div key={i} className="rule-row" id={r.id}>
          <dt>{r.term}</dt>
          <dd>{r.text}{r.link && <> {r.link}</>}</dd>
        </div>
      ))}
    </dl>
  );
}
