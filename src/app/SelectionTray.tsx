import { Group, Pill, Button, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTray } from '../state/tray';

/** Persistent selection tray = your comparison cart + watchlist. */
export function SelectionTray() {
  const { items, remove, clear } = useTray();

  return (
    <Group h={56} px="md" gap="xs" wrap="nowrap" style={{ overflowX: 'auto' }}>
      <Text size="sm" fw={600} c="dimmed">
        Tray
      </Text>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Add people or schools (＋) to compare or track them.
        </Text>
      ) : (
        <>
          {items.map((i) => (
            <Pill key={`${i.type}:${i.id}`} withRemoveButton onRemove={() => remove(i.id)}>
              {i.label}
            </Pill>
          ))}
          <Button size="xs" variant="subtle" color="gray" onClick={clear}>
            Clear
          </Button>
          <Button size="xs" component={Link} to="/compare" ml="auto">
            Compare →
          </Button>
        </>
      )}
    </Group>
  );
}
