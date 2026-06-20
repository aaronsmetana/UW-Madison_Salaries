import type { ComboboxProps } from '@mantine/core';
import type { CSSProperties } from 'react';

/** The three matched sizes every search box / dropdown in the app must pick from. */
export type DropdownSize = 'sm' | 'md' | 'lg';

const CARD_BORDER = 'var(--mantine-color-default-border)';
const CARD_SHADOW = '0 8px 24px -4px rgba(0, 0, 0, 0.18)';

/**
 * One scale for every search box + dropdown. The menu always matches its trigger: a small trigger
 * projects a small, tight menu; a large trigger projects a large, generous one. SearchBox reads these
 * tokens too, so the custom person search and the Mantine Selects stay perfectly in step.
 *
 *  - sm: slim header/inline controls (scope, snapshot, filters).
 *  - md: standard page pickers (title/school, compare add blocks, report subject, ⌘K).
 *  - lg: the big, centered landing search box.
 */
export const DROPDOWN_TIERS = {
  sm: { mantineSize: 'xs', radius: 8,  optionFont: 13, optionPad: '5px 9px',   island: 5, maxDropdown: 300, inputFont: 13, nameFont: 15, subFont: 12, rowPad: 7,  icon: 16 },
  md: { mantineSize: 'md', radius: 10, optionFont: 15, optionPad: '8px 11px',  island: 6, maxDropdown: 360, inputFont: 15, nameFont: 17, subFont: 13, rowPad: 9,  icon: 18 },
  lg: { mantineSize: 'xl', radius: 14, optionFont: 18, optionPad: '12px 14px', island: 8, maxDropdown: 460, inputFont: 20, nameFont: 22, subFont: 14, rowPad: 13, icon: 26 },
} as const;

const comboboxProps: ComboboxProps = { width: 'target', position: 'bottom-start', offset: 0 };

/**
 * Merged-card dropdown props for a `Select`/`MultiSelect` at one of the three standard sizes. The
 * dropdown's font, density, and corner radius all scale with the trigger; the open input flattens its
 * bottom (via `merge-select-input`) to meet the flush dropdown as a single card, and options render as
 * inset rounded "island" chips (via `app-dropdown-option`).
 */
export function dropdownProps(size: DropdownSize = 'md') {
  const t = DROPDOWN_TIERS[size];
  const dropdownStyle: CSSProperties = {
    maxWidth: '92vw',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: t.radius,
    borderBottomRightRadius: t.radius,
    borderColor: CARD_BORDER,
    boxShadow: CARD_SHADOW,
  };
  return {
    size: t.mantineSize,
    radius: t.radius,
    maxDropdownHeight: t.maxDropdown,
    withCheckIcon: false,
    comboboxProps,
    classNames: { input: 'merge-select-input', option: 'app-dropdown-option' },
    styles: {
      dropdown: dropdownStyle,
      options: { padding: t.island } as CSSProperties,
      option: { fontSize: t.optionFont, lineHeight: 1.25, padding: t.optionPad } as CSSProperties,
    },
  };
}
