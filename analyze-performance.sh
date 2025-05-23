#!/bin/bash

# analyze-performance.sh - Wrapper script for log-analyzer.js
# 
# This script makes it easy to capture and analyze logs from the running application.
# It will run the application, capture its output, and pipe it to the log analyzer.
#
# Usage:
#   ./analyze-performance.sh [log-analyzer-options]
#
# Examples:
#   ./analyze-performance.sh --threshold=200 --top=10
#   ./analyze-performance.sh --method=GET --path=api

# Set default threshold if not provided
THRESHOLD_ARG=""
for arg in "$@"; do
  if [[ $arg == --threshold=* ]]; then
    THRESHOLD_ARG=$arg
    break
  fi
done

if [ -z "$THRESHOLD_ARG" ]; then
  THRESHOLD_ARG="--threshold=100"
fi

# Check if we're analyzing an existing log file
if [ -f "$1" ]; then
  echo "Analyzing log file: $1"
  cat "$1" | node log-analyzer.js ${@:2}
  exit 0
fi

echo "=== Performance Analysis Tool ==="
echo "This script will capture logs from your application and analyze them."
echo "Press Ctrl+C when you've collected enough data to analyze."
echo ""
echo "Options being passed to analyzer: $@"
echo ""
echo "Starting log capture..."

# If we're in the backend directory, run from there
if [ -d "backend" ]; then
  cd backend
  npm run dev | tee /dev/tty | node ../log-analyzer.js $@
else
  # Otherwise assume we're already in the backend directory
  npm run dev | tee /dev/tty | node ../log-analyzer.js $@
fi