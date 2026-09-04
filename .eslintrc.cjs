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
    {
      // Recharts tweens a mark whenever its data changes and has no notion of
      // prefers-reduced-motion, so a mark that says nothing animates on every filter change and
      // ignores the preference. Seventeen marks across six files had drifted into exactly that
      // while their neighbours were explicitly gated — convention had already failed here, so the
      // check is mechanical. Chart files only; scripts/ draws nothing.
      files: ['src/**/*.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'JSXOpeningElement[name.name=/^(Line|Bar|Area|Scatter|Pie|Radar|RadialBar)$/]' +
              ':not(:has(JSXAttribute[name.name=isAnimationActive]))' +
              ':not(:has(JSXSpreadAttribute > CallExpression[callee.name=chartAnim]))',
            message:
              'This Recharts mark will tween on every data change and ignore prefers-reduced-motion. ' +
              'Spread {...chartAnim(reduceMotion)} from src/lib/motion, or pass isAnimationActive explicitly.',
          },
        ],
      },
    },
  ],
  rules: {
    'no-undef': 'off', // TypeScript handles this
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
