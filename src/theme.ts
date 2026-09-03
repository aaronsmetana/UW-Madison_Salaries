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
  defaultRadius: 'sm', // controls (buttons, inputs, chips) — cards opt up to `lg` below
  // Pick readable (dark) text automatically on light-luminance filled badges (e.g. an orange "CAUTION").
  autoContrast: true,
  luminanceThreshold: 0.45,
  // 'Hanken Fallback' is a metric-overridden alias for the local system face (see the @font-face
  // block in styles/app.css). It sits between the webfont and the raw system stack so the pre-swap
  // paint already has Hanken's advance widths — without it, `font-display: swap` re-lays-out every
  // label the moment the font arrives, which is exactly what broke PeerRangeBar's measured label
  // stagger once before.
  fontFamily: "'Hanken Grotesk', 'Hanken Fallback', 'Hanken Fallback Alt', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  // A metadata voice for machine strings: snapshot ids, column names, file names, ingestion counts.
  // Mantine's `<Code>` was already resolving *some* mono stack here — its own default — so this is
  // less about introducing monospace than about the app owning the choice and being able to apply it
  // outside `<Code>` (see `.mono` in app.css). Platform stack, so no font file to download and
  // nothing for the `font-src 'self' data:` CSP (vite.config.ts) to block.
  //
  // Deliberately NOT used for money. PeerRangeBar measures live label geometry with `offsetWidth` to
  // stagger colliding quartile labels, and the @font-face metric-override block in app.css exists to
  // keep that measurement stable across the webfont swap. Changing the face under a measured label is
  // the bug fixed in 17045d0.
  fontFamilyMonospace: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
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
      // The card-title step. Seventy-seven cards across the app labelled themselves with a
      // `<Text size="sm" fw={600}>` — a styled span, not a heading — because the ramp stopped at h4
      // and nothing on it was the right size for a card. `CardTitle` renders here instead.
      h5: { fontSize: '0.9375rem', lineHeight: '1.35' },
    },
  },
  // The measured landing page ran 48 → 22 → 18 → 16 → 14 → 12px on nineteen elements → 11 → 10: nine
  // sizes with no reading register, so body copy, captions and footnotes all shared 12px. Two changes
  // fix that without touching the heading ramp. `xs` moves off Mantine's 12px so `size="xs"` — the
  // app's most-used size by a wide margin — becomes a caption size rather than the default body size.
  // `xxs` (11px) stays the floor: eyebrows and dense labels only.
  fontSizes: { xxs: '0.6875rem', xs: '0.8125rem' },
  // A shadow means "this is floating above the page" — nothing else. Cards are already bordered (86
  // `withBorder` call sites), so the old soft 30px-blur `sm` was piling elevation on top of a border
  // that was already doing the separating, which is most of what made the app read as soft.
  //
  // `sm` is kept as a near-nothing hairline rather than removed so the eleven explicit `shadow="sm"`
  // call sites (ReportBrief, Compare) inherit the new discipline without being touched.
  shadows: {
    sm: '0 1px 2px rgba(16, 24, 32, .04)',
    md: '0 4px 12px rgba(16, 24, 32, .10)', // dropdowns, tooltips, popovers
    lg: '0 8px 32px rgba(16, 24, 32, .14)', // the selection tray, back-to-top
  },
  // Five real steps, and every one of them used. Two of these were previously Mantine's untouched
  // defaults doing the wrong job: `xs` was 2px (a corner you cannot see) and `xl` was 32px, which only
  // *looked* round because all twelve of its call sites are small circles and pills — an ActionIcon,
  // a ThemeIcon, the selection tray, the tray chips. `xl` is now an actual pill, which is what every
  // one of those sites meant.
  //
  // The card corner drops 16 -> 10. `md` stops being an alias of `lg`, so a control inside a card is
  // now visibly a smaller radius than the card, rather than the same one.
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '999px' },
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
