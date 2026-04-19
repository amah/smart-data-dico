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