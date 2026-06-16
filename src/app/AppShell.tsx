import { Suspense } from 'react';
import { AppShell, Group, Title, NavLink, Box, Loader, Anchor, Burger, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconUserSearch, IconBriefcase, IconBuildingBank, IconArrowsDiff, IconReportAnalytics, IconInfoCircle,
} from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { CommandSearch } from '../components/CommandSearch';
import { ErrorBoundary } from '../components/ErrorBoundary';

const NAV = [
  { label: 'Search Person', to: '/', icon: IconUserSearch },
  { label: 'Search Title Salaries', to: '/paycheck', icon: IconBriefcase },
  { label: 'Compare Divisions/Schools', to: '/explore', icon: IconBuildingBank },
  { label: 'Compare People/Title/Schools', to: '/compare', icon: IconArrowsDiff },
  { label: 'Reports', to: '/reports', icon: IconReportAnalytics },
];

// the control bar (scope/snapshot/metric/filters) only matters on these data views
const CONTROL_PATHS = ['/explore', '/compare', '/school', '/title'];

export function AppShellLayout() {
  const loc = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const [collapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  const showControl = CONTROL_PATHS.some((p) => loc.pathname.startsWith(p));

  const renderLink = (n: (typeof NAV)[number], dimmed = false) => {
    const Icon = n.icon;
    const link = (
      <NavLink
        component={Link}
        to={n.to}
        label={collapsed ? undefined : n.label}
        leftSection={<Icon size={20} stroke={1.7} />}
        active={isActive(n.to)}
        c={dimmed ? 'dimmed' : undefined}
        styles={collapsed ? { section: { marginInlineEnd: 0 }, body: { display: 'none' } } : undefined}
      />
    );
    return collapsed ? (
      <Tooltip key={n.to} label={n.label} position="right" withArrow>
        {link}
      </Tooltip>
    ) : (
      <Box key={n.to}>{link}</Box>
    );
  };

  return (
    <AppShell
      header={{ height: showControl ? 96 : 48 }}
      navbar={{ width: collapsed ? 64 : 263, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      footer={{ height: 56 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h={48} px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Burger opened={!collapsed} onClick={toggleDesktop} visibleFrom="sm" size="sm" aria-label="Collapse navigation" />
            <Anchor component={Link} to="/" underline="never" c="inherit">
              <Title order={4}>UW–Madison Salaries</Title>
            </Anchor>
          </Group>
          <CommandSearch />
        </Group>
        {showControl && <ControlBar />}
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Box style={{ flex: 1 }}>{NAV.map((n) => renderLink(n))}</Box>
        {renderLink({ label: 'Data · About', to: '/data', icon: IconInfoCircle }, true)}
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
