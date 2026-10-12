import type { ReactNode } from 'react';
import { Card, Stack, Text } from '@mantine/core';
import { PageHeader } from './PageHeader';
import { CardTitle } from './CardTitle';
import { SearchBox } from './SearchBox';

/**
 * What a page says when its address names nothing: what was not found, why links break, what is close to it,
 * and a search (NF1–NF3). An unknown person waited and then said "No records found for this person." alone;
 * an unknown title or division repeated the address in its heading, as if it existed.
 */
export function NotFoundPanel({ title, description, suggestions, searchKinds }: {
  title: string;
  description: ReactNode;
  /** Close matches, as links; left out when there are none. */
  suggestions?: ReactNode;
  searchKinds?: ('people' | 'titles' | 'divisions')[];
}) {
  return (
    <Stack gap="lg" className="not-found">
      <PageHeader title={title} description={description} />
      {suggestions && (
        <Card>
          <CardTitle>Did you mean</CardTitle>
          {suggestions}
        </Card>
      )}
      <Card>
        <CardTitle sub="People, titles and divisions, by name.">Search instead</CardTitle>
        <SearchBox kinds={searchKinds} placeholder="Search people, titles or divisions…" />
        <Text size="xs" c="dimmed" mt="xs">⌘K or Ctrl+K opens the same search from any page.</Text>
      </Card>
    </Stack>
  );
}
