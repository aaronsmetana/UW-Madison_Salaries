import { useState } from 'react';
import { TextInput, Paper, Loader, Stack, UnstyledButton, Text, Group } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';

interface Hit {
  person_key: string;
  fn: string;
  ln: string;
  school: string | null;
  title: string | null;
}

export function SearchBox({
  placeholder = 'Search a person…',
  autoFocus = false,
  onSelect,
  onPick,
  prominent = false,
}: {
  placeholder?: string;
  autoFocus?: boolean;
  onSelect?: () => void;
  /** When set, picking a result calls this (and clears the input) instead of navigating to the profile. */
  onPick?: (hit: { person_key: string; name: string }) => void;
  prominent?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [debounced] = useDebouncedValue(term, 200);
  const q = debounced.trim().toLowerCase();
  const enabled = q.length >= 2;

  const { data, isFetching } = useSql<Hit>(
    ['search', q],
    `SELECT person_key,
        arg_max(first_name, snapshot_date) AS fn,
        arg_max(last_name, snapshot_date)  AS ln,
        arg_max(school, snapshot_date)     AS school,
        arg_max(title, snapshot_date)      AS title
     FROM salaries
     WHERE lower(first_name || ' ' || last_name) LIKE ${sqlStr(`%${q}%`)}
     GROUP BY person_key
     ORDER BY ln, fn
     LIMIT 25`,
    enabled
  );

  const nav = useNavigate();
  const open = enabled && (isFetching || (data && data.length >= 0));

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: prominent ? 640 : 560, margin: prominent ? '0 auto' : undefined }}>
      <TextInput
        size={prominent ? 'xl' : 'md'}
        radius={prominent ? 'xl' : undefined}
        leftSection={prominent ? <IconSearch size={20} /> : undefined}
        placeholder={placeholder}
        value={term}
        onChange={(e) => setTerm(e.currentTarget.value)}
        rightSection={isFetching ? <Loader size="xs" /> : null}
        aria-label="Search a person"
        data-autofocus={autoFocus || undefined}
        autoFocus={autoFocus}
      />
      {open && (
        <Paper withBorder shadow="md" mt={4} style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, maxHeight: 360, overflowY: 'auto' }}>
          {data && data.length > 0 ? (
            <Stack gap={0}>
              {data.map((h) => (
                <UnstyledButton
                  key={h.person_key}
                  px="sm"
                  py={8}
                  onClick={() => {
                    if (onPick) {
                      onPick({ person_key: h.person_key, name: `${h.fn} ${h.ln}`.trim() });
                      setTerm('');
                    } else {
                      nav(`/person/${encodeURIComponent(h.person_key)}`);
                      onSelect?.();
                    }
                  }}
                  style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                >
                  <Group justify="space-between" wrap="nowrap" gap="md">
                    <Text size="sm" fw={500} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {h.fn} {h.ln}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1} style={{ minWidth: 0, textAlign: 'right' }}>
                      {[h.title, h.school].filter(Boolean).join(' · ')}
                    </Text>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          ) : (
            !isFetching && (
              <Text size="sm" c="dimmed" px="sm" py={8}>
                No matches for “{debounced}”.
              </Text>
            )
          )}
        </Paper>
      )}
    </div>
  );
}
