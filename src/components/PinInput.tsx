import { useEffect, useState } from 'react';
import { CloseButton, Group, Text, TextInput } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/** "$75,000" from whatever digits were typed; '' for none. */
const asCurrency = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);
  return digits ? `$${Number(digits).toLocaleString('en-US')}` : '';
};
const asNumber = (shown: string) => {
  const n = Number(shown.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A salary to place among the people on the page (T5): typed as currency, "$75,000", and applied on Enter or on
 * leaving the field, with a ✕ that clears it. It was a bare number input, spinner arrows and "e.g. 120000", that
 * moved the page under each keystroke. Under it, one line on where the figure goes (T4): nowhere. It said so in
 * forty words, twice.
 */
export function PinInput({ value, onApply, label = 'Salary to pin (optional)' }: {
  value: number | null;
  onApply: (v: number | null) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value != null ? asCurrency(String(value)) : '');
  // A pin cleared or set from outside the field shows here too.
  useEffect(() => { setDraft(value != null ? asCurrency(String(value)) : ''); }, [value]);
  const apply = () => onApply(asNumber(draft));
  return (
    <TextInput
      size="xs"
      label={label}
      description={(
        <Group gap={4} wrap="nowrap" component="span" className="pin-privacy">
          <IconLock size={ICON.compact} aria-hidden />
          <Text span inherit>Private: never sent, saved or put in a link</Text>
        </Group>
      )}
      placeholder="$120,000"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      onChange={(e) => setDraft(asCurrency(e.currentTarget.value))}
      onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
      onBlur={apply}
      rightSection={draft ? (
        <CloseButton size="sm" aria-label="Clear the pinned salary" onClick={() => { setDraft(''); onApply(null); }} />
      ) : null}
      w={220}
      className="pin-input"
    />
  );
}
