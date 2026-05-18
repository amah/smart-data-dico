// This file is automatically loaded by Jest
// It sets up the testing environment

// Slice 6e.2 — disable the chokidar-based RawFsWatcher by default during
// tests. Disk-touching watcher tests opt back in by setting
// `process.env.DICO_WATCH_RAW = '1'` in their own beforeAll.
if (process.env.DICO_WATCH_RAW === undefined) {
  process.env.DICO_WATCH_RAW = '0';
}

// Global setup
beforeAll(() => {
  // Any global setup before all tests
});

// Global teardown
afterAll(() => {
  // Any global cleanup after all tests
});
