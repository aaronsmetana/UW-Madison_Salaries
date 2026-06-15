import { createTheme } from '@mantine/core';

// Neutral-modern: indigo primary on slate-gray surfaces.
export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: { fontWeight: '600' },
});

// Semantic, colorblind-safe accents for raises/cuts (used by charts/badges).
export const SEMANTIC = {
  up: 'teal',
  down: 'red',
  neutral: 'gray',
} as const;
