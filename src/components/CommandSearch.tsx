import { Modal } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { SearchBox } from './SearchBox';

/** Global ⌘K / Ctrl+K person search overlay (no visible button; keyboard shortcut only). */
export function CommandSearch() {
  const [opened, { open, close }] = useDisclosure(false);
  useHotkeys([['mod+K', open]]);

  return (
    <Modal opened={opened} onClose={close} title="Search a person" size="lg" yOffset="12vh">
      <SearchBox autoFocus onSelect={close} />
    </Modal>
  );
}
