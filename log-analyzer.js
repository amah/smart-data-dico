#!/usr/bin/env node

/**
 * Log Analyzer for Smart Data Dictionary Application
 * 
 * This script captures and analyzes JSON logs from the console,
 * filters for HTTP requests, and sorts them by execution time.
 * 
 * Usage:
 *   node log-analyzer.js [options]
 * 
 * Options:
 *   --threshold=<ms>  Highlight requests that take longer than specified milliseconds (default: 100)
 *   --top=<n>         Show only the top N slowest requests (default: all)
 *   --method=<method> Filter by HTTP method (e.g., GET, POST)
 *   --path=<pattern>  Filter by path pattern (regex)
 *   --status=<code>   Filter by status code
 *   --help            Show this help message
 */

import readline from 'readline';

// Default configuration
const config = {
  threshold: 100, // ms
  top: Infinity,
  method: null,
  path: null,
  status: null,
  showHelp: false
};

// ANSI color codes for terminal output (instead of chalk)
const colors = {
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// Parse command line arguments
process.argv.slice(2).forEach(arg => {
  if (arg === '--help') {
    config.showHelp = true;
    return;
  }
  
  const match = arg.match(/^--([^=]+)=(.+)$/);
  if (match) {
    const [, key, value] = match;
    switch (key) {
      case 'threshold':
        config.threshold = parseInt(value, 10);
        break;
      case 'top':
        config.top = parseInt(value, 10);
        break;
      case 'method':
        config.method = value.toUpperCase();
        break;
      case 'path':
        config.path = new RegExp(value);
        break;
      case 'status':
        config.status = parseInt(value, 10);
        break;
    }
  }
});

// Show help and exit
if (config.showHelp) {
  console.log(`
Log Analyzer for Smart Data Dictionary Application

This script captures and analyzes JSON logs from the console,
filters for HTTP requests, and sorts them by execution time.

Usage:
  node log-analyzer.js [options]

Options:
  --threshold=<ms>  Highlight requests that take longer than specified milliseconds (default: 100)
  --top=<n>         Show only the top N slowest requests (default: all)
  --method=<method> Filter by HTTP method (e.g., GET, POST)
  --path=<pattern>  Filter by path pattern (regex)
  --status=<code>   Filter by status code
  --help            Show this help message
  `);
  process.exit(0);
}

// Create readline interface to read from stdin
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

// Store all HTTP access logs
const accessLogs = [];

// Process each line of input
rl.on('line', (line) => {
  try {
    // Try to parse the line as JSON
    const logEntry = JSON.parse(line);
    
    // Check if this is an HTTP access log
    if (logEntry.message === 'HTTP Access' && logEntry.meta) {
      const { method, path, status, executionTimeMs } = logEntry.meta;
      
      // Apply filters if specified
      if (config.method && method !== config.method) return;
      if (config.path && !config.path.test(path)) return;
      if (config.status && status !== config.status) return;
      
      // Add to our collection
      accessLogs.push({
        timestamp: logEntry.timestamp,
        method,
        path,
        status,
        executionTimeMs
      });
    }
  } catch (err) {
    // Ignore lines that aren't valid JSON
  }
});

// When stdin closes, analyze and display results
rl.on('close', () => {
  if (accessLogs.length === 0) {
    console.log('No HTTP access logs found.');
    return;
  }
  
  // Sort logs by execution time (descending)
  accessLogs.sort((a, b) => b.executionTimeMs - a.executionTimeMs);
  
  // Take only the top N if specified
  const logsToShow = accessLogs.slice(0, config.top);
  
  // Calculate statistics
  const totalRequests = accessLogs.length;
  const totalTime = accessLogs.reduce((sum, log) => sum + log.executionTimeMs, 0);
  const avgTime = totalTime / totalRequests;
  const slowRequests = accessLogs.filter(log => log.executionTimeMs > config.threshold).length;
  
  // Display summary
  console.log('\n=== HTTP Request Performance Analysis ===');
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Average Response Time: ${avgTime.toFixed(2)} ms`);
  console.log(`Slow Requests (>${config.threshold} ms): ${slowRequests} (${((slowRequests / totalRequests) * 100).toFixed(2)}%)`);
  console.log('');
  
  // Display table header
  console.log(colors.bold('Timestamp'.padEnd(25) + 
                        'Method'.padEnd(8) + 
                        'Status'.padEnd(8) + 
                        'Time (ms)'.padEnd(12) + 
                        'Path'));
  console.log('-'.repeat(80));
  
  // Display each log entry
  logsToShow.forEach(log => {
    const isSlow = log.executionTimeMs > config.threshold;
    const timeFormatted = isSlow 
      ? colors.red(log.executionTimeMs.toString().padEnd(12))
      : log.executionTimeMs.toString().padEnd(12);
    
    console.log(
      log.timestamp.padEnd(25) +
      log.method.padEnd(8) +
      log.status.toString().padEnd(8) +
      timeFormatted +
      log.path
    );
  });
  
  // Display endpoint summary
  console.log('\n=== Endpoint Performance Summary ===');
  
  // Group by path and calculate stats
  const endpointStats = {};
  accessLogs.forEach(log => {
    if (!endpointStats[log.path]) {
      endpointStats[log.path] = {
        count: 0,
        totalTime: 0,
        maxTime: 0,
        minTime: Infinity
      };
    }
    
    const stats = endpointStats[log.path];
    stats.count++;
    stats.totalTime += log.executionTimeMs;
    stats.maxTime = Math.max(stats.maxTime, log.executionTimeMs);
    stats.minTime = Math.min(stats.minTime, log.executionTimeMs);
  });
  
  // Convert to array and sort by average time
  const endpointArray = Object.entries(endpointStats)
    .map(([path, stats]) => ({
      path,
      count: stats.count,
      avgTime: stats.totalTime / stats.count,
      maxTime: stats.maxTime,
      minTime: stats.minTime
    }))
    .sort((a, b) => b.avgTime - a.avgTime);
  
  // Display table header
  console.log(colors.bold('Path'.padEnd(40) + 
                        'Count'.padEnd(8) + 
                        'Avg (ms)'.padEnd(12) + 
                        'Min (ms)'.padEnd(12) + 
                        'Max (ms)'));
  console.log('-'.repeat(80));
  
  // Display each endpoint
  endpointArray.forEach(endpoint => {
    const isSlow = endpoint.avgTime > config.threshold;
    const avgFormatted = isSlow 
      ? colors.red(endpoint.avgTime.toFixed(2).padEnd(12))
      : endpoint.avgTime.toFixed(2).padEnd(12);
    
    console.log(
      endpoint.path.padEnd(40) +
      endpoint.count.toString().padEnd(8) +
      avgFormatted +
      endpoint.minTime.toFixed(2).padEnd(12) +
      endpoint.maxTime.toFixed(2)
    );
  });
});

console.log(colors.yellow('Waiting for log input from stdin... (Press Ctrl+C to analyze)'));