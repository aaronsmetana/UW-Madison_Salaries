import { SegmentedControl, Stack } from '@mantine/core';
import { Eyebrow } from './Eyebrow';

export interface ToggleOption {
  id: string;
  label: string;
}

/**
 * The app's small segmented control: options on a grey track, the chosen one a raised white segment in the
 * ink (app.css), as every segmented control in the app is. It was a teal-filled option, which made a setting
 * the loudest thing on a chart whose teal is the person it is about. An optional small-caps eyebrow sits
 * above it. Reused by the overview cohort toggle, the tenure scatter, and the trend toggle.
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
      value={value}
      onChange={onChange}
      fullWidth={fullWidth}
      data={options.map((o) => ({ value: o.id, label: o.label }))}
    />
  );
  if (!label) return control;
  return (
    <Stack gap={4} align="flex-start">
      <Eyebrow>{label}</Eyebrow>
      {control}
    </Stack>
  );
}
