import { Suspense, useEffect, useRef, useState } from 'react';
import { AppShell, Group, NavLink, Box, Anchor, Burger, Tooltip, Divider, Button, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { Footer } from './Footer';
import { ColorSchemeToggle } from '../components/ColorSchemeToggle';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalLoadingBar, LoadingState, DataErrorBanner, OfflineBanner } from '../components/Loading';
import { CommandPalette, PaletteTrigger, usePalette } from '../components/CommandPalette';
import { NAV, ABOUT, type NavItem } from './nav';
import { consumeUpdate } from '../lib/appUpdate';
import { RevealProvider } from '../components/PersonReveal';
import { prefersReducedMotion } from '../lib/motion';

// the control bar (scope/snapshot/metric/filters) only matters on these data views
// Explore + Compare render their own controls inline in the page content, so they're excluded here.
// (Titles render via /paycheck, which has its own inline pickers — no global control bar.)
const CONTROL_PATHS = ['/school'];

/**
 * The sidebar's first look, once a visit: open, over the page's left edge — the page beneath is laid out
 * for the collapsed rail from the start, so nothing on it moves — for PEEK_MS, then narrowed into the rail
 * over PEEK_CLOSE_MS (app.css `.app-navbar-peek`), its labels fading as it goes. Not while a pointer is on
 * it or the keyboard is in it: then once they leave. Desktop only; a phone's sidebar is a drawer.
 */
const PEEK_MS = 2000;
const PEEK_CLOSE_MS = 450;
const PEEK_KEY = 'nav-peek';
/** This visit has already loaded the site: the sidebar has had its look, or the landing dots their fall. */
function visitStarted(): boolean {
  try {
    return sessionStorage.getItem(PEEK_KEY) === '1' || sessionStorage.getItem('dotfield-entrance') === '1';
  } catch {
    return true;
  }
}

