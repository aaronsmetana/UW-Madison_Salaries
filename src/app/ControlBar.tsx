import { useEffect, useState } from 'react';
import { Group, Select, Text, Badge, CopyButton, Button, ActionIcon, HoverCard, Stack, Paper, Combobox, useCombobox, InputBase } from '@mantine/core';
import { IconBuildingBank, IconCalendar, IconInfoCircle, IconSearch, IconRefresh } from '@tabler/icons-react';
import { useControls, METRIC_LABEL, scopeLabel, type Metric, type Scope } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { paidHeadcount } from '../lib/queries';
import { num } from '../lib/format';
import { FilterControls, ActiveFilters } from '../components/FilterControls';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { dropdownProps, DROPDOWN_TIERS } from '../lib/selectProps';

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
  options: { value: string; label: string; count?: number | null }[];
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
      size="xs"
      radius={DROPDOWN_TIERS.sm.radius}
      position="bottom-start"
      shadow="md"
      withinPortal
      classNames={{ option: 'app-dropdown-option', search: 'scope-search-pill' }}
      onOptionSubmit={(val) => {
        setScope(val.startsWith('school:') ? { kind: 'school', value: val.slice(7) } : { kind: 'all' });
        combobox.closeDropdown();
      }}
      styles={{
        // No outer padding so the sticky header + scroll area span the full width.
        dropdown: { padding: 0, maxWidth: '92vw' },
        // Inset "island": the small-tier buffer so each option highlight floats as a rounded chip, clear
        // of the scrollbar (which lives on the wrapping scroll container, not this padded list).
        options: { padding: DROPDOWN_TIERS.sm.island },
        // Small-tier list-item tokens — identical to every other small dropdown.
        option: { fontSize: DROPDOWN_TIERS.sm.optionFont, lineHeight: 1.25, padding: DROPDOWN_TIERS.sm.optionPad },
      }}
    >
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          size="xs"
          radius={DROPDOWN_TIERS.sm.radius}
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
        {/* Sticky header: a contained, muted "pill" search field with breathing room from the walls,
            and a divider beneath it cleanly separating the search zone from the list. */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Combobox.Search
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Filter divisions…"
            leftSection={<IconSearch size={14} />}
          />
        </div>
        {/* Scroll on this wrapper (not the padded list), so the scrollbar sits outside the 6px island
            gutter and never collides with an option's rounded highlight. */}
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          <Combobox.Options>
            {filtered.length > 0 ? (
              filtered.map((o) => (
                <Combobox.Option value={o.value} key={o.value} selected={o.value === scopeValue}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Text span size="xs" lineClamp={1}>{o.label}</Text>
                    {o.count != null && (
                      <Text span size="xs" c="dimmed" fw={500} style={{ flexShrink: 0 }}>{num(o.count)}</Text>
                    )}
                  </Group>
                </Combobox.Option>
              ))
            ) : (
              <Combobox.Empty>No matching division</Combobox.Empty>
            )}
          </Combobox.Options>
        </div>
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
  const { scope, setScope, metric, setMetric, activeSnapshot, setActiveSnapshot, filters, clearFilters } = useControls();
  const { data: summary } = useSummary();
  const snapshots = summary?.snapshots ?? [];
  const latest = snapshots[snapshots.length - 1];

  // School list follows the active snapshot (a school may not exist in every month/year). We also
  // carry each division's paid headcount so the dropdown can show it (mirrors the Title page's
  // DropdownCountRow — big units are easy to spot).
  const snapId = activeSnapshot ?? latest?.id;
  const { data: schools } = useSql<{ school: string; n: number }>(
    ['scope-schools', snapId ?? '', metric],
    `SELECT school, ${paidHeadcount(metric)} n FROM salaries
     WHERE school IS NOT NULL AND snapshot_id = ${sqlStr(snapId ?? '')} GROUP BY school ORDER BY school`,
    !!snapId
  );

  // If the scoped school isn't in the active snapshot, fall back to All UW (keeps the view non-empty).
  useEffect(() => {
    if (!schools || scope.kind !== 'school') return;
    if (!schools.some((s) => s.school === scope.value)) setScope({ kind: 'all' });
  }, [schools, scope, setScope]);

  const scopeOptions = [
    { value: 'all', label: 'All UW' },
    ...(schools ?? []).map((s) => ({ value: `school:${s.school}`, label: s.school, count: s.n })),
  ];

  const snapValue = activeSnapshot ?? 'latest';
  const snapOptions = [
    { value: 'latest', label: latest ? `Latest (${latest.label})` : 'Latest' },
    ...[...snapshots].reverse().map((s) => ({ value: s.id, label: s.label })),
  ];
  // Per-snapshot row counts for the picker; the synthetic "latest" borrows the real latest's count.
  const snapRows = new Map<string, number>(snapshots.map((s) => [s.id, s.rows]));
  if (latest) snapRows.set('latest', snapRows.get(latest.id) ?? 0);
  const snapLabel = activeSnapshot
    ? snapshots.find((s) => s.id === activeSnapshot)?.label ?? activeSnapshot
    : latest?.label ?? '—';

  // "Reset view": back to the app defaults (All UW · latest · actual pay · no filters).
  const atDefaults =
    scope.kind === 'all' && metric === 'fte' && activeSnapshot == null &&
    Object.values(filters).every((v) => v.length === 0);
  const resetView = (
    <Button
      size="xs"
      variant="subtle"
      color="gray"
      leftSection={<IconRefresh size={14} />}
      onClick={() => { setScope({ kind: 'all' }); setMetric('fte'); setActiveSnapshot(null); clearFilters(); }}
      disabled={atDefaults}
    >
      Reset
    </Button>
  );

  // Shared control elements, arranged differently by the header vs inline layouts below.
  const lens = (
    <>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em', flexShrink: 0 }}>
        Showing
      </Text>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <ScopeMenu scope={scope} setScope={setScope} options={scopeOptions} />
        <Select
          {...dropdownProps('sm')}
          w={180}
          aria-label="Snapshot"
          leftSection={<IconCalendar size={15} />}
          leftSectionWidth={30}
          data={snapOptions}
          value={snapValue}
          onChange={(v) => setActiveSnapshot(v === 'latest' ? null : v)}
          allowDeselect={false}
          renderOption={({ option }) => {
            const rows = snapRows.get(option.value);
            return (
              <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
                <Group gap={6} wrap="nowrap">
                  <Text span size="xs" lineClamp={1}>{option.label}</Text>
                  {option.value === latest?.id && <Badge size="xs" variant="light" color="accent">latest</Badge>}
                </Group>
                {rows != null && <Text span size="xs" c="dimmed" style={{ flexShrink: 0 }}>{num(rows)} rows</Text>}
              </Group>
            );
          }}
        />
      </Group>
      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>
          Pay
        </Text>
        <SegmentedToggle
          size="xs"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ id: m, label: METRIC_LABEL[m] }))}
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
        <Button size="xs" variant="default" color={copied ? 'pos' : undefined} onClick={copy}>
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
            {/* Active-lens summary: only when the view is narrowed from the defaults, so it reads as a
                "you've focused the data" reminder beside the Reset button rather than restating the toggles. */}
            {!atDefaults && (
              <Badge variant="light" color="accent" visibleFrom="md">
                {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]}
              </Badge>
            )}
            <FilterControls />
            {resetView}
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
        {resetView}
        {copyLink}
        <Badge variant="light" color="accent">
          {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]}
        </Badge>
      </Group>
    </Group>
  );
}
