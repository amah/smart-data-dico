module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  plugins: ['@typescript-eslint', 'react-refresh'],
  env: {
    browser: true,
    es2020: true,
  },
  rules: {
    // High-signal errors kept as errors
    'no-debugger': 'error',
    'react-hooks/rules-of-hooks': 'error',

    // Downgrade or silence noisy rules for a never-linted codebase
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    'no-console': 'off',

    // react-refresh is informational only in this first-pass config
    'react-refresh/only-export-components': 'off',

    // Override eslint:recommended rules that are too strict for this codebase:
    // `no-undef` is redundant with TypeScript's own checking.
    'no-undef': 'off',
    // `no-unused-vars` is superseded by @typescript-eslint/no-unused-vars.
    'no-unused-vars': 'off',
    // `no-constant-condition` fires on intentional streaming loops (while(true)).
    'no-constant-condition': 'off',
    // `prefer-const` is stylistic; keep as warn so it's visible but not blocking.
    'prefer-const': 'warn',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'e2e/',
    '*.config.*',
    'coverage/',
  ],
};
