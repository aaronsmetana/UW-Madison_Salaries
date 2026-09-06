import { useEffect, useState } from 'react';
import { Modal, Stack, Group, Text, UnstyledButton, Divider, Button, Code } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { SearchBox } from './SearchBox';
import { NAV, ABOUT } from '../app/nav';
import { ICON } from '../lib/ui';

/**
 * ⌘K / Ctrl+K. The app is search-first — the landing page is a search box — yet there was no keyboard
 * path to it from anywhere else, so reaching search from the sixth tab of a person page meant a mouse.
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

/** "⌘K" on Apple keyboards, "Ctrl K" elsewhere — the label has to match the key that actually works. */
export function useModKey() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  }, []);
  return mac ? '⌘K' : 'Ctrl K';
}

/** The header affordance. A shortcut nobody can see is a shortcut nobody uses. */
export function PaletteTrigger({ onClick }: { onClick: () => void }) {
  const mod = useModKey();
  return (
    <Button
      variant="default"
      size="xs"
      onClick={onClick}
      leftSection={<IconSearch size={ICON.compact} />}
      aria-label={`Search — ${mod}`}
      visibleFrom="sm"
    >
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">Search</Text>
        <Code className="kbd-chip" c="dimmed">{mod}</Code>
      </Group>
    </Button>
  );
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

  return (
    <Modal
      opened={opened}
      onClose={close}
      withCloseButton={false}
      size="lg"
      radius="lg"
      yOffset="12vh"
      padding="md"
      title="Search and go"
      styles={{ title: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' } }}
      // The SCRIM, not the panel — the distinction matters, because glass on the palette panel was
      // prototyped and rejected for frosting a dense table into interference behind the menu text.
      // Blurring what is behind the dialog does the opposite: it takes the page's structure out of
      // competition with the menu, so 2px (barely anything) goes to 6.
      overlayProps={{ backgroundOpacity: 0.4, blur: 6 }}
    >
      {/* SearchBox owns its own dropdown, which portals above the modal and covers the destinations
          while results are showing — so the list below is what you see when the box is empty. */}
      <SearchBox autoFocus placeholder="Search a person…" onSelect={close} />
      <Divider my="sm" />
      <Text size="xxs" fw={700} tt="uppercase" c="dimmed" lts="0.08em" mb={6}>Go to</Text>
      <Stack gap={2}>
        {[...NAV, ABOUT].map((n) => {
          const Icon = n.icon;
          return (
            <UnstyledButton
              key={n.to}
              onClick={() => go(n.to)}
              px={10}
              py={8}
              style={{ borderRadius: 'var(--mantine-radius-sm)' }}
              className="palette-row"
            >
              <Group gap="sm" wrap="nowrap">
                <Icon size={ICON.control} stroke={1.7} />
                <Text size="sm" fw={500}>{n.label}</Text>
              </Group>
            </UnstyledButton>
          );
        })}
      </Stack>
    </Modal>
  );
}
