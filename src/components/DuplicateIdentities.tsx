import { Fragment, useMemo, useState } from 'react';
import { Card, Title, Stack, Group, Text, Badge, Anchor, ScrollArea, Switch, Popover, Loader } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconChevronRight, IconAlertTriangle } from '@tabler/icons-react';
import { useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { fullName, usd, num } from '../lib/format';

interface IdRow {
  person_key: string; fn: string | null; ln: string | null;
  title: string | null; school: string | null; department: string | null;
  hire: string | null; pay: number | null;
}
interface DupGroup {
  name: string; fn: string; ln: string; ids: IdRow[];
  flagged: boolean; closeHire: boolean; minGapDays: number | null;
}

/** Click a person → a small preview of their title history across snapshots, + a link to the full record. */
function IdentityPreview({ personKey, title, name }: { personKey: string; title: string; name: string }) {
  const [opened, setOpened] = useState(false);
  const { data } = useSql<{ label: string; title: string | null; school: string | null }>(
    ['dup-preview', personKey],
    `SELECT any_value(snapshot_label) AS "label", arg_max(title, salary) title, arg_max(school, salary) school
     FROM salaries WHERE person_key = ${sqlStr(personKey)} GROUP BY snapshot_id ORDER BY any_value(snapshot_date)`,
    opened
  );
  return (
    <Popover opened={opened} onChange={setOpened} width={320} position="bottom-start" shadow="md" withArrow withinPortal>
      <Popover.Target>
        <Anchor component="button" type="button" size="sm" fw={500} onClick={() => setOpened((o) => !o)} style={{ textAlign: 'left' }}>
          {title}
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="sm" fw={600}>{name}</Text>
        <Text size="xs" c="dimmed" mb={6}>Title history</Text>
        {!data ? <Loader size="xs" /> : (
          <Stack gap={4}>
            {data.map((d, i) => (
              <Group key={i} justify="space-between" wrap="nowrap" gap="sm">
                <Text size="xs" lineClamp={1}>{d.title ?? '—'}{d.school ? ` · ${d.school}` : ''}</Text>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{d.label}</Text>
              </Group>
            ))}
          </Stack>
        )}
        <Anchor component={Link} to={`/person/${encodeURIComponent(personKey)}`} size="xs" mt="xs" display="inline-block">
          View full record →
        </Anchor>
      </Popover.Dropdown>
    </Popover>
  );
}

/** The "Possible duplicate identities" review section: shared names that resolve to several person_keys,
 *  classified by how likely they are a real matching error, expandable to the people behind each name. */
export function DuplicateIdentities({ snap }: { snap?: string }) {
  const { data: rows } = useSql<IdRow>(
    ['dup-identities', snap ?? ''],
    `WITH dupnames AS (
        SELECT first_name, last_name FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND first_name IS NOT NULL AND last_name IS NOT NULL
        GROUP BY first_name, last_name HAVING count(DISTINCT person_key) > 1
     )
     SELECT s.person_key, any_value(s.first_name) fn, any_value(s.last_name) ln,
        arg_max(s.title, s.salary) title, arg_max(s.school, s.salary) school,
        arg_max(s.department, s.salary) department, any_value(s.date_of_hire) hire,
        sum(COALESCE(s.salary_fte_adjusted, s.salary * COALESCE(s.fte, 1))) FILTER (WHERE s.salary > 0) pay
     FROM salaries s JOIN dupnames d ON s.first_name = d.first_name AND s.last_name = d.last_name
     WHERE s.snapshot_id = ${sqlStr(snap ?? '')} GROUP BY s.person_key ORDER BY ln, fn`,
    !!snap
  );

  // Bucket identities by shared name, then classify each group: flagged when two identities share the same
  // title + school (a person doing the same job at the same place under two keys is almost certainly one
  // person split apart), or their hire dates are < 90 days apart.
  const groups = useMemo<DupGroup[]>(() => {
    const m = new Map<string, IdRow[]>();
    for (const r of rows ?? []) {
      const key = `${r.fn ?? ''}|${r.ln ?? ''}`;
      const arr = m.get(key);
      if (arr) arr.push(r); else m.set(key, [r]);
    }
    const gs: DupGroup[] = [];
    for (const ids of m.values()) {
      if (ids.length < 2) continue;
      const roles = ids.map((i) => `${(i.title ?? '').toLowerCase()}|${(i.school ?? '').toLowerCase()}`);
      const sameRole = new Set(roles).size < roles.length;
      const times = ids.map((i) => (i.hire ? Date.parse(i.hire) : NaN)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
      let minGapDays: number | null = null;
      for (let k = 1; k < times.length; k++) {
        const gap = (times[k] - times[k - 1]) / 86400000;
        minGapDays = minGapDays == null ? gap : Math.min(minGapDays, gap);
      }
      const closeHire = minGapDays != null && minGapDays < 90;
      gs.push({
        name: fullName(ids[0].fn, ids[0].ln), fn: ids[0].fn ?? '', ln: ids[0].ln ?? '',
        ids, closeHire, minGapDays, flagged: sameRole || closeHire,
      });
    }
    gs.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.ids.length - a.ids.length || a.name.localeCompare(b.name));
    return gs;
  }, [rows]);

  const flaggedCount = useMemo(() => groups.filter((g) => g.flagged).length, [groups]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const view = flaggedOnly ? groups.filter((g) => g.flagged) : groups;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setExpanded((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <Card withBorder padding="lg" id="duplicates">
      <Group justify="space-between" mb="xs" wrap="wrap" gap="sm">
        <Title order={4}>Possible duplicate identities (review)</Title>
        {flaggedCount > 0 && (
          <Switch size="xs" label="Flagged only" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.currentTarget.checked)} />
        )}
      </Group>
      <Stack gap="sm">
        <Text size="sm">
          People are matched across snapshots by <b>name + hire date</b> (no employee ID exists in the source).
          That can fail two ways: one name can <b>split</b> into two records, or — harder to spot — two different
          people can be <b>merged</b> into one. Expand a group to see the people behind a shared name; a group is{' '}
          <b>flagged</b> when two identities share the same title + school, or their hire dates are under 90 days
          apart — a likely single person split in two.
        </Text>

        {rows == null ? (
          <Loader size="sm" />
        ) : groups.length === 0 ? (
          <Text size="sm" c="dimmed">No shared-name groups in this snapshot.</Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">{num(flaggedCount)} flagged · {num(groups.length)} shared-name groups.</Text>
            {view.length === 0 ? (
              <Text size="sm" c="dimmed">No flagged groups.</Text>
            ) : (
              <ScrollArea.Autosize mah={560} type="auto" offsetScrollbars="present">
                <Stack gap={0}>
                  {view.map((g) => {
                    const open = expanded.has(g.name);
                    return (
                      <Fragment key={`${g.fn}|${g.ln}`}>
                        <Group
                          wrap="nowrap" gap="sm" py="xs"
                          style={{ cursor: 'pointer', borderTop: '1px solid var(--mantine-color-default-border)' }}
                          onClick={() => toggle(g.name)} role="button" tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.name); } }}
                        >
                          <IconChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease', flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
                          <Text size="sm" fw={500} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>{g.name}</Text>
                          {g.closeHire && g.minGapDays != null && (
                            <Text size="xs" c="orange" style={{ flexShrink: 0 }}>hires {Math.round(g.minGapDays)}d apart</Text>
                          )}
                          {g.flagged ? (
                            <Badge color="orange" variant="light" radius="sm" leftSection={<IconAlertTriangle size={11} />}>possible duplicate</Badge>
                          ) : (
                            <Badge color="gray" variant="light" radius="sm">likely different</Badge>
                          )}
                          <Badge color="yellow" variant="light" radius="sm">{g.ids.length}</Badge>
                        </Group>
                        {open && g.ids.map((id) => (
                          <Group
                            key={id.person_key} justify="space-between" wrap="nowrap" gap="sm" py={8}
                            style={{ paddingLeft: 38, borderTop: '1px dashed var(--mantine-color-default-border)' }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <IdentityPreview personKey={id.person_key} title={id.title ?? '—'} name={g.name} />
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {[id.school, id.department].filter(Boolean).join(' · ') || '—'}
                              </Text>
                              <Text size="xs" c="dimmed">
                                hired {id.hire ? id.hire.slice(0, 10) : 'unknown'} · {usd(id.pay)}
                              </Text>
                            </div>
                            <Anchor component={Link} to={`/person/${encodeURIComponent(id.person_key)}`} size="xs" style={{ flexShrink: 0 }}>
                              View record →
                            </Anchor>
                          </Group>
                        ))}
                      </Fragment>
                    );
                  })}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
