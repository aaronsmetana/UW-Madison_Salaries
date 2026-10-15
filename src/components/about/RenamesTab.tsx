import { Fragment, useMemo, useState } from 'react';
import { Anchor, Badge, Card, Group, Loader, Popover, Stack, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react';
import { CardTitle } from '../CardTitle';
import { Eyebrow } from '../Eyebrow';
import { NewBadge } from '../NewBadge';
import { ShowAll, useShowAll } from '../ShowAll';
import { StatCard, StatRow } from '../StatCard';
import { useDepartmentChanges, useSql, useSummary } from '../../lib/hooks';
import { sqlStr } from '../../lib/duckdb';
import { mainOf, personPay } from '../../lib/queries';
import { fullName, num, usd } from '../../lib/format';
import { ICON } from '../../lib/ui';
import { SectionLink } from './shared';

/** How many renames a release shows before its "Show all". */
const RENAME_ROWS = 10;
const share = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Department renames, release by release: a list of the releases, and for the one chosen its renames (carried
 * under the new name), its mergers (left as they were) and where its ended departments went. Read from
 * departments.json; the totals are the releases' own counts summed, so the two never disagree.
 */
function RenamesCard() {
  const { data } = useDepartmentChanges();
  const { data: summary } = useSummary();
  const label = (id: string) => summary?.snapshots.find((s) => s.id === id)?.label ?? id;
  const steps = useMemo(() => [...(data?.steps ?? [])].reverse(), [data]);
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState('');
  const [endedOpen, setEndedOpen] = useState(false);
  const cur = steps[sel];
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (cur?.carried ?? []).filter((r) => !needle || `${r.school ?? ''} ${r.from} ${r.to}`.toLowerCase().includes(needle)), [cur, needle]);
  const page = useShowAll(rows, `${sel}|${needle}`, RENAME_ROWS);
  if (!data || !summary) return <Card id="departments"><Loader size="sm" /></Card>;
  const totals = steps.reduce((t, s) => ({ renamed: t.renamed + s.carried.length, merged: t.merged + s.mergers.length, ended: t.ended + s.gone.length }), { renamed: 0, merged: 0, ended: 0 });
  const most = Math.max(1, ...steps.map((s) => s.carried.length + s.mergers.length + s.gone.length));
  const newest = summary.latest?.id;
  const pick = (i: number) => { setSel(i); setQ(''); setEndedOpen(false); };
  const deptLink = (school: string | null, dept: string) =>
    `/divisions?${new URLSearchParams({ ...(school ? { school } : {}), dept }).toString()}`;
  return (
    <Card id="departments" className="department-renames">
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap" mb="md">
        <div style={{ flex: '1 1 460px', minWidth: 0 }}>
          <CardTitle anchorId="departments" mb={4}>Department renames</CardTitle>
          <Text size="sm" c="dimmed" maw="80ch">
            A department is carried under its new name when at least {share(data.rule.share)} of its continuing people ({data.rule.min} or more)
            land in one new department of the same school, and they make up {share(data.rule.share)} of it. Mergers are left as they were, so
            no older unit&apos;s history is overwritten.
          </Text>
        </div>
        <Group gap="md" className="rename-totals">
          <span><span className="rename-key rename-key-renamed" aria-hidden />Renamed <b className="tabular">{num(totals.renamed)}</b></span>
          <span><span className="rename-key rename-key-merged" aria-hidden />Merged <b className="tabular">{num(totals.merged)}</b></span>
          <span><span className="rename-key rename-key-ended" aria-hidden />Ended <b className="tabular">{num(totals.ended)}</b></span>
        </Group>
      </Group>
      <div className="rename-panes">
        <div role="group" aria-label="Releases" className="rename-releases">
          {steps.map((s, i) => {
            const n = s.carried.length + s.mergers.length + s.gone.length;
            return (
              <UnstyledButton key={s.to} className="rename-release" aria-pressed={i === sel} data-step={s.to} onClick={() => pick(i)}>
                <Group gap={6} wrap="nowrap" justify="space-between">
                  <Text size="sm" fw={650}>{label(s.from)} → {label(s.to)}</Text>
                  {s.to === newest && <NewBadge />}
                </Group>
                <Text size="xs" c="dimmed">{num(s.carried.length)} renamed · {num(s.mergers.length)} merged · {num(s.gone.length)} ended</Text>
                <span className="rename-minibar" aria-hidden style={{ width: `${(n / most) * 100}%` }}>
                  <span className="rename-key-renamed" style={{ flex: s.carried.length }} />
                  <span className="rename-key-merged" style={{ flex: s.mergers.length }} />
                  <span className="rename-key-ended" style={{ flex: s.gone.length }} />
                </span>
              </UnstyledButton>
            );
          })}
        </div>
        {cur && (
          <div className="rename-detail" data-step={cur.to}>
            <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap" mb="sm">
              <div>
                <Eyebrow>Renamed, carried under the new name</Eyebrow>
                <Title order={3} fz="md" fw={650}>{label(cur.from)} → {label(cur.to)}</Title>
              </div>
              <TextInput size="sm" w={260} maw="100%" label="Filter renames" placeholder="School or department" className="rename-filter"
                leftSection={<IconSearch size={ICON.compact} aria-hidden />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </Group>
            {rows.length === 0 ? (
              <Text size="sm" c="dimmed" py="sm" className="rename-empty">
                {cur.carried.length === 0 ? 'No department was renamed in this release.' : 'No rename matches that filter.'}
              </Text>
            ) : (
              <>
                <Table.ScrollContainer minWidth={560}>
                  <Table verticalSpacing={6} className="dept-table" data-kind="carried">
                    <Table.Thead><Table.Tr><Table.Th>School</Table.Th><Table.Th>Was</Table.Th><Table.Th>Now</Table.Th><Table.Th ta="right">People</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {page.shown.map((r) => (
                        <Table.Tr key={`${r.school}|${r.from}`}>
                          <Table.Td><Text size="sm">{r.school ?? '—'}</Text></Table.Td>
                          <Table.Td><Text size="sm" c="dimmed" td="line-through">{r.from}</Text></Table.Td>
                          <Table.Td><Anchor component={Link} to={deptLink(r.school, r.to)} size="sm">{r.to}</Anchor></Table.Td>
                          <Table.Td ta="right" className="tabular">{num(r.carried)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <ShowAll shown={page.shown.length} total={page.total} onShowAll={page.showAll} pager={page.pager} />
              </>
            )}
            {cur.mergers.length > 0 && (
              <Stack gap={4} mt="md" className="rename-mergers">
                <Eyebrow>Merged, not carried</Eyebrow>
                {cur.mergers.map((m) => (
                  <Text key={`${m.school}|${m.to}`} size="sm">
                    <Text span c="dimmed" inherit>{m.from.map((f) => f.department).join(' + ')}</Text> <span aria-hidden>→</span> <b>{m.to}</b>{' '}
                    <Text span c="dimmed" size="xs">· {m.school}</Text>
                  </Text>
                ))}
              </Stack>
            )}
            {cur.gone.length > 0 && (
              <div className="rename-ended">
                <UnstyledButton className="rename-ended-toggle" aria-expanded={endedOpen} onClick={() => setEndedOpen((o) => !o)}>
                  <Group gap={6} wrap="nowrap">
                    {endedOpen ? <IconChevronDown size={ICON.compact} aria-hidden /> : <IconChevronRight size={ICON.compact} aria-hidden />}
                    <Text size="sm" fw={600}>{endedOpen ? 'Hide ended departments' : `Where the ${num(cur.gone.length)} ended departments went`}</Text>
                  </Group>
                </UnstyledButton>
                {endedOpen && (
                  <ul className="rename-ended-list">
                    {cur.gone.map((g) => (
                      <li key={`${g.school}|${g.department}`}>
                        <Text size="sm"><b>{g.department}</b> <Text span c="dimmed" size="xs">· {g.school}</Text></Text>
                        <Text size="xs" c="dimmed">
                          {g.to
                            ? `${share(g.share)} of ${num(g.carried)} to ${g.to}${g.to_school && g.to_school !== g.school ? ` (${g.to_school})` : ''}`
                            : g.people === 1 ? 'Its one person is not in the next release' : `None of its ${num(g.people)} people are in the next release`}
                        </Text>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

interface IdRow {
  person_key: string; fn: string | null; ln: string | null;
  title: string | null; school: string | null; department: string | null;
  hire: string | null; pay: number | null;
}
interface DupGroup { name: string; fn: string; ln: string; ids: IdRow[]; flagged: boolean; why: string | null }

/** A person → a small preview of their title history across snapshots, and a link to the full record. */
function IdentityPreview({ personKey, title, name }: { personKey: string; title: string; name: string }) {
  const [opened, setOpened] = useState(false);
  const { data } = useSql<{ label: string; title: string | null; school: string | null }>(
    ['dup-preview', personKey],
    `SELECT any_value(snapshot_label) AS "label", ${mainOf('title')} title, ${mainOf('school')} school
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
        <Anchor component={Link} to={`/person/${encodeURIComponent(personKey)}`} size="xs" mt="xs" display="inline-block">View full record →</Anchor>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * Where name + hire-date matching may have gone wrong: the people rejoined after a hire-date change, then the
 * shared-name groups — those flagged first, each saying why (two identities share a title and school, or their hire
 * dates fall under 90 days apart), the rest one press away.
 */
function DuplicatesCard({ snap }: { snap?: string }) {
  const { data: summary } = useSummary();
  // `personPay` and `mainOf` go in unqualified: `dupnames` carries only the two name columns, so the columns they
  // read resolve to `s` unambiguously.
  const { data: rows } = useSql<IdRow>(
    ['dup-identities', snap ?? ''],
    `WITH dupnames AS (
        SELECT first_name, last_name FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND first_name IS NOT NULL AND last_name IS NOT NULL
        GROUP BY first_name, last_name HAVING count(DISTINCT person_key) > 1
     )
     SELECT s.person_key, any_value(s.first_name) fn, any_value(s.last_name) ln,
        ${mainOf('title')} title, ${mainOf('school')} school,
        ${mainOf('department')} department, any_value(s.date_of_hire) hire,
        ${personPay('fte')} pay
     FROM salaries s JOIN dupnames d ON s.first_name = d.first_name AND s.last_name = d.last_name
     WHERE s.snapshot_id = ${sqlStr(snap ?? '')} GROUP BY s.person_key ORDER BY ln, fn`,
    !!snap
  );
  const groups = useMemo<DupGroup[]>(() => {
    const m = new Map<string, IdRow[]>();
    for (const r of rows ?? []) {
      const key = `${r.fn ?? ''}|${r.ln ?? ''}`;
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    const gs: DupGroup[] = [];
    for (const ids of m.values()) {
      if (ids.length < 2) continue;
      const roles = ids.map((i) => `${(i.title ?? '').toLowerCase()}|${(i.school ?? '').toLowerCase()}`);
      const sameRole = new Set(roles).size < roles.length;
      const times = ids.map((i) => (i.hire ? Date.parse(i.hire) : NaN)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
      let gap: number | null = null;
      for (let k = 1; k < times.length; k++) {
        const d = (times[k] - times[k - 1]) / 86400000;
        gap = gap == null ? d : Math.min(gap, d);
      }
      const closeHire = gap != null && gap < 90;
      // Why, from the rule itself: a close hire date says how close; otherwise the shared title and school.
      const why = closeHire ? `Hire dates ${Math.round(gap!)} ${Math.round(gap!) === 1 ? 'day' : 'days'} apart` : sameRole ? 'Same title and school' : null;
      gs.push({ name: fullName(ids[0].fn, ids[0].ln), fn: ids[0].fn ?? '', ln: ids[0].ln ?? '', ids, flagged: closeHire || sameRole, why });
    }
    gs.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.ids.length - a.ids.length || a.name.localeCompare(b.name));
    return gs;
  }, [rows]);
  const flagged = groups.filter((g) => g.flagged);
  const rest = groups.filter((g) => !g.flagged);
  const [showRest, setShowRest] = useState(false);
  const restPage = useShowAll(rest, showRest);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const groupRow = (g: DupGroup) => {
    const k = `${g.fn}|${g.ln}`;
    const isOpen = open.has(k);
    return (
      <Fragment key={k}>
        <Table.Tr data-flagged={g.flagged || undefined} className="dup-row">
          <Table.Td>
            <Group gap={6} wrap="nowrap">
              <UnstyledButton aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} the people named ${g.name}`} onClick={() => toggle(k)} className="dup-toggle">
                {isOpen ? <IconChevronDown size={ICON.compact} aria-hidden /> : <IconChevronRight size={ICON.compact} aria-hidden />}
              </UnstyledButton>
              <Anchor component={Link} to={`/?q=${encodeURIComponent(g.name)}`} size="sm" fw={500}>{g.name}</Anchor>
            </Group>
          </Table.Td>
          <Table.Td ta="right" className="tabular">{g.ids.length}</Table.Td>
          <Table.Td><Text size="sm" c={g.flagged ? undefined : 'dimmed'}>{g.why ?? 'Different titles or schools, hires far apart'}</Text></Table.Td>
          <Table.Td>
            {g.flagged
              ? <Badge variant="light" color="orange" radius="sm" tt="none" className="caution-pill">Possible duplicate</Badge>
              : <Badge variant="light" color="gray" radius="sm" tt="none">Likely different</Badge>}
          </Table.Td>
        </Table.Tr>
        {isOpen && g.ids.map((id) => (
          <Table.Tr key={id.person_key} className="dup-identity">
            <Table.Td colSpan={4}>
              <Group justify="space-between" wrap="nowrap" gap="sm" pl={28}>
                <div style={{ minWidth: 0 }}>
                  <IdentityPreview personKey={id.person_key} title={id.title ?? '—'} name={g.name} />
                  <Text size="xs" c="dimmed" lineClamp={1}>{[id.school, id.department].filter(Boolean).join(' · ') || '—'}</Text>
                  <Text size="xs" c="dimmed">hired {id.hire ? id.hire.slice(0, 10) : 'unknown'} · {usd(id.pay)}</Text>
                </div>
                <Anchor component={Link} to={`/person/${encodeURIComponent(id.person_key)}`} size="xs" style={{ flexShrink: 0 }}>View record →</Anchor>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Fragment>
    );
  };

  return (
    <Card id="duplicates">
      <CardTitle anchorId="duplicates"
        sub={<>There is no employee ID, so people are matched by <SectionLink id="identity" inherit>name and hire date</SectionLink>. A shared-name group
          is flagged when two identities share a title and school, or their hire dates are under 90 days apart: likely one person split in two.</>}>
        Possible duplicate identities
      </CardTitle>
      <StatRow cols={{ base: 1, sm: 3 }} label="Identity matching in figures">
        <StatCard figure="rejoined" label="Rejoined after a hire-date change" value={summary?.joined_people != null ? num(summary.joined_people) : '—'} sub="Same name, division and title or department" />
        <StatCard figure="shared-names" label="Shared-name groups" value={rows ? num(groups.length) : '—'} sub={rows ? `${num(rest.length)} look like different people` : undefined} />
        <StatCard figure="flagged" label="Flagged for review" value={rows ? <Text span inherit className="caution-text">{num(flagged.length)}</Text> : '—'} sub="Shown below" />
      </StatRow>
      {rows == null ? <Loader size="sm" mt="md" /> : groups.length === 0 ? (
        <Text size="sm" c="dimmed" mt="md">No shared-name groups in this snapshot.</Text>
      ) : (
        <>
          <Table.ScrollContainer minWidth={560} mt="md">
            <Table verticalSpacing={8} className="dup-table">
              <Table.Thead>
                <Table.Tr><Table.Th>Name</Table.Th><Table.Th ta="right">Identities</Table.Th><Table.Th>Why flagged</Table.Th><Table.Th>Verdict</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {flagged.map(groupRow)}
                {showRest && restPage.shown.map(groupRow)}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {showRest && <ShowAll shown={restPage.shown.length} total={restPage.total} onShowAll={restPage.showAll} pager={restPage.pager} />}
          {rest.length > 0 && (
            <Group justify="space-between" gap="sm" mt="sm" wrap="wrap">
              <Text size="sm" c="dimmed">{num(rest.length)} more shared-name groups are likely different people.</Text>
              <UnstyledButton className="text-button" aria-expanded={showRest} onClick={() => setShowRest((s) => !s)}>
                <Text size="sm" fw={600} c="var(--text-accent)">{showRest ? 'Show the flagged only' : `Show all ${num(groups.length)}`}</Text>
              </UnstyledButton>
            </Group>
          )}
        </>
      )}
    </Card>
  );
}

export function RenamesTab({ snap }: { snap?: string }) {
  return (
    <Stack gap="lg">
      <RenamesCard />
      <DuplicatesCard snap={snap} />
    </Stack>
  );
}
