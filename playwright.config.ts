import { defineConfig, devices } from '@playwright/test';

// Vite's `base` (see vite.config.ts) serves the whole app under this subpath — every baseURL/goto
// call must include it, and specs must always use RELATIVE paths (`./explore`, never `/explore`),
// or a leading slash escapes the base path and 404s.
const BASE_PATH = '/UW-Madison_Salaries/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000, // DuckDB-WASM init (parquet fetch + wasm boot) is slow on a cold page load
  workers: 1, // each test spins up its own DuckDB-WASM instance — too heavy to parallelize
  reporter: 'list',
  // Two projects so the visual baselines never run in CI. `npm run e2e` (the CI step in
  // .github/workflows/deploy.yml) runs `--project=e2e` only; `npm run e2e:visual` runs the other.
  // Baselines are captured on the developer's machine, and Playwright keys snapshots by platform —
  // on ubuntu-latest every macOS baseline would fail as "snapshot missing", not as a real regression.
  projects: [
    { name: 'e2e', testIgnore: /visual\.spec\.ts/ },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      // Set here rather than per-test: the app's motion helpers read the preference in `useState`
      // initializers (src/lib/motion.ts), so it has to be true before the first paint for counters
      // and reveals to render settled. It lives under `contextOptions` because `reducedMotion` is a
      // browser-context option, not a top-level `use` key (Playwright 1.61).
      use: { contextOptions: { reducedMotion: 'reduce' } },
    },
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  use: {
    // `vite preview` binds IPv6 localhost only (no --host flag) — 127.0.0.1 would refuse the
    // connection, so this must stay `localhost`, not the loopback IP.
    baseURL: `http://localhost:4173${BASE_PATH}`,
    serviceWorkers: 'block', // the PWA would otherwise serve stale cached bundles across test runs
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: `http://localhost:4173${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
