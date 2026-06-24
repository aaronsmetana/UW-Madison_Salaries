import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Card, Group, Select, NumberInput } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { useControls } from '../state/controls';
import { paidHeadcount } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { num } from '../lib/format';
import { dropdownProps } from '../lib/selectProps';
import { TitleStats } from '../components/TitleStats';
import { PageHeader } from '../components/PageHeader';

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

  const titleData = useMemo(() => {
    const base = titles ?? [];
    if (!school || !titleCounts) {
      return base.map((t) => ({ value: t.job_code, label: `${t.title} (${t.job_code} · ${num(t.n)})` }));
    }
    const m = new Map(titleCounts.map((r) => [r.job_code, r.n]));
    return base
      .map((t) => {
        const n = m.get(t.job_code) ?? 0;
        return {
          value: t.job_code,
          label: n > 0 ? `${t.title} (${t.job_code} · ${num(n)})` : `${t.title} (${t.job_code}) · none in ${school}`,
          disabled: n === 0,
          _n: n,
          _uw: t.n,
        };
      })
      .sort((a, b) => b._n - a._n || b._uw - a._uw)
      .map(({ value, label, disabled }) => ({ value, label, disabled }));
  }, [titles, school, titleCounts]);

  const schoolData = useMemo(() => {
    const all = (schools ?? []).map((s) => s.school);
    if (!code || !schoolCounts) return all.map((s) => ({ value: s, label: s }));
    const m = new Map(schoolCounts.map((r) => [r.school, r.n]));
    return all
      .map((s) => {
        const n = m.get(s) ?? 0;
        return { value: s, label: n > 0 ? `${s} · ${num(n)}` : `${s} · no one with this title`, disabled: n === 0, _n: n };
      })
      .sort((a, b) => b._n - a._n || a.value.localeCompare(b.value))
      .map(({ value, label, disabled }) => ({ value, label, disabled }));
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
            data={titleData}
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
            data={schoolData}
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
