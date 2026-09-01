/* ESLint config (classic format for ESLint 8). Non-type-aware: fast and dependency-light. */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  // `scripts` is linted: the 463-line ETL is the least-covered code in the repo (no typecheck, and
  // its own tests only reach scripts/lib), so the one automated check it can have should run.
  ignorePatterns: ['dist', 'public', 'node_modules', '*.config.*', '.eslintrc.cjs'],
  overrides: [
    {
      // Node tooling, not browser code: `process`, `console` and friends are expected here.
      files: ['scripts/**/*.mjs'],
      env: { node: true, browser: false },
    },
  ],
  rules: {
    'no-undef': 'off', // TypeScript handles this
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
