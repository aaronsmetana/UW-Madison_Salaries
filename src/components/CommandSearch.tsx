import { ActionIcon, Modal, Tooltip } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { SearchBox } from './SearchBox';

/**
 * Global person search: a small header icon (so the shortcut is actually discoverable) plus ⌘K/Ctrl+K
 * and `/` keyboard shortcuts, all opening the same overlay. `useHotkeys`' default ignore-list already
 * skips `/` while typing in an input/textarea, so it never hijacks normal typing.
 */
export function CommandSearch() {
  const [opened, { open, close }] = useDisclosure(false);
  useHotkeys([
    ['mod+K', open],
    ['/', open],
  ]);

  return (
    <>
      <Tooltip label="Search a person (⌘K or /)" withArrow>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label="Search a person" onClick={open}>
          <IconSearch size={18} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={opened} onClose={close} title="Search a person" size="lg" yOffset="12vh">
        <SearchBox autoFocus onSelect={close} />
      </Modal>
    </>
  );
}
