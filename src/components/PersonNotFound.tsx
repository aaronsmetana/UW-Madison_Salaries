import { Link } from 'react-router-dom';
import { Anchor, Stack, Text } from '@mantine/core';
import { useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { fullName } from '../lib/format';
import { NotFoundPanel } from './NotFoundPanel';

/**
 * A person's address that names no one (NF1). A person's key is their name and hire date, so it breaks when
 * either changes in the records; the addresses a person had before are followed already (person aliases), and
 * this is what is left. The likeliest one meant is someone with the same name under another hire date: they
 * are offered first, then a search.
 */
export function PersonNotFound({ personKey }: { personKey: string }) {
  const namePart = personKey.split('|')[0] ?? '';
  const { data: same } = useSql<{ person_key: string; fn: string | null; ln: string | null; hire: string | null; seen: string | null }>(
    ['person-same-name', namePart],
    `SELECT person_key, arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln,
            arg_max(date_of_hire, snapshot_date) hire, max(snapshot_date) seen
     FROM salaries WHERE split_part(person_key, '|', 1) = ${sqlStr(namePart)} GROUP BY person_key ORDER BY seen DESC LIMIT 5`,
    namePart.length >= 2,
  );
  return (
    <NotFoundPanel
      title="Person not found"
      description="No one in the records has this address. A link to a person breaks when their name or hire date changes in the records; the people below are the likeliest matches."
      searchKinds={['people']}
      suggestions={same && same.length > 0 && (
        <Stack gap={6} className="not-found-suggestions">
          {same.map((p) => (
            <Text key={p.person_key} size="sm">
              <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`}>{fullName(p.fn, p.ln) || p.person_key}</Anchor>
              <Text span c="dimmed"> · hired {String(p.hire ?? '').slice(0, 4) || 'date not recorded'} · last seen {String(p.seen ?? '').slice(0, 7)}</Text>
            </Text>
          ))}
        </Stack>
      )}
    />
  );
}
