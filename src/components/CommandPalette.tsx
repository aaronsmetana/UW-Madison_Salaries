import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Stack, Group, Text, UnstyledButton, Divider } from '@mantine/core';
import { IconUser } from '@tabler/icons-react';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { SearchBox } from './SearchBox';
import { Eyebrow } from './Eyebrow';
import { NAV, ABOUT } from '../app/nav';
import { ICON } from '../lib/ui';
import { readRecent } from '../lib/recent';

/**
 * ⌘K / Ctrl+K. The app is search-first — the landing page is a search box — yet there was no keyboard
 * path to it from anywhere else, so reaching search from the sixth tab of a person page meant a mouse.
 * The header's "Search ⌘K" button that opened it is gone (the landing page's box and People in the
 * sidebar are the way to search by pointer); the shortcut works on every page.
 *
 * Deliberately not `@mantine/spotlight`: it isn't installed, and adopting it would mean rebuilding
 * `SearchBox`'s combobox — the debounce, the Jaro-Winkler typo fallback, the homonym and departed-staff
 * badges. The palette hosts that component as-is and adds the destinations under it.
 */
export function usePalette() {
  const [opened, { open, close }] = useDisclosure(false);
  // `[]` overrides Mantine's default tag ignore-list (INPUT/TEXTAREA/SELECT). A palette that stops
  // working the moment focus is in a text field is a palette that fails exactly when someone is
  // mid-thought in the wrong search box, which is the case it exists for.
  useHotkeys([['mod+K', open]], []);
  return { opened, open, close };
}

export function CommandPalette({ opened, close }: { opened: boolean; close: () => void }) {
  const nav = useNavigate();

  // Escape is handled here rather than left to the Modal, and on `document` in the capture phase
  // rather than on the content subtree. Mantine skips its own window-level Escape handler whenever
  // focus is trapped, delegating to the content's `onKeyDown` — which never fires for a
  // `Popover.Target`, and `SearchBox` is one. The result was a dialog you could open by keyboard and
  // only close with the mouse. Capture-phase on `document` means it works wherever focus happens to
  // be, including on a destination row or back on the input. `e2e/palette.spec.ts` is the guard.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [opened, close]);

  const go = (to: string) => {
    nav(to);
    close();
  };

  // What is typed (I8): with something in the box its results take the page list's place, stopping short of the
  // keys' line at the foot; empty, the people looked at last, then the pages. The results used to drop over the
  // page list, and the box sat under an empty band where the dialog's hidden title was.
  const [q, setQ] = useState('');
  useEffect(() => { if (!opened) setQ(''); }, [opened]);
  const typing = q.trim().length > 0;
  const recent = useMemo(() => (opened ? readRecent() : []), [opened]);
  const footRef = useRef<HTMLDivElement>(null);
  const row = (key: string, icon: ReactNode, label: string, sub: string | null, to: string) => (
    <UnstyledButton key={key} onClick={() => go(to)} px={10} py={8} style={{ borderRadius: 'var(--mantine-radius-sm)' }} className="palette-row">
      <Group gap="sm" wrap="nowrap">
        {icon}
        <Text size="sm" fw={500} truncate>{label}</Text>
        {sub && <Text size="xs" c="dimmed" truncate>{sub}</Text>}
      </Group>
    </UnstyledButton>
  );

  return (
    <Modal
      opened={opened}
      onClose={close}
      withCloseButton={false}
      // Wide enough for the results' two columns (people beside titles and divisions), as the landing's list has: in
      // one, four people filled the room and the titles were below it on a 720px screen.
      size={820}
      radius="lg"
      yOffset="12vh"
      padding="md"
      // Named for a screen reader by its title; the header that held it drawn as nothing, not an empty band.
      title="Search and go"
      styles={{ header: { display: 'none' }, body: { paddingTop: 'var(--mantine-spacing-md)' } }}
      // The SCRIM, not the panel — the distinction matters, because glass on the palette panel was
      // prototyped and rejected for frosting a dense table into interference behind the menu text.
      // Blurring what is behind the dialog does the opposite: it takes the page's structure out of
      // competition with the menu, so 2px (barely anything) goes to 6.
      overlayProps={{ backgroundOpacity: 0.4, blur: 6 }}
    >
      <SearchBox autoFocus fill onSelect={close} peopleInGroup={4} query={q} onQueryChange={setQ}
        listLimit={() => footRef.current?.getBoundingClientRect().top ?? null} />
      {typing ? (
        // Room for the results, which SearchBox draws in its own list over this space.
        <div className="palette-results-room" aria-hidden />
      ) : (
        <>
          <Divider my="sm" />
          {recent.length > 0 && (
            <>
              <Eyebrow mb={6}>Recently viewed</Eyebrow>
              <Stack gap={2} mb="sm" className="palette-recent">
                {recent.map((r) => row(r.key, <IconUser size={ICON.control} stroke={1.7} />, r.name, r.title, `/person/${encodeURIComponent(r.key)}`))}
              </Stack>
            </>
          )}
          <Eyebrow mb={6}>Go to</Eyebrow>
          <Stack gap={2}>
            {[...NAV, ABOUT].map((n) => {
              const Icon = n.icon;
              return row(n.to, <Icon size={ICON.control} stroke={1.7} />, n.label, null, n.to);
            })}
          </Stack>
        </>
      )}
      {/* The keys, in words. */}
      <div ref={footRef} className="palette-keys">
        <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
        <span><kbd>Enter</kbd> to open</span>
        <span><kbd>Esc</kbd> to close</span>
      </div>
    </Modal>
  );
}
