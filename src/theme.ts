import { createTheme, type MantineColorsTuple } from '@mantine/core';

// ── Marine-teal accent (the single app accent; anchored so shade 7 ≈ #0E6E83, shade 1 ≈ #E5EFF2) ──
const accent: MantineColorsTuple = [
  '#eef6f8', '#e5eff2', '#cfe0e5', '#a9c9d2', '#7eafbc',
  '#4f93a4', '#2b7e92', '#0e6e83', '#0a5567', '#073f4d',
];

// ── Positive / "in tray" green (used sparingly; shade 6 ≈ #15A36B, shade 0 ≈ #E7F6EE) ──
const pos: MantineColorsTuple = [
  '#e7f6ee', '#d3efe0', '#a8dec3', '#79cda4', '#52bf8a',
  '#38b27d', '#15a36b', '#0c8a59', '#057247', '#005a37',
];

// Refined marine-teal accent (deliberately NOT UW Badger red — this is a personal tool), green positives,
// cool-grey neutrals, rounded cards, soft shadows, Hanken Grotesk type.
export const theme = createTheme({
  colors: { accent, pos },
  primaryColor: 'accent',
  primaryShade: { light: 7, dark: 6 },
  defaultRadius: 'lg',
  // Pick readable (dark) text automatically on light-luminance filled badges (e.g. yellow "WARNING").
  autoContrast: true,
  luminanceThreshold: 0.45,
  fontFamily: "'Hanken Grotesk', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  headings: { fontFamily: "'Hanken Grotesk', system-ui, sans-serif", fontWeight: '700' },
  // sm = the spec's shadow-card; md = mid; lg = shadow-frame (deep, for floating elements).
  shadows: {
    sm: '0 1px 2px rgba(20,40,50,.04), 0 12px 30px rgba(20,40,50,.05)',
    md: '0 4px 14px rgba(20,40,50,.08)',
    lg: '0 2px 4px rgba(20,40,50,.04), 0 22px 60px rgba(20,40,50,.10)',
  },
  // Card / stat radii from the spec (sm 11 · md 16 · lg 18).
  radius: { sm: '11px', md: '16px', lg: '18px' },
  components: {
    Card: { defaultProps: { radius: 'lg', withBorder: true } },
  },
});

// Semantic, colorblind-safe accents (raises/cuts) used by charts/badges.
export const SEMANTIC = { up: 'pos', down: 'red', neutral: 'gray' } as const;
