import { Suspense, useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { AppShell, Group, NavLink, Box, Anchor, Burger, Divider, Text, Drawer } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ControlBar } from './ControlBar';
import { SelectionTray } from './SelectionTray';
import { Footer } from './Footer';
import { ColorSchemeToggle } from '../components/ColorSchemeToggle';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalLoadingBar, LoadingState, DataErrorBanner, OfflineBanner } from '../components/Loading';
import { CommandPalette, usePalette } from '../components/CommandPalette';
import { CrumbsProvider, PageTop } from './PageTop';
import { BrandMark } from '../components/BrandMark';
import { NAV, ABOUT, type NavItem } from './nav';
import { consumeUpdate } from '../lib/appUpdate';
import { RevealProvider } from '../components/PersonReveal';
import { prefersReducedMotion } from '../lib/motion';
import { ICON } from '../lib/ui';

// the control bar (scope/snapshot/metric/filters) only matters on these data views
// Explore + Compare render their own controls inline in the page content, so they're excluded here.
// (Titles render via /paycheck, which has its own inline pickers — no global control bar.)
const CONTROL_PATHS = ['/school'];

/** The site's mark in the header and the phone menu, in the accent the name's "Salaries" wears. */
function LogoMark() {
  return (
    <Text span c="accent.7" className="accent7-text" style={{ display: 'flex' }}>
      <BrandMark size={28} />
    </Text>
  );
}

/**
 * Whether the page at `path` has finished its first loads: no query in flight for 300ms since it opened. Until
 * then the footer is laid out but not drawn. While a page is still short, the footer would stand at the bottom
 * of the window and then be pushed down by every figure and chart arriving above it, a jump the reader sees
 * (and the layout-shift guard counts: it took the landing page over 0.1). Once shown for a page it stays,
 * whatever loads later.
 */
function useSettled(path: string) {
  const fetching = useIsFetching();
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (settled === path || fetching > 0) return;
    const t = window.setTimeout(() => setSettled(path), 300);
    return () => window.clearTimeout(t);
  }, [fetching, path, settled]);
  return settled === path;
}

/** Below `md`, the destinations are a sheet over the page, opened from the bar's burger. */
const SHEET_ID = 'app-nav-sheet';
const SHEET_W = 280;

