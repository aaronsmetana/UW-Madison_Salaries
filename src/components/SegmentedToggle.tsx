import { SegmentedControl, Stack, Text } from '@mantine/core';

export interface ToggleOption {
  id: string;
  label: string;
}

/**
 * Small pill segmented control matching the mock's "Compare against" control, mapped onto the app's
 * theme (active label in accent teal — see the `.seg-toggle` rule in app.css). An optional small-caps
 * eyebrow sits above it. Reused by the overview cohort toggle, the tenure scatter, and the trend toggle.
 */
export function SegmentedToggle({
  options,
  value,
  onChange,
  label,
  size = 'xs',
  fullWidth = false,
}: {
  options: ToggleOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  size?: 'xs' | 'sm';
  fullWidth?: boolean;
}) {
  const control = (
    <SegmentedControl
      className="seg-toggle"
      size={size}
      radius="md"
      value={value}
      onChange={onChange}
      fullWidth={fullWidth}
      data={options.map((o) => ({ value: o.id, label: o.label }))}
      styles={{ label: { fontWeight: 600 } }}
    />
  );
  if (!label) return control;
  return (
    <Stack gap={4} align="flex-start">
      <Text tt="uppercase" c="dimmed" style={{ fontSize: 11, letterSpacing: '0.03em' }}>
        {label}
      </Text>
      {control}
    </Stack>
  );
}
