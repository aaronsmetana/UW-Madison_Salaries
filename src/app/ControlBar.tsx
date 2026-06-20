import { useEffect, useState } from 'react';
import { Group, SegmentedControl, Select, Text, Badge, CopyButton, Button, ActionIcon, HoverCard, Stack, Paper, Combobox, useCombobox, InputBase } from '@mantine/core';
import { IconBuildingBank, IconCalendar, IconInfoCircle, IconSearch } from '@tabler/icons-react';
import { useControls, METRIC_LABEL, scopeLabel, type Metric, type Scope } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { FilterControls, ActiveFilters } from '../components/FilterControls';
import { optionDropdownProps } from '../lib/selectProps';

/** Plain-language explanation of each pay metric, shown in the (i) hover card. */
const METRIC_HELP: Record<Metric, string> = {
  full: 'The listed annual salary (full-time-equivalent rate). For part-time staff this is more than they actually earned.',
  fte: "Annual salary scaled to the person's FTE — closest to what they were actually paid.",
  base: 'Base salary as reported (may exclude supplemental or overload pay).',
};

/**
 * Scope / division picker. A Combobox (not a plain Select) so the floating menu can open wider than the
 * compact trigger and carry its own sticky filter — division names are long and otherwise wrap badly
 * inside a trigger-width menu.
 */
function ScopeMenu({ scope, setScope, options }: {
  scope: Scope;
  setScope: (s: Scope) => void;
  options: { value: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownOpen: () => combobox.focusSearchInput(),
    onDropdownClose: () => { combobox.resetSelectedOption(); setSearch(''); },
  });
  const scopeValue = scope.kind === 'school' ? `school:${scope.value}` : 'all';
  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <Combobox
      store={combobox}
      width={380}
      size="sm"
      position="bottom-start"
      shadow="md"
      withinPortal
      classNames={{ option: 'scope-option' }}
      onOptionSubmit={(val) => {
        setScope(val.startsWith('school:') ? { kind: 'school', value: val.slice(7) } : { kind: 'all' });
        combobox.closeDropdown();
      }}
      styles={{
        // No outer padding so the search header + list manage their own; 380px fits long names on one line.
        dropdown: { padding: 0, maxWidth: '92vw' },
        // Embedded search header: borderless input with a divider separating it from the list below.
        search: { border: 'none', borderRadius: 0, borderBottom: '1px solid var(--mantine-color-default-border)' },
        // Inset "island": 6px around the list so each option highlight floats as a rounded chip.
        options: { padding: 6 },
        // Tight line-height keeps a wrapped name's two lines together; the vertical padding is the larger
        // gap, so each division reads as one distinct block.
        option: { lineHeight: 1.25, paddingTop: 8, paddingBottom: 8 },
      }}
    >
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          size="xs"
          w={180}
          aria-label="Scope"
          leftSection={<IconBuildingBank size={15} />}
          leftSectionWidth={30}
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
        >
          <Text span size="xs" truncate>{scopeLabel(scope)}</Text>
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Filter divisions…"
          leftSection={<IconSearch size={14} />}
        />
        <Combobox.Options mah={320} style={{ overflowY: 'auto' }}>
          {filtered.length > 0 ? (
            filtered.map((o) => (
              <Combobox.Option value={o.value} key={o.value} selected={o.value === scopeValue}>
                {o.label}
              </Combobox.Option>
            ))
          ) : (
            <Combobox.Empty>No matching division</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

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

  // School list follows the active snapshot (a school may not exist in every month/year).
  const snapId = activeSnapshot ?? latest?.id;
  const { data: schools } = useSql<{ school: string }>(
    ['scope-schools', snapId ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE school IS NOT NULL AND snapshot_id = ${sqlStr(snapId ?? '')} ORDER BY school`,
    !!snapId
  );

  // If the scoped school isn't in the active snapshot, fall back to All UW (keeps the view non-empty).
  useEffect(() => {
    if (!schools || scope.kind !== 'school') return;
    if (!schools.some((s) => s.school === scope.value)) setScope({ kind: 'all' });
  }, [schools, scope, setScope]);

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
        <ScopeMenu scope={scope} setScope={setScope} options={scopeOptions} />
        <Select
          {...optionDropdownProps}
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

  const copyLink = (
    <CopyButton value={typeof window !== 'undefined' ? window.location.href : ''}>
      {({ copied, copy }) => (
        <Button size="xs" variant="default" color={copied ? 'teal' : undefined} onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
      )}
    </CopyButton>
  );

  // Inline: an in-content panel (used on Compare/Explore) sharing the page background. Controls left,
  // actions right — and the Filters button stays put: active-filter chips flow into their own row below.
  if (inline) {
    return (
      <Paper withBorder radius="md" px="sm" py="xs">
        <Group justify="space-between" gap="md" wrap="wrap">
          <Group gap="md" wrap="wrap" align="center">{lens}</Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <FilterControls />
            {copyLink}
          </Group>
        </Group>
        <ActiveFilters standalone />
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
        <FilterControls />
        <ActiveFilters />
        {copyLink}
        <Badge variant="light" color="indigo">
          {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]}
        </Badge>
      </Group>
    </Group>
  );
}
