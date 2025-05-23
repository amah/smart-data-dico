import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config({ path: '.env.test' });

// Mock logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Global test setup
beforeAll(() => {
  // Setup any global test requirements here
});

// Global test teardown
afterAll(() => {
  // Clean up any global test resources here
});