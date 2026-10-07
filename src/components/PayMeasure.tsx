import { ActionIcon, Group, HoverCard, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useControls, METRIC_LABEL, type Metric } from '../state/controls';
import { SegmentedToggle } from './SegmentedToggle';
import { Eyebrow } from './Eyebrow';
import { ICON } from '../lib/ui';

/** Plain-language explanation of each pay measure, shown in the (i) hover card. */
const METRIC_HELP: Record<Metric, string> = {
  full: 'The listed annual salary (full-time-equivalent rate). For part-time staff this is more than they actually earned.',
  fte: "Annual salary scaled to the person's FTE — closest to what they were actually paid.",
  base: 'Base salary as reported (may exclude supplemental or overload pay).',
};

/**
 * The pay measure every figure on the page uses, shown where the page's other settings are and changeable
 * there — the control bar's, and the same control on each page whose numbers read it (Titles, Raises,
 * Reports) rather than a setting they used without saying which. Like the view's other settings it lives in
 * the page's address, so a copied link keeps it.
 */
export function PayMeasure() {
  const { metric, setMetric } = useControls();
  return (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }} className="pay-measure">
      <Eyebrow>Pay</Eyebrow>
      <SegmentedToggle
        size="xs"
        value={metric}
        onChange={(v) => setMetric(v as Metric)}
        options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ id: m, label: METRIC_LABEL[m] }))}
      />
      <HoverCard width={300} shadow="md" position="bottom" withArrow>
        <HoverCard.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="What do these pay options mean?">
            <IconInfoCircle size={ICON.control} />
          </ActionIcon>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <Stack gap={6}>
            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
              <Text size="xs" key={m}><b>{METRIC_LABEL[m]}</b> — {METRIC_HELP[m]}</Text>
            ))}
          </Stack>
        </HoverCard.Dropdown>
      </HoverCard>
    </Group>
  );
}
