import { useState, useMemo, useId, useEffect, type KeyboardEvent } from 'react';
import { TextInput, Popover, Loader, Stack, UnstyledButton, Text, Group, Tooltip } from '@mantine/core';
import { IconSearch, IconAlertTriangle } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { fullName } from '../lib/format';

interface Hit {
  person_key: string;
  fn: string;
  ln: string;
  school: string | null;
  title: string | null;
  max_appts: number;
}

export function SearchBox({
  placeholder = 'Search a person…',
  autoFocus = false,
  onSelect,
  onPick,
  prominent = false,
  inputHeight,
}: {
  placeholder?: string;
  autoFocus?: boolean;
  onSelect?: () => void;
  /** When set, picking a result calls this (and clears the input) instead of navigating to the profile. */
  onPick?: (hit: { person_key: string; name: string }) => void;
  prominent?: boolean;
  /** Taller closed control (px) so this matches sibling pickers (e.g. the Compare add blocks). */
  inputHeight?: number;
}) {
  const [term, setTerm] = useState('');
  const [debounced] = useDebouncedValue(term, 200);
  const q = debounced.trim().toLowerCase();
  const enabled = q.length >= 2;

  const { data, isFetching } = useSql<Hit>(
    ['search', q],
    `WITH m AS (
        SELECT person_key, first_name, last_name, school, title, snapshot_date,
               count(*) OVER (PARTITION BY person_key, snapshot_id) per_snap
        FROM salaries
        WHERE lower(first_name || ' ' || last_name) LIKE ${sqlStr(`%${q}%`)}
     )
     SELECT person_key,
        arg_max(first_name, snapshot_date) AS fn,
        arg_max(last_name, snapshot_date)  AS ln,
        arg_max(school, snapshot_date)     AS school,
        arg_max(title, snapshot_date)      AS title,
        max(per_snap)                      AS max_appts
     FROM m
     GROUP BY person_key
     ORDER BY ln, fn
     LIMIT 25`,
    enabled
  );

  // Detect homonyms within the current results (same display name, different person).
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of data ?? []) {
      const k = `${h.fn} ${h.ln}`.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [data]);

  const nav = useNavigate();
  const opened = enabled && (isFetching || (data?.length ?? 0) >= 0);

  // Keyboard navigation for the autocomplete (combobox semantics).
  const results = data ?? [];
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [data]);
  useEffect(() => { document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, listId]);

  const select = (h: Hit) => {
    if (onPick) {
      onPick({ person_key: h.person_key, name: fullName(h.fn, h.ln) });
      setTerm('');
    } else {
      nav(`/person/${encodeURIComponent(h.person_key)}`);
      onSelect?.();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setTerm(''); return; }
    if (!opened || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = results[active]; if (h) select(h); }
  };

  return (
    <Popover
      opened={!!opened}
      width="target"
      position="bottom-start"
      shadow="md"
      withinPortal
      trapFocus={false}
      returnFocus={false}
      closeOnClickOutside={false}
      closeOnEscape
    >
      <Popover.Target>
        <div style={{ width: '100%', maxWidth: prominent ? '100%' : 720, margin: prominent ? '0 auto' : undefined }}>
          <TextInput
            size={prominent ? 'xl' : 'md'}
            radius={prominent ? 'xl' : 'md'}
            leftSection={<IconSearch size={prominent ? 28 : 18} />}
            leftSectionWidth={prominent ? 60 : undefined}
            placeholder={placeholder}
            value={term}
            onChange={(e) => setTerm(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            rightSection={isFetching ? <Loader size="sm" /> : null}
            aria-label="Search a person"
            role="combobox"
            aria-expanded={!!opened}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={opened && results.length ? optId(active) : undefined}
            data-autofocus={autoFocus || undefined}
            autoFocus={autoFocus}
            classNames={prominent ? { input: 'hero-search-input' } : undefined}
            styles={
              prominent
                ? { input: { minHeight: 72, height: 72, fontSize: '1.4rem' } }
                : inputHeight
                  ? { input: { minHeight: inputHeight, height: inputHeight } }
                  : undefined
            }
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown p={0} style={{ maxHeight: 460, overflowY: 'auto' }}>
        {data && data.length > 0 ? (
          <Stack gap={0} role="listbox" id={listId}>
            {data.map((h, i) => {
              const sharedName = (nameCounts.get(`${h.fn} ${h.ln}`.trim().toLowerCase()) ?? 0) > 1;
              const multiAppt = (h.max_appts ?? 0) > 1;
              const flags: string[] = [];
              if (sharedName) flags.push('Multiple people share this name — double-check this is the right person.');
              if (multiAppt) flags.push('Has multiple appointment entries in a snapshot (e.g., split or joint roles).');
              return (
                <UnstyledButton
                  key={h.person_key}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  px="md"
                  py={11}
                  onClick={() => select(h)}
                  style={{
                    borderBottom: '1px solid var(--mantine-color-default-border)',
                    background: i === active ? 'var(--mantine-color-default-hover)' : undefined,
                  }}
                >
                  <Group wrap="nowrap" gap="sm">
                    <Text size="md" fw={500} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {fullName(h.fn, h.ln)}
                    </Text>
                    {flags.length > 0 && (
                      <Tooltip label={flags.join(' ')} multiline w={260} withArrow position="top">
                        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                          <IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />
                        </span>
                      </Tooltip>
                    )}
                    <Text size="sm" c="dimmed" lineClamp={1} style={{ minWidth: 0 }}>
                      {[h.title, h.school].filter(Boolean).join(' · ')}
                    </Text>
                  </Group>
                </UnstyledButton>
              );
            })}
          </Stack>
        ) : (
          !isFetching && (
            <Text size="sm" c="dimmed" px="sm" py={8}>
              No matches for “{debounced}”.
            </Text>
          )
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
