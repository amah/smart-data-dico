#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, cpSync } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');

// Parse CLI arguments
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { flags.port = args[++i]; }
  else if (args[i] === '--data-dir' && args[i + 1]) { flags.dataDir = args[++i]; }
  else if (args[i] === '--no-open') { flags.noOpen = true; }
  else if (args[i] === '--help' || args[i] === '-h') { flags.help = true; }
}

if (flags.help) {
  console.log(`
  smart-data-dico - Collaborative Data Dictionary Management

  Usage:
    smart-data-dico [options]
    npx smart-data-dico [options]

  Options:
    --port <number>     Server port (default: 3001)
    --data-dir <path>   Data directory path (default: ./data-dictionaries)
    --no-open           Don't open browser automatically
    -h, --help          Show this help

  Examples:
    smart-data-dico
    smart-data-dico --port 4000
    smart-data-dico --data-dir ~/my-dictionaries
  `);
  process.exit(0);
}

const port = flags.port || process.env.PORT || '3001';
const dataDir = resolve(flags.dataDir || process.env.DATA_DIR || './data-dictionaries');

// Ensure data directory exists
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log(`Created data directory: ${dataDir}`);

  // Copy default stereotypes if available
  const defaultStereotypes = join(PKG_ROOT, 'data-dictionaries', 'stereotypes.yaml');
  if (existsSync(defaultStereotypes)) {
    cpSync(defaultStereotypes, join(dataDir, 'stereotypes.yaml'));
    console.log('Copied default stereotypes');
  }

  // Create microservices directory
  mkdirSync(join(dataDir, 'microservices'), { recursive: true });
  mkdirSync(join(dataDir, 'perspectives'), { recursive: true });
}

// Determine paths
const backendDist = join(PKG_ROOT, 'backend', 'dist');
const frontendDist = join(PKG_ROOT, 'frontend', 'dist');
const serverEntry = join(backendDist, 'server.js');

// Check if built
if (!existsSync(serverEntry)) {
  // Try running from source (development mode)
  const serverTs = join(PKG_ROOT, 'backend', 'src', 'server.ts');
  if (existsSync(serverTs)) {
    console.log('Running in development mode (source)...');
    const child = spawn('npx', ['tsx', serverTs], {
      cwd: join(PKG_ROOT, 'backend'),
      env: {
        ...process.env,
        PORT: port,
        NODE_ENV: 'production',
        PROFILE: 'local',
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code || 0));
    process.on('SIGINT', () => child.kill('SIGINT'));
  } else {
    console.error('Error: Backend not built. Run `npm run build` first.');
    process.exit(1);
  }
} else {

// Set environment
process.env.PORT = port;
process.env.NODE_ENV = 'production';
process.env.PROFILE = process.env.PROFILE || 'local';

// Override data dir to the user's chosen directory
process.env.DATA_DIR = dataDir;

console.log(`
  Smart Data Dictionary

  Port:       ${port}
  Data:       ${dataDir}
  Profile:    ${process.env.PROFILE}
  Frontend:   ${existsSync(frontendDist) ? 'bundled' : 'not found (API only)'}
`);

console.log(`Starting server...`);

// Start the backend server
const child = spawn('node', [serverEntry], {
  cwd: join(PKG_ROOT, 'backend'),
  env: {
    ...process.env,
    PORT: port,
    NODE_ENV: 'production',
    PROFILE: process.env.PROFILE,
    DATA_DIR: dataDir,
  },
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code || 0));

// Open browser after short delay
if (!flags.noOpen) {
  setTimeout(async () => {
    const url = `http://localhost:${port}`;
    console.log(`Opening ${url} ...`);
    try {
      const { exec } = await import('child_process');
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    } catch {
      console.log(`Open ${url} in your browser`);
    }
  }, 2000);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

} // end else (built mode)
