import { Group, SegmentedControl, Select, Text, Badge, CopyButton, Button } from '@mantine/core';
import { useControls, METRIC_LABEL, scopeLabel, type Metric } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { FilterControls } from '../components/FilterControls';

/**
 * Persistent control bar: Scope is the lens the whole app responds to, plus the
 * active snapshot and salary metric. A context badge always shows the current lens.
 */
export function ControlBar() {
  const { scope, setScope, metric, setMetric, activeSnapshot, setActiveSnapshot } = useControls();
  const { data: summary } = useSummary();
  const snapshots = summary?.snapshots ?? [];
  const latest = snapshots[snapshots.length - 1];

  const { data: schools } = useSql<{ school: string }>(
    ['scope-schools', latest?.id ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE school IS NOT NULL AND snapshot_id = ${sqlStr(latest?.id ?? '')} ORDER BY school`,
    !!latest
  );

  const scopeValue = scope.kind === 'school' ? `school:${scope.value}` : 'all';
  const scopeOptions = [
    { value: 'all', label: 'All UW' },
    ...(schools ?? []).map((s) => ({ value: `school:${s.school}`, label: s.school })),
  ];

  const snapValue = activeSnapshot ?? 'latest';
  const snapOptions = [
    { value: 'latest', label: latest ? `Latest (${latest.label})` : 'Latest' },
    ...[...snapshots].reverse().map((s) => ({ value: s.id, label: s.label })),
  ];
  const snapLabel = activeSnapshot
    ? snapshots.find((s) => s.id === activeSnapshot)?.label ?? activeSnapshot
    : latest?.label ?? '—';

  return (
    <Group
      h={48}
      px="md"
      gap="lg"
      wrap="nowrap"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)', overflowX: 'auto' }}
    >
      {/* Lens: scope + snapshot grouped together */}
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Select
          size="xs"
          w={190}
          label={undefined}
          leftSection={<Text size="xs" c="dimmed">Scope</Text>}
          leftSectionWidth={48}
          data={scopeOptions}
          value={scopeValue}
          onChange={(v) =>
            setScope(v && v.startsWith('school:') ? { kind: 'school', value: v.slice(7) } : { kind: 'all' })
          }
          allowDeselect={false}
          searchable
        />
        <Select
          size="xs"
          w={190}
          leftSection={<Text size="xs" c="dimmed">Snap</Text>}
          leftSectionWidth={40}
          data={snapOptions}
          value={snapValue}
          onChange={(v) => setActiveSnapshot(v === 'latest' ? null : v)}
          allowDeselect={false}
        />
      </Group>

      {/* Salary metric as a single pill toggle */}
      <SegmentedControl
        size="xs"
        radius="xl"
        color="indigo"
        style={{ flexShrink: 0 }}
        value={metric}
        onChange={(v) => setMetric(v as Metric)}
        data={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
      />

      {/* Filters + actions grouped on the right */}
      <Group gap="xs" ml="auto" wrap="nowrap" style={{ flexShrink: 0 }}>
        <FilterControls />
        <CopyButton value={typeof window !== 'undefined' ? window.location.href : ''}>
          {({ copied, copy }) => (
            <Button size="xs" variant="default" color={copied ? 'teal' : undefined} onClick={copy}>
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          )}
        </CopyButton>
        <Badge variant="light" color="indigo">
          {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]}
        </Badge>
      </Group>
    </Group>
  );
}
