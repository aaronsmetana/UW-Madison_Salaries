import { Suspense, useEffect } from 'react';
import { AppShell, Group, NavLink, Box, Anchor, Burger, Tooltip, Divider, Button, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconUserSearch, IconBriefcase, IconBuildingBank, IconArrowsDiff, IconReportAnalytics, IconInfoCircle,
  IconChevronLeft, IconChevronRight, IconListSearch,
} from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { Footer } from './Footer';
import { ColorSchemeToggle } from '../components/ColorSchemeToggle';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalLoadingBar, LoadingState, DataErrorBanner, OfflineBanner } from '../components/Loading';

// Destinations, not instructions. These read as query verbs — "Search Person's Salary", "General
// Comparisons" — which describe what the software does rather than what the visitor is looking at, and
// the longest of them ("Compare People, Titles & Schools") wrapped to two lines in the sidebar. A nav
// label's job is to name the place it goes; the page's own description says what you can do there.
//
// Each label is also the h1 of the page it opens, so arriving somewhere confirms the link you clicked.
const NAV = [
  { label: 'People', to: '/', icon: IconUserSearch },
  { label: 'Titles', to: '/paycheck', icon: IconBriefcase },
  { label: 'Divisions', to: '/explore', icon: IconBuildingBank },
  { label: 'Compare', to: '/compare', icon: IconArrowsDiff },
  { label: 'Reports', to: '/reports', icon: IconReportAnalytics },
  { label: 'Screening', to: '/screening', icon: IconListSearch },
];

// the control bar (scope/snapshot/metric/filters) only matters on these data views
// Explore + Compare render their own controls inline in the page content, so they're excluded here.
// (Titles render via /paycheck, which has its own inline pickers — no global control bar.)
const CONTROL_PATHS = ['/school'];

export function AppShellLayout() {
  const loc = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const [collapsed, { toggle: toggleDesktop }] = useDisclosure(false);

  // Force the light color scheme for the duration of any print. print.css paints the page white, but
  // Mantine's dark-scheme text vars stay light — printing from dark mode would put near-white text on
  // white paper. Swap to light for the print, then restore. Global (helps every printable page).
  useEffect(() => {
    const el = document.documentElement;
    let prev: string | null = null;
    const before = () => {
      prev = el.getAttribute('data-mantine-color-scheme');
      el.setAttribute('data-mantine-color-scheme', 'light');
    };
    const after = () => {
      if (prev != null) el.setAttribute('data-mantine-color-scheme', prev);
      prev = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
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
        // The control bar's height is not fixed: its scope/snapshot/metric groups wrap as the viewport
        // narrows. A single hardcoded 104px was 7px short even at 1440px and 19px short below 768px,
        // so the bar spilled past the header and collided with the page content beneath it. Measured
        // values plus a little slack, per breakpoint.
        header={{ height: showControl ? { base: 136, sm: 116 } : 64 }}
        navbar={{ width: collapsed ? 64 : 330, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
        footer={{ height: 40 }}
        padding="md"
      >
        <AppShell.Header>
          <Group h={64} px="md" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              {/* Mobile-only burger opens the nav drawer; desktop collapse lives at the bottom of the sidebar. */}
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
              <Anchor component={Link} to="/" underline="never" c="inherit">
                <Group gap={11} wrap="nowrap" align="center">
                  {/* Logo mark: ascending bars (salary distribution) on the accent-gradient tile. */}
                  <Box
                    w={34}
                    h={34}
                    style={{
                      borderRadius: 10,
                      background: 'var(--accent-grad)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width={19} height={19} viewBox="0 0 18 18" aria-hidden role="img">
                      <rect x={1.5} y={10} width={3.4} height={6.5} rx={1.2} fill="white" fillOpacity={0.72} />
                      <rect x={7.3} y={6} width={3.4} height={10.5} rx={1.2} fill="white" fillOpacity={0.88} />
                      <rect x={13.1} y={2} width={3.4} height={14.5} rx={1.2} fill="white" />
                    </svg>
                  </Box>
                  {/* Two-tone wordmark + small uppercase eyebrow for a masthead feel. */}
                  <Stack gap={0} style={{ lineHeight: 1.05 }}>
                    {/* Deliberately not `Eyebrow`, though it looks like one: the wide 0.14em tracking is
                        a masthead device, and Eyebrow's contract fixes its own spacing. The size is the
                        shared `xxs` token rather than the 9px literal it used to carry — below the
                        scale's floor, and the smallest text anywhere in the app. */}
                    <Text fz="xxs" fw={700} lts="0.14em" tt="uppercase" c="dimmed" visibleFrom="xs">
                      Open record salary data
                    </Text>
                    <Text component="span" fz="lg" fw={700} lts="-0.02em" style={{ lineHeight: 1.1 }}>
                      <Text span inherit c="bright">UW–Madison </Text>
                      <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
                    </Text>
                  </Stack>
                </Group>
              </Anchor>
            </Group>
            <Group gap="md" wrap="nowrap">
              <ColorSchemeToggle />
              {/* Data-source + author credit, tucked into the upper-right corner (opposite the logo). */}
              <Stack gap={0} align="flex-end" visibleFrom="sm" style={{ lineHeight: 1.2 }}>
                <Text c="dimmed" ta="right" fz="xxs">
                  Public salary records obtained via open-records requests by{' '}
                  <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" c="accent.7" underline="always" inherit className="accent7-text">
                    UFAS Local 223
                  </Anchor>
                </Text>
                {/* `ta="center" w="100%"` centred this under the longer line above, which read as a
                    misalignment in a right-aligned stack. Inherit the stack's own alignment instead. */}
                <Text c="dimmed" fz="xxs">Built by Aaron Smetana</Text>
              </Stack>
            </Group>
          </Group>
          {showControl && <ControlBar />}
        </AppShell.Header>

        <AppShell.Navbar p="sm">
          <Box style={{ flex: 1 }}>{NAV.map((n) => renderLink(n))}</Box>
          <Divider my="xs" />
          {renderLink({ label: 'About the data', to: '/data', icon: IconInfoCircle }, true)}
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

        <AppShell.Main style={{ paddingBottom: 'calc(var(--app-shell-footer-offset, 0rem) + 96px)' }}>
          <OfflineBanner />
          <DataErrorBanner />
          <div key={loc.pathname} className="route-rise">
            <ErrorBoundary key={loc.pathname}>
              <Suspense fallback={<LoadingState label="Loading…" />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </AppShell.Main>

        <AppShell.Footer>
          <Footer />
        </AppShell.Footer>
      </AppShell>

      {/* Floating "cart"-style selection tray — hidden on /compare (selections shown in-page) and on
          /reports (it's a tool, not part of the formal negotiation document). */}
      {!loc.pathname.startsWith('/compare') && !loc.pathname.startsWith('/reports') && <SelectionTray />}
    </>
  );
}
