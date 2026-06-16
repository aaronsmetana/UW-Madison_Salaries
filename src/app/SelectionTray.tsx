import { Group, Pill, Button, Text, Paper, ThemeIcon } from '@mantine/core';
import { IconShoppingCart, IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTray } from '../state/tray';

/**
 * Floating selection tray = your comparison cart. Sits just above the bottom edge,
 * appears only when you've added something, and jumps straight to Compare.
 */
export function SelectionTray() {
  const { items, remove, clear } = useTray();
  if (items.length === 0) return null;

  return (
    <Paper
      className="no-print"
      shadow="lg"
      withBorder
      radius="xl"
      px="md"
      py={8}
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        maxWidth: 'min(900px, calc(100vw - 32px))',
      }}
    >
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" radius="xl" size="md">
          <IconShoppingCart size={16} />
        </ThemeIcon>
        <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
          Tray · {items.length}
        </Text>
        <Group gap={6} wrap="nowrap" style={{ overflowX: 'auto', maxWidth: 460 }}>
          {items.map((i) => (
            <Pill key={`${i.type}:${i.id}`} withRemoveButton onRemove={() => remove(i.id)} style={{ flexShrink: 0 }}>
              {i.label}
            </Pill>
          ))}
        </Group>
        <Button size="xs" variant="subtle" color="gray" onClick={clear} style={{ flexShrink: 0 }}>
          Clear
        </Button>
        <Button size="xs" component={Link} to="/compare" rightSection={<IconArrowRight size={14} />} style={{ flexShrink: 0 }}>
          Compare
        </Button>
      </Group>
    </Paper>
  );
}
