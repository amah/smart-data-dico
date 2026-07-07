module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', {
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_'
    }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // #167 slice 5c — block new direct-fs imports; force IStorageBackend.
    // Allow-list lives in `overrides` below.
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'fs',
          message: 'Use IStorageBackend (src/storage/contract/) instead of direct fs. See overrides in .eslintrc.cjs for the allow-list.',
        },
        {
          name: 'fs/promises',
          message: 'Use IStorageBackend (src/storage/contract/) instead of direct fs/promises.',
        },
      ],
    }],
  },
  overrides: [
    {
      // Permanent: storage backend implementations + bootstrap + scripts.
      // fs IS the implementation layer here, by design. project.routes.ts
      // is pre-workspace (folder browsing, dataDir switching, project init
      // on arbitrary user-supplied paths) and conceptually lives at the
      // same layer as server.ts boot.
      files: [
        'src/storage/git/**',
        'src/storage/contract/registerStorageBackend.ts',
        'src/utils/appDir.ts',
        // Secret store persists to ~/.dico-app/ (app config outside the dico
        // project, same layer as appDir.ts) — IStorageBackend is scoped to the
        // project and must never hold credentials.
        'src/services/sql/secretStore.ts',
        'src/server.ts',
        'src/routes/project.routes.ts',
        'src/scripts/**',
        // Reverse-engineer plugin reads EXTERNAL repos by absolute path, so it
        // legitimately uses raw fs (IStorageBackend is scoped to the dico project).
        'src/services/reverseEngineer/**',
        // Search index is a derived SQLite (node:sqlite) cache under ~/.dico-app/
        // — SQLite must lock/mmap a real local file, so it cannot go through
        // IStorageBackend (which may be git-backed or in-memory). Same layer as
        // appDir.ts / secretStore.ts. Only fs use is mkdir for the cache dir.
        'src/services/search/searchIndex.ts',
      ],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      // Permanent: tests legitimately seed/inspect disk to set up workspaces.
      files: ['src/**/__tests__/**'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', 'jest.config.cjs', '.eslintrc.cjs'],
};
