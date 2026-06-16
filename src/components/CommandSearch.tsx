import { Modal, Button } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { SearchBox } from './SearchBox';

/** Global ⌘K / Ctrl+K person search overlay. */
export function CommandSearch() {
  const [opened, { open, close }] = useDisclosure(false);
  useHotkeys([['mod+K', open]]);

  return (
    <>
      <Button variant="default" size="xs" onClick={open}>
        Search&nbsp;<kbd style={{ fontSize: 11 }}>⌘K</kbd>
      </Button>
      <Modal opened={opened} onClose={close} title="Search a person" size="lg" yOffset="12vh">
        <SearchBox autoFocus onSelect={close} />
      </Modal>
    </>
  );
}
