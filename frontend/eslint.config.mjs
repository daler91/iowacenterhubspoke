// ESLint flat config (ESLint 9).
//
// Scope is narrow on purpose: ONLY eslint-plugin-jsx-a11y's recommended
// rules. Adding the full eslint:recommended / react / react-hooks /
// import rulesets would surface hundreds of pre-existing warnings that
// aren't the focus of this PR — the goal here is to land the a11y
// enforcement the UX Architecture Review was asking for.
//
// We use @typescript-eslint/parser to parse .tsx files. No
// @typescript-eslint/eslint-plugin rules are enabled — the parser is
// present only so jsx-a11y can walk the JSX AST of TypeScript files.
//
// If you want to enable more rules later, add them in a new object at
// the bottom of the exported array so base a11y enforcement keeps
// working even if a new ruleset needs triage.

import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    ignores: [
      'build/**',
      'dist/**',
      'node_modules/**',
      'public/**',
      // Jest test files — they use Node globals + test-only helpers
      // that the browser scope doesn't understand. Covered by the
      // regular test run already.
      '**/*.test.ts',
      '**/*.test.tsx',
      // Config + build scripts run under Node, not the browser.
      '*.config.js',
      '*.config.mjs',
      'babel.config.js',
      'postcss.config.js',
      'tailwind.config.js',
      'vite.config.js',
      'scripts/**',
    ],
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    // react-hooks, added on top of the a11y-only baseline. `exhaustive-deps`
    // is the reason: this codebase leans hard on hook dependency arrays (SWR
    // keys, useMemo-derived outlet context, useCallback handler identity), and
    // a wrong dep list there produces stale data or a render loop rather than
    // a crash. Warnings, not errors, so an existing violation does not block
    // the build while the list is worked down — `rules-of-hooks` is the one
    // that is always a real bug, so it is an error.
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
