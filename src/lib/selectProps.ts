import type { ComboboxProps } from '@mantine/core';
import type { CSSProperties } from 'react';

// Shared look for option dropdowns app-wide. The menu grows to fit the longest
// entry (capped to the viewport) and option text never wraps, so long titles,
// schools, and names stay on a single line instead of wrapping.
const comboboxProps: ComboboxProps = { width: 'max-content', position: 'bottom-start' };
const dropdownStyle: CSSProperties = { maxWidth: '92vw' };
const optionStyle: CSSProperties = { whiteSpace: 'nowrap', paddingTop: 9, paddingBottom: 9 };

/** Drop in to any `Select`/`MultiSelect` so its options fit on one line. Leaves
 *  the closed control height untouched — safe on compact (xs/sm) controls. */
export const optionDropdownProps = {
  comboboxProps,
  maxDropdownHeight: 360,
  styles: { dropdown: dropdownStyle, option: optionStyle },
};

/** Height of the prominent list pickers (Search Title Salaries, Compare add
 *  blocks) — ~50% taller than the default `md` control. */
export const PICKER_HEIGHT = 60;
const inputStyle: CSSProperties = { minHeight: PICKER_HEIGHT, height: PICKER_HEIGHT };

/** `optionDropdownProps` plus a taller closed control, for the prominent pickers. */
export const bigPickerProps = {
  comboboxProps,
  maxDropdownHeight: 360,
  styles: { dropdown: dropdownStyle, option: optionStyle, input: inputStyle },
};
