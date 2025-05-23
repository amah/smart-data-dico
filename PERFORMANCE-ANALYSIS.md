# Performance Analysis Tools

This directory contains tools for analyzing the performance of the Smart Data Dictionary application by capturing and processing access logs.

## Overview

The application outputs JSON-formatted logs to the console, including access logs with HTTP method, path, status, and execution time. These tools help identify slow endpoints and performance bottlenecks.

## Tools Included

1. **log-analyzer.js** - A Node.js script that parses JSON logs, filters for HTTP requests, and sorts them by execution time.
2. **analyze-performance.sh** - A wrapper script that makes it easy to capture logs from the running application and pipe them to the analyzer.

## Requirements

- Node.js
- npm
- chalk package (installed via `npm install chalk`)

## Usage Options

### Option 1: Analyze logs from a running application

If you want to capture and analyze logs in real-time from a running application:

```bash
./analyze-performance.sh [options]
```

This will:
1. Start the application
2. Capture its console output
3. Pipe the output to the log analyzer
4. Display the analysis results when you press Ctrl+C

### Option 2: Pipe existing logs to the analyzer

If you've already captured logs to a file or want to pipe from another command:

```bash
cat logfile.json | node log-analyzer.js [options]
```

### Option 3: Analyze logs from an existing application

If the application is already running in another terminal:

```bash
# In the application terminal, redirect output to a file
npm run dev > app-logs.json

# In another terminal, analyze the logs
node log-analyzer.js < app-logs.json [options]
```

## Command Line Options

The log analyzer supports the following options:

- `--threshold=<ms>`: Highlight requests that take longer than specified milliseconds (default: 100)
- `--top=<n>`: Show only the top N slowest requests (default: all)
- `--method=<method>`: Filter by HTTP method (e.g., GET, POST)
- `--path=<pattern>`: Filter by path pattern (regex)
- `--status=<code>`: Filter by status code
- `--help`: Show help message

## Examples

1. Analyze all requests with a threshold of 200ms:
   ```bash
   ./analyze-performance.sh --threshold=200
   ```

2. Show only the top 10 slowest requests:
   ```bash
   ./analyze-performance.sh --top=10
   ```

3. Filter for only GET requests to API endpoints:
   ```bash
   ./analyze-performance.sh --method=GET --path=^/api
   ```

4. Analyze logs from a file with a 500ms threshold:
   ```bash
   cat app-logs.json | node log-analyzer.js --threshold=500
   ```

## Output

The analyzer produces two main sections of output:

1. **HTTP Request Performance Analysis**: A list of individual requests sorted by execution time, with slow requests highlighted.

2. **Endpoint Performance Summary**: Statistics grouped by endpoint, showing average, minimum, and maximum execution times.

## Tips for Performance Analysis

1. **Set an appropriate threshold**: Start with the default 100ms and adjust based on your application's requirements.

2. **Focus on the slowest endpoints**: The top 10 slowest requests often reveal the most critical bottlenecks.

3. **Look for patterns**: Check if slow requests are related to specific endpoints, HTTP methods, or status codes.

4. **Analyze under load**: Run the analysis during peak usage or with a load testing tool to identify performance issues that only appear under stress.

5. **Compare before and after**: When making optimizations, compare performance metrics before and after changes to verify improvements.