import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Card, Group, Select, NumberInput, type ComboboxItem } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { useControls } from '../state/controls';
import { paidHeadcount } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { num } from '../lib/format';
import { dropdownProps } from '../lib/selectProps';
import { TitleStats } from '../components/TitleStats';
import { PageHeader } from '../components/PageHeader';

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
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || null;
  const school = params.get('sch') || null;
  const salStr = params.get('sal');
  const salaryNum = salStr ? Number(salStr) : NaN;
  const pinSalary = Number.isFinite(salaryNum) && salaryNum > 0 ? salaryNum : null;

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
      data: rows.map(({ value, label, disabled }) => ({ value, label, disabled })),
      counts: new Map<string, number | null>(rows.map((r) => [r.value, r.n])),
    };
  }, [schools, code, schoolCounts]);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Search title salaries"
        description="Pick a title to see its pay distribution, the people in it, and how it varies by school. Optionally filter to a school or enter a salary to pin where it lands. Any salary you enter stays in your browser."
      />

      <Card padding="lg">
        <Group align="flex-end" wrap="wrap" gap="xl">
          <Select
            {...dropdownProps('md')}
            label="Title"
            placeholder="Search titles…"
            data={titleOptions.data}
            renderOption={({ option }) => <DropdownCountRow option={option} counts={titleOptions.counts} />}
            value={code}
            onChange={(v) => setP('code', v)}
            searchable
            w={440}
            nothingFoundMessage="No matching title"
            rightSection={<IconChevronDown size={18} stroke={2} />}
          />
          <Select
            {...dropdownProps('md')}
            label="School (optional filter)"
            placeholder="All UW"
            data={schoolOptions.data}
            renderOption={({ option }) => <DropdownCountRow option={option} counts={schoolOptions.counts} />}
            value={school}
            onChange={(v) => setP('sch', v)}
            searchable
            clearable
            w={360}
          />
          <NumberInput
            size="md"
            label="Salary to pin (optional)"
            placeholder="e.g. 120000"
            value={salStr ? Number(salStr) : ''}
            onChange={(v) => setP('sal', typeof v === 'number' ? v : null)}
            min={0}
            step={1000}
            thousandSeparator=","
            prefix="$"
            w={200}
          />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Private — any salary you enter is never uploaded or stored.</Text>
      </Card>

      {!code || !snap ? (
        <Card withBorder padding="xl">
          <Text c="dimmed" ta="center">
            Pick a title above to see its salary distribution, pay by school, and everyone who holds it.
          </Text>
        </Card>
      ) : (
        <TitleStats jobCode={code} snap={snap} metric={metric} school={school} pinSalary={pinSalary} />
      )}
    </Stack>
  );
}
