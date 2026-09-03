import { Link } from 'react-router-dom';
import { Stack, Button, Group, Card } from '@mantine/core';
import {
  IconUserSearch, IconBriefcase, IconBuildingBank, IconArrowsDiff,
  IconReportAnalytics, IconListSearch,
} from '@tabler/icons-react';
import { CardTitle } from '../components/CardTitle';
import { PageHeader } from '../components/PageHeader';
import { useDocTitle } from '../lib/useDocTitle';
import { ICON } from '../lib/ui';

/**
 * The catch-all route.
 *
 * Without one, an address that matches nothing fell through to React Router's own error element,
 * which renders a bare "Unexpected Application Error! / 404 Not Found" on a blank page — no header,
 * no navigation, outside the theme entirely, and with no way back other than the browser's back
 * button. That is what a visitor following a stale or mistyped link actually saw, and it reads as a
 * broken site rather than a missing page.
 *
 * Rendered as a child of the shell so it keeps the header, sidebar and footer, and imported eagerly
 * rather than through `lazyWithRetry` like the other routes: this is the page that has to work when
 * something else has already gone wrong, and it should not depend on fetching another chunk.
 */

const DESTINATIONS = [
  { label: 'People', to: '/', icon: IconUserSearch },
  { label: 'Titles', to: '/paycheck', icon: IconBriefcase },
  { label: 'Divisions', to: '/explore', icon: IconBuildingBank },
  { label: 'Compare', to: '/compare', icon: IconArrowsDiff },
  { label: 'Reports', to: '/reports', icon: IconReportAnalytics },
  { label: 'Screening', to: '/screening', icon: IconListSearch },
];

export default function NotFound() {
  useDocTitle('Page not found');
  return (
    <Stack gap="lg">
      <PageHeader
        title="Page not found"
        description="That address doesn't match anything on this site. The link may be out of date, or it may have a typo in it."
      />
      {/* Not `EmptyState`: its h2 would restate the h1 above almost word for word. The second heading
          on this page should say something the first one doesn't — where to go. */}
      <Card>
        <CardTitle sub="Everything on the site is reachable from here.">Try one of these</CardTitle>
        <Group gap="sm" wrap="wrap">
          {DESTINATIONS.map(({ label, to, icon: Icon }) => (
            <Button
              key={to}
              component={Link}
              to={to}
              variant="default"
              size="sm"
              leftSection={<Icon size={ICON.control} stroke={1.7} />}
            >
              {label}
            </Button>
          ))}
        </Group>
      </Card>
    </Stack>
  );
}
