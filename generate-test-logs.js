#!/usr/bin/env node

/**
 * Test Log Generator
 * 
 * This script generates sample JSON logs in the same format as the application
 * to demonstrate how the log analyzer works.
 * 
 * Usage:
 *   node generate-test-logs.js [count]
 * 
 * Where:
 *   count - Number of log entries to generate (default: 50)
 */

// Sample endpoints with varying performance characteristics
const endpoints = [
  { path: '/api/dictionaries', method: 'GET', avgTime: 50, variance: 20 },
  { path: '/api/dictionaries/1', method: 'GET', avgTime: 30, variance: 10 },
  { path: '/api/dictionaries', method: 'POST', avgTime: 120, variance: 40 },
  { path: '/api/entities', method: 'GET', avgTime: 80, variance: 30 },
  { path: '/api/entities/1', method: 'GET', avgTime: 40, variance: 15 },
  { path: '/api/entities', method: 'POST', avgTime: 150, variance: 50 },
  { path: '/api/services', method: 'GET', avgTime: 200, variance: 100 },
  { path: '/api/versions', method: 'GET', avgTime: 60, variance: 20 },
  { path: '/health', method: 'GET', avgTime: 5, variance: 2 },
  { path: '/', method: 'GET', avgTime: 10, variance: 5 }
];

// Status codes with probabilities
const statusCodes = [
  { code: 200, probability: 0.9 },
  { code: 201, probability: 0.05 },
  { code: 400, probability: 0.02 },
  { code: 401, probability: 0.01 },
  { code: 404, probability: 0.01 },
  { code: 500, probability: 0.01 }
];

// Helper function to get a random status code based on probabilities
function getRandomStatusCode() {
  const rand = Math.random();
  let cumulativeProbability = 0;
  
  for (const status of statusCodes) {
    cumulativeProbability += status.probability;
    if (rand <= cumulativeProbability) {
      return status.code;
    }
  }
  
  return 200; // Default fallback
}

// Helper function to get random execution time based on average and variance
function getRandomExecutionTime(avg, variance) {
  // Simple normal-ish distribution using avg ± variance
  return Math.max(1, avg + (Math.random() * 2 - 1) * variance);
}

// Parse command line arguments
const count = parseInt(process.argv[2], 10) || 50;

// Generate logs
for (let i = 0; i < count; i++) {
  // Select a random endpoint
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  
  // Generate a random execution time based on the endpoint's characteristics
  const executionTimeMs = getRandomExecutionTime(endpoint.avgTime, endpoint.variance);
  
  // Get a random status code
  const status = getRandomStatusCode();
  
  // Create the log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message: 'HTTP Access',
    meta: {
      method: endpoint.method,
      path: endpoint.path,
      status,
      executionTimeMs: parseFloat(executionTimeMs.toFixed(2))
    }
  };
  
  // Output as JSON
  console.log(JSON.stringify(logEntry));
  
  // Small delay to simulate real-time logging
  if (i < count - 1) {
    const delay = Math.random() * 100;
    for (let j = 0; j < delay * 10000; j++) {
      // Busy wait to avoid async issues with stdout
    }
  }
}