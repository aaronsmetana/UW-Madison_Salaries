import { createTheme } from '@mantine/core';

// Polished, collegiate-but-not-official feel: refined indigo accent (deliberately NOT UW
// Badger red, since this is a personal tool), soft shadows, rounded cards, airy spacing.
export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'lg',
  // Pick readable (dark) text automatically on light-luminance filled badges (e.g. yellow "WARNING").
  autoContrast: true,
  luminanceThreshold: 0.45,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: { fontWeight: '700' },
  shadows: {
    sm: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
    md: '0 4px 14px rgba(15, 23, 42, 0.08)',
    lg: '0 10px 30px rgba(15, 23, 42, 0.18)',
  },
  components: {
    Card: { defaultProps: { radius: 'lg', withBorder: true } },
  },
});

// Semantic, colorblind-safe accents (raises/cuts) used by charts/badges.
export const SEMANTIC = { up: 'teal', down: 'red', neutral: 'gray' } as const;

// Hero band gradient (indigo → cyan): pretty, distinct from official UW red.
export const HERO_GRADIENT =
  'linear-gradient(135deg, var(--mantine-color-indigo-7) 0%, var(--mantine-color-cyan-6) 100%)';
