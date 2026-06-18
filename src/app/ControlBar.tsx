import { Group, SegmentedControl, Select, Text, Badge, CopyButton, Button, ActionIcon, HoverCard, Stack, Paper } from '@mantine/core';
import { IconBuildingBank, IconCalendar, IconInfoCircle } from '@tabler/icons-react';
import { useControls, METRIC_LABEL, scopeLabel, type Metric } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { FilterControls } from '../components/FilterControls';

/** Plain-language explanation of each pay metric, shown in the (i) hover card. */
const METRIC_HELP: Record<Metric, string> = {
  full: 'The listed annual salary (full-time-equivalent rate). For part-time staff this is more than they actually earned.',
  fte: "Annual salary scaled to the person's FTE — closest to what they were actually paid.",
  base: 'Base salary as reported (may exclude supplemental or overload pay).',
};

/**
 * Scope + snapshot are the lens the whole app responds to, plus the salary metric (defaulting to actual,
 * FTE-adjusted pay). Two layouts: the persistent header strip (default), and an `inline` panel that
 * pages can drop into their own content (used on Compare) so the controls anchor to the data below.
 */
export function ControlBar({ inline = false }: { inline?: boolean }) {
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

  // Shared control elements, arranged differently by the header vs inline layouts below.
  const lens = (
    <>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em', flexShrink: 0 }}>
        Showing
      </Text>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Select
          size="xs"
          w={180}
          aria-label="Scope"
          leftSection={<IconBuildingBank size={15} />}
          leftSectionWidth={30}
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
          w={180}
          aria-label="Snapshot"
          leftSection={<IconCalendar size={15} />}
          leftSectionWidth={30}
          data={snapOptions}
          value={snapValue}
          onChange={(v) => setActiveSnapshot(v === 'latest' ? null : v)}
          allowDeselect={false}
        />
      </Group>
      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>
          Pay
        </Text>
        <SegmentedControl
          size="xs"
          radius="xl"
          color="indigo"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          data={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
        />
        <HoverCard width={300} shadow="md" position="bottom" withArrow>
          <HoverCard.Target>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label="What do these pay options mean?">
              <IconInfoCircle size={16} />
            </ActionIcon>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Stack gap={6}>
              {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                <Text size="xs" key={m}><b>{METRIC_LABEL[m]}</b> — {METRIC_HELP[m]}</Text>
              ))}
            </Stack>
          </HoverCard.Dropdown>
        </HoverCard>
      </Group>
    </>
  );

  const actions = (
    <>
      <FilterControls />
      <CopyButton value={typeof window !== 'undefined' ? window.location.href : ''}>
        {({ copied, copy }) => (
          <Button size="xs" variant="default" color={copied ? 'teal' : undefined} onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
        )}
      </CopyButton>
    </>
  );

  // Inline: an in-content panel (used on Compare) sharing the page background, controls left / actions right.
  if (inline) {
    return (
      <Paper withBorder radius="md" px="sm" py="xs">
        <Group justify="space-between" gap="md" wrap="wrap">
          <Group gap="md" wrap="wrap" align="center">{lens}</Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>{actions}</Group>
        </Group>
      </Paper>
    );
  }

  // Header strip: persistent bar with a context badge on the right.
  return (
    <Group
      h={48}
      px="md"
      gap="md"
      wrap="nowrap"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)', overflowX: 'auto' }}
    >
      {lens}
      <Group gap="xs" ml="auto" wrap="nowrap" style={{ flexShrink: 0 }}>
        {actions}
        <Badge variant="light" color="indigo">
          {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]}
        </Badge>
      </Group>
    </Group>
  );
}
