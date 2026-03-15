#!/usr/bin/env ts-node

import { runAllMigrations } from '../utils/migration.js';
import { logger } from '../utils/logger.js';

/**
 * Migration script to convert existing entities to UUID format
 */
async function main() {
  try {
    logger.info('Starting migration to UUID format...');
    await runAllMigrations();
    logger.info('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  main();
}