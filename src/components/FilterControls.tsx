import { Group, Button, Popover, Stack, MultiSelect, Pill } from '@mantine/core';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { FACETS } from '../lib/queries';

function FacetMultiSelect({ field, label, searchable }: { field: string; label: string; searchable?: boolean }) {
  const { filters, setFilter } = useControls();
  const snap = useActiveSnapshotId();
  const { data } = useSql<{ v: string }>(
    ['facet', field, snap ?? ''],
    `SELECT DISTINCT ${field} v FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND ${field} IS NOT NULL ORDER BY v LIMIT 500`,
    !!snap
  );
  return (
    <MultiSelect
      size="xs"
      label={label}
      placeholder="Any"
      data={(data ?? []).map((d) => d.v)}
      value={filters[field] ?? []}
      onChange={(v) => setFilter(field, v)}
      searchable={searchable}
      clearable
      maxDropdownHeight={220}
    />
  );
}

export function FilterControls() {
  const { filters, setFilter, clearFilters } = useControls();
  const count = Object.values(filters).reduce((a, v) => a + v.length, 0);

  return (
    <Group gap="xs" wrap="nowrap">
      <Popover position="bottom-start" withArrow shadow="md" trapFocus>
        <Popover.Target>
          <Button size="xs" variant={count ? 'light' : 'default'}>
            Filters{count ? ` (${count})` : ''}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="sm" w={280}>
            {FACETS.map((f) => (
              <FacetMultiSelect key={f.field} field={f.field} label={f.label} searchable={f.searchable} />
            ))}
            {count > 0 && (
              <Button size="xs" variant="subtle" color="gray" onClick={clearFilters}>
                Clear all filters
              </Button>
            )}
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
