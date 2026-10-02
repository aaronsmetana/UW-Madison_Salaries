import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Stack, Card, Text, Anchor, SimpleGrid, Group } from '@mantine/core';
import { PageHeader } from '../components/PageHeader';
import { SearchBox } from '../components/SearchBox';
import { CardTitle } from '../components/CardTitle';
import { useDocTitle } from '../lib/useDocTitle';
import { useTray } from '../state/tray';
import { readRecent } from '../lib/recent';

/**
 * People: the place a person's page belongs to (its trail starts here, and the bar lights it there). Finding
 * someone by name, the people this browser looked at last, and the people in the compare set. The landing
 * page (Home) is the whole of UW on one graph; this is where you look for one person.
 */
export default function People() {
  useDocTitle('People');
  const nav = useNavigate();
  const [recent] = useState(readRecent);
  const { items } = useTray();
  const inSet = items.filter((i) => i.type === 'person');
  const list = (people: { key: string; name: string; sub?: string | null }[]) => (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
      {people.map((p) => (
        <Anchor key={p.key} component={Link} to={`/person/${encodeURIComponent(p.key)}`} underline="never" className="people-card">
          <Text fw={600}>{p.name}</Text>
          {p.sub && <Text size="xs" c="dimmed" lineClamp={1}>{p.sub}</Text>}
        </Anchor>
      ))}
    </SimpleGrid>
  );
  return (
    <Stack gap="lg">
      <PageHeader title="People" description="Find anyone at UW–Madison by name: what they are paid, how it compares with others in their title, and how it has changed." />
      <SearchBox
        kinds={['people']}
        size="lg"
        autoFocus
        placeholder="Search a person by name…"
        onPick={(h) => nav(`/person/${encodeURIComponent(h.person_key)}`)}
      />
      {recent.length > 0 && (
        <Card className="people-recent">
          <CardTitle sub="In this browser only, most recent first.">Recently viewed</CardTitle>
          {list(recent.map((r) => ({ key: r.key, name: r.name, sub: r.title })))}
        </Card>
      )}
      {inSet.length > 0 && (
        <Card className="people-set">
          <CardTitle sub={<>The people you have added to compare. <Anchor component={Link} to="/compare" inherit>Compare them</Anchor></>}>In your compare set</CardTitle>
          {list(inSet.map((i) => ({ key: i.id, name: i.label })))}
        </Card>
      )}
      {!recent.length && !inSet.length && (
        <Group gap={6}>
          <Text size="sm" c="dimmed">The people you open will be listed here.</Text>
        </Group>
      )}
    </Stack>
  );
}
