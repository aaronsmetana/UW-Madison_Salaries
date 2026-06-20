import type { ComboboxProps } from '@mantine/core';
import type { CSSProperties } from 'react';

// Shared look for option dropdowns app-wide. The dropdown matches the input width and attaches flush to
// its bottom so the two read as a single "merged card" (matching the person search bar): the open input
// gets a flat, borderless bottom (via the `merge-select-input` class in app.css, keyed off `data-expanded`)
// and the dropdown has a flat top + continuous border/shadow. Long option text wraps inside the card.
const CARD_BORDER = 'var(--mantine-color-default-border)';
const CARD_SHADOW = '0 8px 24px -4px rgba(0, 0, 0, 0.18)';

const comboboxProps: ComboboxProps = { width: 'target', position: 'bottom-start', offset: 0 };
const dropdownStyle: CSSProperties = {
  maxWidth: '92vw',
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderTopWidth: 0,
  borderColor: CARD_BORDER,
  boxShadow: CARD_SHADOW,
};
// Shared list-item tokens (identical to the Scope/Division picker): 14px text, tight line-height, 6px/8px
// padding, and a 6px "island" buffer so the rounded soft-gray highlight (.app-dropdown-option) floats
// inside the menu. `withCheckIcon: false` drops the checkmark — selection is shown by the chip instead.
const optionsStyle: CSSProperties = { padding: 6 };
const optionStyle: CSSProperties = { fontSize: 14, lineHeight: 1.25, padding: '6px 8px' };
const dropdownClassNames = { input: 'merge-select-input', option: 'app-dropdown-option' };

/** Drop in to any `Select`/`MultiSelect` for the merged-card dropdown look. Leaves the closed control
 *  height untouched — safe on compact (xs/sm) controls. */
export const optionDropdownProps = {
  comboboxProps,
  maxDropdownHeight: 360,
  withCheckIcon: false,
  classNames: dropdownClassNames,
  styles: { dropdown: dropdownStyle, options: optionsStyle, option: optionStyle },
};

/** Height of the prominent list pickers (Search Title Salaries, Compare add
 *  blocks) — ~50% taller than the default `md` control. */
export const PICKER_HEIGHT = 60;
const inputStyle: CSSProperties = { minHeight: PICKER_HEIGHT, height: PICKER_HEIGHT };

/** `optionDropdownProps` plus a taller closed control, for the prominent pickers. */
export const bigPickerProps = {
  comboboxProps,
  maxDropdownHeight: 360,
  withCheckIcon: false,
  classNames: dropdownClassNames,
  styles: { dropdown: dropdownStyle, options: optionsStyle, option: optionStyle, input: inputStyle },
};
