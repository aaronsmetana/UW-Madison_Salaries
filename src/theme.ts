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
  // Pick readable (dark) text automatically on light-luminance filled badges (e.g. an orange "CAUTION").
  autoContrast: true,
  luminanceThreshold: 0.45,
  // 'Hanken Fallback' is a metric-overridden alias for the local system face (see the @font-face
  // block in styles/app.css). It sits between the webfont and the raw system stack so the pre-swap
  // paint already has Hanken's advance widths — without it, `font-display: swap` re-lays-out every
  // label the moment the font arrives, which is exactly what broke PeerRangeBar's measured label
  // stagger once before.
  fontFamily: "'Hanken Grotesk', 'Hanken Fallback', 'Hanken Fallback Alt', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  headings: {
    fontFamily: "'Hanken Grotesk', 'Hanken Fallback', 'Hanken Fallback Alt', system-ui, sans-serif",
    fontWeight: '700',
    // One heading ramp for the whole app. PageHeader, Person, and School each used to carry their own
    // inline `clamp()` on their h1 — three copies of the same intent that could drift apart. h1/h2 stay
    // fluid (they set the page's tone and need to ease down on a phone); h3/h4 are fixed, because they
    // label cards and sections whose own widths are already responsive. Letter-spacing rides along in
    // app.css, keyed off Title's data-order, since Mantine's `sizes` has no slot for it.
    sizes: {
      h1: { fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', lineHeight: '1.15' },
      h2: { fontSize: 'clamp(1.375rem, 2.2vw, 1.75rem)', lineHeight: '1.2' },
      h3: { fontSize: '1.25rem', lineHeight: '1.3' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.4' },
    },
  },
  // `xxs` (11px) is the app's smallest legible label size — footnotes, eyebrows, dense captions —
  // replacing the scattered hardcoded fontSize:9/10/11. Mantine merges these onto its defaults.
  fontSizes: { xxs: '0.6875rem' },
  // sm = the spec's shadow-card; md = mid; lg = shadow-frame (deep, for floating elements).
  shadows: {
    sm: '0 1px 2px rgba(20,40,50,.04), 0 12px 30px rgba(20,40,50,.05)',
    md: '0 4px 14px rgba(20,40,50,.08)',
    lg: '0 2px 4px rgba(20,40,50,.04), 0 22px 60px rgba(20,40,50,.10)',
  },
  // Card / stat radii from the spec (sm 11 · md 16 · lg 18).
  radius: { sm: '11px', md: '16px', lg: '18px' },
  components: {
    Card: { defaultProps: { radius: 'lg', withBorder: true, padding: 'lg' } },
    // One table look everywhere: zebra rows, hover highlight, comfortable row spacing.
    Table: { defaultProps: { striped: true, highlightOnHover: true, verticalSpacing: 'sm' } },
    // Badges read as sentence case by default (the app's convention); a true status label that should
    // shout re-adds tt="uppercase" explicitly at the call site.
    Badge: { defaultProps: { tt: 'none' } },
    // Inline text links must be visually distinguishable without relying on color alone (WCAG
    // 1.4.1) — hover-only underlining fails that for any link sitting in a sentence. Card-wrapper
    // anchors (the whole card is the link) opt out explicitly with underline="never" at the call site.
    Anchor: { defaultProps: { underline: 'always' } },
  },
});

// Semantic, colorblind-safe accents used by charts/badges. Severity ramp: neutral (gray) →
// warn/caution (orange, e.g. approaching a threshold) → down/violated/negative (red). `up` = positive.
export const SEMANTIC = { up: 'pos', warn: 'orange', down: 'red', neutral: 'gray' } as const;
