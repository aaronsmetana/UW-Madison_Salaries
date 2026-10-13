import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Group, Select, type ComboboxItem } from '@mantine/core';
import { IconChevronDown, IconChartHistogram } from '@tabler/icons-react';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { useControls } from '../state/controls';
import { paidHeadcount } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { num, fmtGrade, legacyTitle } from '../lib/format';
import { CATEGORY_SPELLINGS } from '../lib/timeline';
import { ICON } from '../lib/ui';
import { dropdownProps } from '../lib/selectProps';
import { TitleStats } from '../components/TitleStats';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ToolLinks } from '../components/ToolLinks';
import { CopyLinkButton } from '../components/CopyLinkButton';
import { PayMeasure } from '../components/PayMeasure';
import { useDocTitle } from '../lib/useDocTitle';
import { useCrumbs } from '../app/PageTop';
import { PinInput } from '../components/PinInput';

/** The school picker's "every school" choice: a value of its own, so "All UW" reads as chosen (T3). It was the
 *  field's placeholder, grey, and the field looked switched off. */
const ALL_UW = '__all__';

/** A dropdown row: name on the left, the member count right-aligned (dimmed), or a compact "none"
 *  for options where no one matches the active filter (Mantine greys the disabled row itself). */
function DropdownCountRow({ option, counts }: { option: ComboboxItem; counts: Map<string, number | null> }) {
  const n = counts.get(option.value);
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
      <Text size="sm" lineClamp={1}>{option.label}</Text>
      {option.disabled ? (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>none</Text>
      ) : n != null ? (
        <Text size="sm" c="dimmed" fw={500} style={{ flexShrink: 0 }}>{num(n)}</Text>
      ) : null}
    </Group>
  );
}

