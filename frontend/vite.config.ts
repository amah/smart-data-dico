import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Collapse `@hamak/ui-store-api` onto `@hamak/ui-store/api` so every
    // consumer (ui-remote-fs, ui-remote-git-fs, ui-store-impl, app) ends up
    // with the SAME Symbol('StoreManager') — upstream packages inconsistently
    // import the token from these two locations, which otherwise ship
    // distinct Symbol instances and break DI resolution at activate time.
    alias: [
      { find: /^@hamak\/ui-store-api$/, replacement: '@hamak/ui-store/api' },
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      },
      '/fs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Playwright e2e specs live in ./e2e and use @playwright/test, not Vitest.
    // Keep Vitest's defaults and just add the e2e dir so `npm test` ignores them.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'e2e/**',
    ],
    // Use forks pool so each test file runs in its own subprocess. OS
    // reclaims memory on process exit, eliminating the cumulative-heap
    // OOM that hits ~50+ files when running with the default threads pool.
    // Costs ~+20-40s wall time vs threads but stays bounded under 4 GB.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Recycle a fork per file so the OS reclaims heap between files, but
        // run ONE fork at a time (maxForks:1) so peak memory is bounded to a
        // single process — the parallel forks pool OOM'd the CI runner.
        // execArgv raises that fork's heap directly (job-level NODE_OPTIONS
        // does NOT propagate to vitest's fork workers).
        singleFork: false,
        maxForks: 1,
        minForks: 1,
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    server: {
      deps: {
        // Force @hamak/* through Vite's transform pipeline. Two concerns:
        // (a) extensionless ESM imports (amah/app-framework#11) — fixed in
        //     most packages at 0.5.5; the inline guard catches future
        //     regressions and packages that haven't republished yet.
        // (b) directory-style imports like `export * from './core'` in
        //     @hamak/ui-store-impl@0.5.0 — Node strict rejects with
        //     ERR_UNSUPPORTED_DIR_IMPORT. Explicit list because the regex
        //     form `[/^@hamak\//]` didn't fully cover this case in Vitest
        //     1.6 (verified by probe during the #166 stereotype-slice pilot).
        inline: [
          '@hamak/microkernel-impl',
          '@hamak/microkernel-api',
          '@hamak/microkernel-spi',
          '@hamak/ui-store-impl',
          '@hamak/ui-store-api',
          '@hamak/ui-store',
          '@hamak/ui-remote-fs',
          '@hamak/ui-remote-git-fs',
          '@hamak/ui-shell',
          '@hamak/shared-utils',
          '@hamak/notification',
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
      ],
    },
  }
})