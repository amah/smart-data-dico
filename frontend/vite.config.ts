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
          '@hamak/ui-navigation',
          '@hamak/shared-utils',
          '@hamak/event-channel',
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