export default function PayCheck() {
  useDocTitle('Titles');
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || null;
  const school = params.get('sch') || null;

  // The pinned salary is deliberately NOT in the URL, unlike `code` and `sch`. This page promises the
  // figure you type "is never uploaded or stored", and a query parameter breaks that promise in three
  // places at once: it lands in browser history, it rides along in any link you copy or share, and —
  // because GitHub Pages has no rewrite and deep links bounce through public/404.html — it ends up in
  // a request URL sent to GitHub's servers. Component state keeps the claim literally true. Nobody
  // wants to share their own salary in a link anyway, so nothing of value is lost.
  const [pinSalary, setPinSalary] = useState<number | null>(null);

  const snap = useActiveSnapshotId();
  const { metric } = useControls();

  const setP = (k: string, v: string | number | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v === null || v === '') n.delete(k);
        else n.set(k, String(v));
        return n;
      },
      { replace: true }
    );

  const { data: titles } = useSql<{ job_code: string; title: string; n: number }>(
    ['pc-titles', snap ?? '', metric],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );
  // A title open here is a place of its own: "Titles / System Engineer IV".
  const codeRow = code ? titles?.find((t) => t.job_code === code) : undefined;
  const codeTitle = codeRow?.title ? legacyTitle(codeRow.title) : undefined;
  useCrumbs(code && codeTitle ? [{ label: 'Titles', to: '/titles' }, { label: codeTitle }] : []);
  // What the title is, for the line under its name (T1): its grade (the most common, where appointments differ,
  // as TitleStats reads its band) and its employee category.
  const { data: metaRows } = useSql<{ cat: string | null; grade_number: number | null; grade_basis: string | null }>(
    ['pc-meta', snap ?? '', code ?? ''],
    `WITH t AS (SELECT employee_category, grade_number, grade_basis FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(code ?? '')} AND salary > 0),
      g AS (SELECT grade_number, grade_basis FROM t WHERE grade_number IS NOT NULL
        GROUP BY grade_number, grade_basis ORDER BY count(*) DESC, grade_number LIMIT 1)
     SELECT (SELECT employee_category FROM t WHERE employee_category IS NOT NULL
               GROUP BY employee_category ORDER BY count(*) DESC, employee_category LIMIT 1) cat,
            (SELECT grade_number FROM g) grade_number, (SELECT grade_basis FROM g) grade_basis`,
    !!snap && !!code
  );
  const meta = metaRows?.[0];
  const metaLine = code && codeRow
    ? [
        code,
        meta?.grade_number != null ? `grade ${fmtGrade(meta.grade_number)}` : null,
        meta?.cat ? CATEGORY_SPELLINGS[meta.cat] ?? meta.cat : null,
        `${num(codeRow.n)} ${codeRow.n === 1 ? 'person' : 'people'}`,
      ].filter(Boolean).join(' · ')
    : null;
  const { data: schools } = useSql<{ school: string }>(
    ['pc-schools', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );
  // Per-school counts for the selected title, and per-title counts in the selected school — used to
  // annotate / grey out non-applicable options in the opposite dropdown so empty combos are obvious.
  const { data: schoolCounts } = useSql<{ school: string; n: number }>(
    ['pc-school-counts', snap ?? '', code ?? '', metric],
    `SELECT school, ${paidHeadcount(metric)} n FROM salaries
     WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(code ?? '')} AND school IS NOT NULL
     GROUP BY school`,
    !!snap && !!code
  );
  const { data: titleCounts } = useSql<{ job_code: string; n: number }>(
    ['pc-title-counts', snap ?? '', school ?? '', metric],
    `SELECT job_code, ${paidHeadcount(metric)} n FROM salaries
     WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school = ${sqlStr(school ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code`,
    !!snap && !!school
  );

  // Titles: label is just the searchable "Title (CODE)"; the count (in-school when a school is filtered,
  // else the UW headcount) rides along in `counts` for the right-aligned renderOption. Available first.
  const titleOptions = useMemo(() => {
    const base = titles ?? [];
    const inSchool = school && titleCounts ? new Map(titleCounts.map((r) => [r.job_code, r.n])) : null;
    const rows = base
      .map((t) => {
        const n = inSchool ? (inSchool.get(t.job_code) ?? 0) : t.n;
        return { value: t.job_code, label: `${t.title} (${t.job_code})`, n, disabled: inSchool ? n === 0 : false, _uw: t.n };
      })
      .sort((a, b) => b.n - a.n || b._uw - a._uw);
    return {
      data: rows.map(({ value, label, disabled }) => ({ value, label, disabled })),
      counts: new Map<string, number | null>(rows.map((r) => [r.value, r.n])),
    };
  }, [titles, school, titleCounts]);

  // Schools: label is the school name; the in-title count rides in `counts` (only when a title is picked).
  // "All UW" first, counted with the title's whole headcount.
  const schoolOptions = useMemo(() => {
    const all = (schools ?? []).map((s) => s.school);
    const inTitle = code && schoolCounts ? new Map(schoolCounts.map((r) => [r.school, r.n])) : null;
    const rows = all
      .map((s) => {
        const n = inTitle ? (inTitle.get(s) ?? 0) : null;
        return { value: s, label: s, n, disabled: inTitle ? n === 0 : false };
      })
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.value.localeCompare(b.value));
    return {
      data: [{ value: ALL_UW, label: 'All UW', disabled: false }, ...rows.map(({ value, label, disabled }) => ({ value, label, disabled }))],
      counts: new Map<string, number | null>([[ALL_UW, codeRow?.n ?? null], ...rows.map((r) => [r.value, r.n] as [string, number | null])]),
    };
  }, [schools, code, schoolCounts, codeRow]);

  return (
    <Stack gap="lg">
      {/* The title is the page's heading once one is chosen (T1), what it is on the line under it, and the page's
          controls one compact row beneath (T2): a three-field form card, the measure and a privacy paragraph came
          before the first number. The raises link is one of the header's actions (T14). */}
      <PageHeader
        eyebrow={code ? 'Titles' : undefined}
        title={code ? (codeTitle ?? code) : 'Titles'}
        meta={metaLine ?? undefined}
        description={code ? undefined : 'Pick a job title to see what it pays across UW–Madison: the full range, who holds it, and how it varies by school.'}
        right={(
          <Group gap="sm" wrap="wrap" className="title-actions">
            {code && (
              <ToolLinks asButtons links={[{ label: 'Raises in this title', to: `/raises?title=${encodeURIComponent(code)}${school ? `&sch=${encodeURIComponent(school)}` : ''}` }]} />
            )}
            <CopyLinkButton size="sm" />
          </Group>
        )}
      />

      <Group align="flex-start" wrap="wrap" gap="md" className="title-controls">
        <Select
          {...dropdownProps('sm')}
          label="Title"
          placeholder="Search titles…"
          data={titleOptions.data}
          renderOption={({ option }) => <DropdownCountRow option={option} counts={titleOptions.counts} />}
          value={code}
          onChange={(v) => setP('code', v)}
          searchable
          // ~1,300 titles, each rendered through a custom renderOption. Mantine mounts every option
          // when no limit is set, so opening this dropdown built ~1,300 DOM subtrees before showing
          // anything. The field is searchable, so the full set stays reachable by typing.
          limit={50}
          w={360}
          maw="100%"
          nothingFoundMessage="No matching title"
          rightSection={<IconChevronDown size={ICON.control} stroke={2} />}
        />
        <Select
          {...dropdownProps('sm')}
          label="School"
          data={schoolOptions.data}
          renderOption={({ option }) => <DropdownCountRow option={option} counts={schoolOptions.counts} />}
          value={school ?? ALL_UW}
          onChange={(v) => setP('sch', !v || v === ALL_UW ? null : v)}
          allowDeselect={false}
          searchable
          w={280}
          maw="100%"
          rightSection={<IconChevronDown size={ICON.control} stroke={2} />}
        />
        <PinInput value={pinSalary} onApply={setPinSalary} />
        {/* Level with the fields, under their labels' line. */}
        <div className="title-measure" style={{ marginTop: 25 }}><PayMeasure /></div>
      </Group>

      {!code || !snap ? (
        <EmptyState
          icon={<IconChartHistogram size={ICON.feature} />}
          title="No title selected"
          hint="Choose a title above to see its salary distribution, pay by school, and everyone who holds it."
        />
      ) : (
        <>
          <TitleStats jobCode={code} snap={snap} metric={metric} school={school} pinSalary={pinSalary} />
        </>
      )}
    </Stack>
  );
}
