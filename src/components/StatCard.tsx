import { Card, Group, Text, ThemeIcon, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** Polished KPI card: icon + label + big value + optional sub-text. */
export function StatCard({
  label,
  value,
  icon,
  sub,
  color = 'indigo',
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Title order={3} mt={2}>
            {value}
          </Title>
          {sub && (
            <Text size="xs" c="dimmed" mt={4}>
              {sub}
            </Text>
          )}
        </div>
        {icon && (
          <ThemeIcon variant="light" color={color} size={40} radius="md">
            {icon}
          </ThemeIcon>
        )}
      </Group>
    </Card>
  );
}
