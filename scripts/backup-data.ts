#!/usr/bin/env npx tsx
/**
 * Backup script: copies data-dictionaries/ to data-dictionaries-backup-{timestamp}/
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data-dictionaries');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = path.join(process.cwd(), `data-dictionaries-backup-${timestamp}`);

function copyRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory does not exist: ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log(`Backing up ${DATA_DIR} to ${BACKUP_DIR}...`);
copyRecursive(DATA_DIR, BACKUP_DIR);
console.log('Backup complete.');
