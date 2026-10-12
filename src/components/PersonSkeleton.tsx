import { Card, Group, Skeleton, Stack, Text } from '@mantine/core';
import { useNetwork } from '@mantine/hooks';
import { progressLine, useLoadProgress } from '../lib/loadProgress';

/**
 * A person page before its data is in: the header, the facts strip, the tabs and the headline figures at the
 * size they will be, and how far the data has got. It was "Loading person…" beside a spinner — about 2.5 s
 * with everything cached, several more on a first visit — with nothing of the page in place (G6).
 */
export function PersonSkeleton() {
  const progress = useLoadProgress();
  const { online } = useNetwork();
  // Offline before the data was ever saved on this device: it cannot arrive, and the page used to wait for it
  // under "Offline — showing cached data" for good (E18).
  const stranded = !online && progress.stage !== 'opening' && progress.stage !== 'ready';
  const line = stranded
    ? "You're offline, and the salary data isn't saved on this device yet. Connect once to load it; after that it works offline."
    : progressLine(progress);
  return (
    <Stack gap="lg" role="status" aria-label="Loading this person" aria-busy="true" className="person-skeleton">
      <Stack gap={8}>
        <Skeleton height={12} width={220} radius="sm" />
        <Skeleton height={40} width={320} radius="sm" mt={6} />
        <Skeleton height={16} width={460} maw="100%" radius="sm" />
        <Skeleton height={12} width={140} radius="sm" />
      </Stack>
      <Card withBorder padding="md">
        <Group gap="xl" wrap="wrap">
          {Array.from({ length: 7 }, (_, i) => (
            <Stack key={i} gap={6}><Skeleton height={10} width={60} radius="sm" /><Skeleton height={14} width={80} radius="sm" /></Stack>
          ))}
        </Group>
      </Card>
      <Group gap="lg"><Skeleton height={20} width={420} maw="100%" radius="sm" /></Group>
      <Card withBorder padding="lg">
        <Group gap="xl" wrap="wrap" align="flex-start">
          {[180, 160, 160, 120].map((w, i) => (
            <Stack key={i} gap={8}><Skeleton height={10} width={90} radius="sm" /><Skeleton height={i === 0 ? 40 : 26} width={w} radius="sm" /></Stack>
          ))}
        </Group>
      </Card>
      <Text size="sm" c="dimmed" className="load-progress" aria-live="polite">{line ?? 'Loading this person…'}</Text>
    </Stack>
  );
}
