import { useEffect, useMemo, useState } from 'react';
import { Group, Button, Popover, Stack, MultiSelect, Pill, Indicator, Text } from '@mantine/core';
import { IconFilter, IconFilterFilled } from '@tabler/icons-react';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { FACETS, whereAll, snapWhere, filterKey } from '../lib/queries';
import { scopeKey } from '../state/controls';
import { optionDropdownProps } from '../lib/selectProps';

function FacetMultiSelect({ field, label, searchable }: { field: string; label: string; searchable?: boolean }) {
  const { scope, filters, setFilter } = useControls();
  const snap = useActiveSnapshotId();
  const selected = useMemo(() => filters[field] ?? [], [filters, field]);

  // Options cascade: a facet's choices reflect the active snapshot + scope + every OTHER active filter
  // (excluding itself so multi-select stays OR-within-a-facet). This keeps all controls interconnected.
  const otherFilters = useMemo(() => {
    const o = { ...filters };
    delete o[field];
    return o;
  }, [filters, field]);

  const { data } = useSql<{ v: string }>(
    ['facet', field, snap ?? '', scopeKey(scope), filterKey(otherFilters)],
    `SELECT DISTINCT ${field} v FROM salaries
     WHERE ${snapWhere(snap ?? '')} AND ${whereAll(scope, otherFilters)} AND ${field} IS NOT NULL
     ORDER BY v LIMIT 500`,
    !!snap
  );

  const options = useMemo(() => (data ?? []).map((d) => d.v), [data]);

  // Auto-remove selected values that are no longer possible under the current constraints.
  useEffect(() => {
    if (!data) return; // wait until options have loaded
    const valid = new Set(options);
    const pruned = selected.filter((v) => valid.has(v));
    if (pruned.length !== selected.length) setFilter(field, pruned);
  }, [data, options, selected, field, setFilter]);

  return (
    <MultiSelect
      {...optionDropdownProps}
      size="xs"
      label={label}
      placeholder="Any"
      data={options}
      value={selected}
      onChange={(v) => setFilter(field, v)}
      searchable={searchable}
      clearable
    />
  );
}

export function FilterControls() {
  const { filters, setFilter, clearFilters } = useControls();
  const count = Object.values(filters).reduce((a, v) => a + v.length, 0);
  // Track the popover's open state so the button can show a clear "toggled on" look.
  const [opened, setOpened] = useState(false);
  const active = opened || count > 0;

  return (
    <Group gap="xs" wrap="nowrap">
      <Popover
        position="bottom-start"
        withArrow
        arrowSize={12}
        arrowOffset={16}
        arrowPosition="side"
        shadow="xl"
        radius="md"
        trapFocus
        keepMounted
        onOpen={() => setOpened(true)}
        onClose={() => setOpened(false)}
      >
        <Popover.Target>
          {/* Notification badge with the applied-filter count, attached to the button. */}
          <Indicator
            label={count}
            size={16}
            color="blue"
            offset={4}
            withBorder
            disabled={count === 0}
            styles={{ indicator: { fontWeight: 700, pointerEvents: 'none' } }}
          >
            <Button
              size="xs"
              variant={active ? 'light' : 'default'}
              color={active ? 'blue' : 'gray'}
              aria-expanded={opened}
              leftSection={
                active ? <IconFilterFilled size={14} /> : <IconFilter size={14} stroke={1.8} />
              }
            >
              Filters
            </Button>
          </Indicator>
        </Popover.Target>
        <Popover.Dropdown p={0}>
          <Stack gap={0} w={300}>
            {/* Header: defines the menu and offers a one-click reset on the right. */}
            <Group
              justify="space-between"
              align="center"
              px="md"
              py={8}
              style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
            >
              <Text fw={700} size="sm">Filters</Text>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={clearFilters}
                disabled={count === 0}
              >
                Clear all
              </Button>
            </Group>
            <Stack gap="sm" px="md" py="md">
              {FACETS.map((f) => (
                <FacetMultiSelect key={f.field} field={f.field} label={f.label} searchable={f.searchable} />
              ))}
            </Stack>
          </Stack>
        </Popover.Dropdown>
      </Popover>
      {Object.entries(filters).flatMap(([field, vals]) =>
        vals.map((v) => (
          <Pill
            key={`${field}:${v}`}
            withRemoveButton
            onRemove={() => setFilter(field, (filters[field] ?? []).filter((x) => x !== v))}
          >
            {v}
          </Pill>
        ))
      )}
    </Group>
  );
}