export function AppShellLayout() {
  const loc = useLocation();
  const [sheetOpened, { toggle: toggleSheet, close: closeSheet }] = useDisclosure(false);
  // From `md` (992px) the seven destinations fit in the bar beside the name; below it they are a sheet. Read
  // at once rather than in an effect, so a phone never paints a bar of links first.
  const wide = useMediaQuery('(min-width: 62em)', true, { getInitialValueInEffect: false }) ?? true;
  // A sheet left open as the window widens would sit over a page whose bar has its links back.
  useEffect(() => { if (wide) closeSheet(); }, [wide, closeSheet]);
  const palette = usePalette();
  const settled = useSettled(loc.pathname);

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
  // The place a page belongs to: its own destination, or the one it sits under (a person under People, as
  // the page's trail says).
  const isActive = (n: NavItem) =>
    (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)) || !!n.also?.some((p) => loc.pathname.startsWith(p));
  const showControl = CONTROL_PATHS.some((p) => loc.pathname.startsWith(p));

  /** A destination in the bar: its icon and its name, the page you are on marked as current. */
  const barLink = (n: NavItem) => {
    const Icon = n.icon;
    const active = isActive(n);
    return (
      <Anchor
        key={n.to}
        component={Link}
        to={n.to}
        underline="never"
        className="app-nav-link"
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={ICON.nav} stroke={1.7} className="app-nav-icon" aria-hidden />
        <span>{n.label}</span>
      </Anchor>
    );
  };

  /** A destination in the sheet: one tap goes there and closes the sheet, the page it names included. */
  const sheetLink = (n: NavItem, dimmed = false) => {
    const Icon = n.icon;
    const active = isActive(n);
    return (
      <NavLink
        key={n.to}
        component={Link}
        to={n.to}
        onClick={closeSheet}
        label={n.label}
        leftSection={<Icon size={ICON.nav} stroke={1.7} />}
        active={active}
        variant="light"
        color={active ? 'accent' : undefined}
        c={dimmed && !active ? 'dimmed' : undefined}
        className="app-sheet-link"
      />
    );
  };

  return (
    <RevealProvider>
      <CrumbsProvider>
        {/* First tab stop on every route. Without it a keyboard or screen-reader user crossed the bar's
            eight stops before reaching the page they navigated to — on every navigation, since the shell
            does not remount. Visually hidden until focused (see `.skip-link` in app.css). */}
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <GlobalLoadingBar />
        <AppShell
          // The control bar's height is not fixed: its scope/snapshot/metric groups wrap as the viewport
          // narrows. Measured values plus a little slack, per breakpoint, over the 60px bar.
          header={{ height: showControl ? { base: 132, sm: 112 } : 60 }}
          padding={0}
        >
          <AppShell.Header>
            <Group h={60} className="app-bar" gap="lg" wrap="nowrap">
              <Burger
                opened={sheetOpened}
                onClick={toggleSheet}
                hiddenFrom="md"
                size="sm"
                aria-label="Toggle navigation"
                aria-expanded={sheetOpened}
                aria-controls={sheetOpened ? SHEET_ID : undefined}
              />
              <Anchor component={Link} to="/" underline="never" c="inherit" className="app-wordmark">
                <Group gap={8} wrap="nowrap" align="center">
                  <LogoMark />
                  {/* One line: the name, two-tone. Where the records come from is the footer's first words. */}
                  <Text component="span" fz="lg" fw={700} lts="-0.02em" className="app-name" style={{ lineHeight: 1.1 }}>
                    <Text span inherit c="bright">UW–Madison </Text>
                    <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
                  </Text>
                </Group>
              </Anchor>
              {/* The destinations, named. They were a rail of bare icons down the left of every page, with
                  their names one hover or one "Expand" away; here each says where it goes. About the data
                  is in the footer, and ⌘K reaches every one of them from anywhere (CommandPalette). */}
              {wide && <nav aria-label="Main" className="app-nav">{NAV.map(barLink)}</nav>}
              <Box ml="auto"><ColorSchemeToggle /></Box>
            </Group>
            {showControl && <ControlBar />}
          </AppShell.Header>

          {/* The menu below `md`: a sheet over a dimmed page. A tap outside it or Escape closes it, the
              keyboard stays inside it while it is open and goes back to the burger after. Named by
              `aria-label`: the wordmark at its top is not its title. */}
          <Drawer.Root
            opened={sheetOpened && !wide}
            onClose={closeSheet}
            position="left"
            size={SHEET_W}
            transitionProps={{ duration: prefersReducedMotion() ? 0 : 200 }}
          >
            <Drawer.Overlay />
            <Drawer.Content id={SHEET_ID} aria-label="Menu" className="app-nav-sheet">
              <Drawer.Header>
                <Group gap={8} wrap="nowrap" align="center">
                  <LogoMark />
                  <Text component="span" fz="lg" fw={700} lts="-0.02em" style={{ lineHeight: 1.1 }}>
                    <Text span inherit c="bright">UW–Madison </Text>
                    <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
                  </Text>
                </Group>
                <Drawer.CloseButton aria-label="Close menu" />
              </Drawer.Header>
              {/* Not `Drawer.Body`: Mantine points the dialog's `aria-describedby` at it, and a screen reader
                  would read every link out as the menu's description before reaching any of them. */}
              <Box px="sm" pb="md">
                {NAV.map((n) => sheetLink(n))}
                <Divider my="xs" />
                {sheetLink(ABOUT, true)}
              </Box>
            </Drawer.Content>
          </Drawer.Root>

          <AppShell.Main
            id="main-content"
            // `<main>` is not focusable on its own, so following the skip link would scroll the page
            // but leave focus stranded back on the link. -1 makes it a valid focus target without
            // adding a tab stop of its own.
            tabIndex={-1}
            className="app-main"
          >
            <div className="app-page">
              <OfflineBanner />
              <DataErrorBanner />
              <PageTop />
              <div key={loc.pathname} className="route-rise">
                <ErrorBoundary key={loc.pathname}>
                  <Suspense fallback={<LoadingState label="Loading…" />}>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
            {/* The page's last thing, on every page and at every width. It was a fixed 40px band over the
                bottom of every desktop window, which covered whatever scrolled under it and had to drop
                words to stay one line; at the end of the page it has two lines and covers nothing. */}
            <footer className="app-footer" data-waiting={!settled || undefined}><Footer /></footer>
          </AppShell.Main>
        </AppShell>

        {/* Floating "cart"-style selection tray — hidden on /compare (selections shown in-page) and on
            /reports (it's a tool, not part of the formal negotiation document). */}
        {!loc.pathname.startsWith('/compare') && !loc.pathname.startsWith('/reports') && <SelectionTray />}

        {/* Mounted outside AppShell so ⌘K reaches it from every route. Modal keeps its children
            unmounted until opened, so `SearchBox` costs nothing (and boots no DuckDB) until used. */}
        <CommandPalette opened={palette.opened} close={palette.close} />
      </CrumbsProvider>
    </RevealProvider>
  );
}
