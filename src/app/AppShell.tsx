import { Suspense } from 'react';
import { AppShell, Group, Title, NavLink, Box, Loader } from '@mantine/core';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { CommandSearch } from '../components/CommandSearch';
import { ErrorBoundary } from '../components/ErrorBoundary';

const NAV = [
  { label: 'Explore', to: '/' },
  { label: 'Compare', to: '/compare' },
  { label: 'Reports', to: '/reports' },
];

export function AppShellLayout() {
  const loc = useLocation();
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  return (
    <AppShell
      header={{ height: 96 }}
      navbar={{ width: 210, breakpoint: 'sm' }}
      footer={{ height: 56 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h={48} px="md" justify="space-between" wrap="nowrap">
          <Title order={4}>UW–Madison Salaries</Title>
          <CommandSearch />
        </Group>
        <ControlBar />
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Box style={{ flex: 1 }}>
          {NAV.map((n) => (
            <NavLink key={n.to} component={Link} to={n.to} label={n.label} active={isActive(n.to)} />
          ))}
        </Box>
        <NavLink component={Link} to="/data" label="Data · About" active={isActive('/data')} c="dimmed" />
      </AppShell.Navbar>

      <AppShell.Main>
        <ErrorBoundary key={loc.pathname}>
          <Suspense fallback={<Loader />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </AppShell.Main>

      <AppShell.Footer>
        <SelectionTray />
      </AppShell.Footer>
    </AppShell>
  );
}
