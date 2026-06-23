import { Suspense } from 'react';
import { AppShell, Group, Title, NavLink, Box, Anchor, Burger, Tooltip, Divider, Button, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconUserSearch, IconBriefcase, IconBuildingBank, IconArrowsDiff, IconReportAnalytics, IconInfoCircle,
  IconChevronLeft, IconChevronRight,
} from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { CommandSearch } from '../components/CommandSearch';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalLoadingBar, LoadingState, DataErrorBanner } from '../components/Loading';

const NAV = [
  { label: "Search Person's Salary", to: '/', icon: IconUserSearch },
  { label: 'Search Title Salaries', to: '/paycheck', icon: IconBriefcase },
  { label: 'General Comparisons', to: '/explore', icon: IconBuildingBank },
  { label: 'Compare People/Title/Schools', to: '/compare', icon: IconArrowsDiff },
  { label: 'Reports', to: '/reports', icon: IconReportAnalytics },
];

// the control bar (scope/snapshot/metric/filters) only matters on these data views
// Explore + Compare render their own controls inline in the page content, so they're excluded here.
const CONTROL_PATHS = ['/school', '/title'];

export function AppShellLayout() {
  const loc = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const [collapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  const showControl = CONTROL_PATHS.some((p) => loc.pathname.startsWith(p));

  const renderLink = (n: (typeof NAV)[number], dimmed = false) => {
    const Icon = n.icon;
    const active = isActive(n.to);
    const link = (
      <NavLink
        component={Link}
        to={n.to}
        label={collapsed ? undefined : n.label}
        leftSection={<Icon size={20} stroke={1.7} />}
        active={active}
        variant="light"
        color={active ? 'accent' : undefined}
        c={dimmed && !active ? 'dimmed' : undefined}
        styles={{
          root: {
            borderRadius: 'var(--mantine-radius-sm)',
            marginBottom: 2,
            // Teal left rail on the active item (matches the spec's inset accent bar).
            boxShadow: active ? 'inset 3px 0 0 0 var(--mantine-color-accent-7), inset 0 0 0 1px rgba(14,110,131,.10)' : undefined,
          },
          label: { fontWeight: active ? 700 : 500 },
          section: collapsed ? { marginInlineEnd: 0 } : undefined,
          body: collapsed ? { display: 'none' } : undefined,
        }}
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
    <>
      <GlobalLoadingBar />
      <AppShell
        header={{ height: showControl ? 104 : 64 }}
        navbar={{ width: collapsed ? 64 : 330, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h={64} px="md" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              {/* Mobile-only burger opens the nav drawer; desktop collapse lives at the bottom of the sidebar. */}
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
              <Anchor component={Link} to="/" underline="never" c="inherit">
                <Group gap={10} wrap="nowrap">
                  {/* Logo tile: accent-gradient square with a white $ glyph. */}
                  <Box
                    w={30}
                    h={30}
                    style={{ borderRadius: 9, background: 'var(--accent-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Text fw={800} c="white" fz={16} lh={1}>$</Text>
                  </Box>
                  <Title order={4} style={{ fontWeight: 800, letterSpacing: '-0.015em' }}>UW–Madison Salaries</Title>
                </Group>
              </Anchor>
            </Group>
            <Group gap="md" wrap="nowrap">
              <CommandSearch />
              {/* Data-source + author credit, tucked into the upper-right corner (opposite the logo). */}
              <Stack gap={0} align="flex-end" visibleFrom="sm" style={{ lineHeight: 1.2 }}>
                <Text c="dimmed" ta="right" style={{ fontSize: 11 }}>
                  Salary report files sourced from the work of{' '}
                  <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" c="accent.7" underline="hover" inherit>
                    UFAS Local 223
                  </Anchor>
                </Text>
                <Text c="dimmed" ta="center" w="100%" style={{ fontSize: 11 }}>Built by Aaron Smetana</Text>
              </Stack>
            </Group>
          </Group>
          {showControl && <ControlBar />}
        </AppShell.Header>

        <AppShell.Navbar p="sm">
          <Box style={{ flex: 1 }}>{NAV.map((n) => renderLink(n))}</Box>
          <Divider my="xs" />
          {renderLink({ label: 'Data · About', to: '/data', icon: IconInfoCircle }, true)}
          {/* Collapse/expand toggle anchored at the bottom of the sidebar (desktop only). */}
          <Tooltip label="Expand menu" position="right" withArrow disabled={!collapsed}>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              mt="xs"
              fullWidth
              visibleFrom="sm"
              justify={collapsed ? 'center' : 'flex-start'}
              px={collapsed ? 0 : undefined}
              onClick={toggleDesktop}
              leftSection={collapsed ? undefined : <IconChevronLeft size={18} />}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {collapsed ? <IconChevronRight size={18} /> : 'Collapse'}
            </Button>
          </Tooltip>
        </AppShell.Navbar>

        <AppShell.Main style={{ paddingBottom: 96 }}>
          <DataErrorBanner />
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<LoadingState label="Loading…" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </AppShell.Main>
      </AppShell>

      {/* Floating "cart"-style selection tray — hidden on /compare (selections shown in-page) and on
          /reports (it's a tool, not part of the formal negotiation document). */}
      {!loc.pathname.startsWith('/compare') && !loc.pathname.startsWith('/reports') && <SelectionTray />}
    </>
  );
}
