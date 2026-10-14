import { Button, Group } from '@mantine/core';
import { Eyebrow } from './Eyebrow';

const THRESHOLDS = [{ n: 0, label: 'All' }, { n: 5, label: '≥5' }, { n: 25, label: '≥25' }, { n: 100, label: '≥100' }];

/**
 * How few people a row may stand for and still be listed: Divisions' Titles, and its Schools (I5), where a median
 * sorted to the top was a division of 17. A row this small is still a row in its own page.
 */
export function MinPeople({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Group gap={6} wrap="nowrap" className="min-people">
      <Eyebrow>Min people</Eyebrow>
      <Button.Group>
        {THRESHOLDS.map((th) => (
          <Button key={th.n} size="compact-xs" variant={value === th.n ? 'filled' : 'default'} color="accent"
            aria-pressed={value === th.n} onClick={() => onChange(th.n)}>{th.label}</Button>
        ))}
      </Button.Group>
    </Group>
  );
}