export function AppShellLayout() {
  const loc = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const [collapsed, { toggle: toggleDesktop }] = useDisclosure(true);
  const [peek, setPeek] = useState<'open' | 'closing' | null>(() =>
    typeof window !== 'undefined' && !visitStarted() && !!window.matchMedia?.('(min-width: 48em)').matches ? 'open' : null);
  const navRef = useRef<HTMLElement>(null);
  const peekOnce = useRef(peek);
  useEffect(() => {
    if (peekOnce.current) { try { sessionStorage.setItem(PEEK_KEY, '1'); } catch { /* private mode */ } }
  }, []);
  useEffect(() => {
    if (peek !== 'open') return;
    const nav = navRef.current;
    let timer = 0;
    const tuck = () => {
      // Not out from under a pointer resting on it or a keyboard in it: once they have left.
      if (nav && (nav.matches(':hover') || nav.contains(document.activeElement))) {
        timer = window.setTimeout(tuck, 400);
        return;
      }
      setPeek(prefersReducedMotion() ? null : 'closing');
    };
    timer = window.setTimeout(tuck, PEEK_MS);
    return () => window.clearTimeout(timer);
  }, [peek]);
  useEffect(() => {
    if (peek !== 'closing') return;
    const timer = window.setTimeout(() => setPeek(null), PEEK_CLOSE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [peek]);
  // Labels show while the sidebar is open, or still narrowing from its first look.
  const labelled = !collapsed || peek != null;
  const palette = usePalette();

  // A newer build activated while this tab was open (see lib/appUpdate). Take it at the first
  // navigation: the reader has already left the view they were on, so a reload costs them nothing,
  // and they get the new bundle without ever being told to refresh. `consumeUpdate` is false on the
  // first render, so this never fires on load.
  useEffect(() => {
    if (consumeUpdate()) window.location.reload();
  }, [loc.pathname]);

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

  const renderLink = (n: NavItem, dimmed = false) => {
    const Icon = n.icon;
    const active = isActive(n.to);
    const link = (
      <NavLink
        component={Link}
        to={n.to}
        label={labelled ? n.label : undefined}
        // An icon alone names nothing: the rail's links carry their names for a screen reader.
        aria-label={labelled ? undefined : n.label}
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
          section: labelled ? undefined : { marginInlineEnd: 0 },
          body: labelled ? undefined : { display: 'none' },
        }}
      />
    );
    return !labelled ? (
      <Tooltip key={n.to} label={n.label} position="right" withArrow>
        {link}
      </Tooltip>
    ) : (
      <Box key={n.to}>{link}</Box>
    );
  };

  return (
    <RevealProvider>
      {/* First tab stop on every route. Without it a keyboard or screen-reader user crossed 12 focus
          stops of masthead and sidebar before reaching the page they navigated to — on every
          navigation, since the shell does not remount. Visually hidden until focused (see
          `.skip-link` in app.css). */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <GlobalLoadingBar />
      <AppShell
        // The control bar's height is not fixed: its scope/snapshot/metric groups wrap as the viewport
        // narrows. A single hardcoded 104px was 7px short even at 1440px and 19px short below 768px,
        // so the bar spilled past the header and collided with the page content beneath it. Measured
        // values plus a little slack, per breakpoint.
        header={{ height: showControl ? { base: 136, sm: 116 } : 64 }}
        navbar={{ width: collapsed ? 64 : 330, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
        // Fixed only from `sm` up. On a phone a fixed 40px band took the bottom of every screen, its text
        // wrapped to three lines so "Source on GitHub" was clipped, and the tray sat on top of it; there
        // the same footer ends the page instead (below, and `.mantine-AppShell-footer` in app.css).
        footer={{ height: { base: 0, sm: 40 } }}
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
              <PaletteTrigger onClick={palette.open} />
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

        <AppShell.Navbar p="sm" ref={navRef} className={peek ? 'app-navbar-peek' : undefined} data-peek={peek ?? undefined}>
          <Box style={{ flex: 1 }}>{NAV.map((n) => renderLink(n))}</Box>
          <Divider my="xs" />
          {renderLink(ABOUT, true)}
          {/* Collapse/expand toggle anchored at the bottom of the sidebar (desktop only). */}
          <Tooltip label="Expand menu" position="right" withArrow disabled={labelled}>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              mt="xs"
              fullWidth
              visibleFrom="sm"
              justify={labelled ? 'flex-start' : 'center'}
              px={labelled ? undefined : 0}
              // During its first look, collapsing is tucking it in now.
              onClick={() => (peek === 'open' ? setPeek(prefersReducedMotion() ? null : 'closing') : toggleDesktop())}
              leftSection={labelled ? <IconChevronLeft size={18} /> : undefined}
              aria-label={labelled ? 'Collapse navigation' : 'Expand navigation'}
            >
              {labelled ? <span className="app-navbar-toggle-label">Collapse</span> : <IconChevronRight size={18} />}
            </Button>
          </Tooltip>
        </AppShell.Navbar>

        <AppShell.Main
          id="main-content"
          // `<main>` is not focusable on its own, so following the skip link would scroll the page
          // but leave focus stranded back on the link. -1 makes it a valid focus target without
          // adding a tab stop of its own.
          tabIndex={-1}
          style={{ paddingBottom: 'calc(var(--app-shell-footer-offset, 0rem) + 96px)' }}
        >
          <OfflineBanner />
          <DataErrorBanner />
          <div key={loc.pathname} className="route-rise">
            <ErrorBoundary key={loc.pathname}>
              <Suspense fallback={<LoadingState label="Loading…" />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
          <Box hiddenFrom="sm" className="footer-inflow" mt="xl">
            <Footer />
          </Box>
        </AppShell.Main>

        <AppShell.Footer>
          <Footer />
        </AppShell.Footer>
      </AppShell>

      {/* Floating "cart"-style selection tray — hidden on /compare (selections shown in-page) and on
          /reports (it's a tool, not part of the formal negotiation document). */}
      {!loc.pathname.startsWith('/compare') && !loc.pathname.startsWith('/reports') && <SelectionTray />}

      {/* Mounted outside AppShell so ⌘K reaches it from every route. Modal keeps its children
          unmounted until opened, so `SearchBox` costs nothing (and boots no DuckDB) until used. */}
      <CommandPalette opened={palette.opened} close={palette.close} />
    </RevealProvider>
  );
}
