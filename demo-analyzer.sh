#!/bin/bash

# demo-analyzer.sh - Demonstration script for the log analyzer
#
# This script generates sample logs and pipes them to the log analyzer
# to demonstrate how the tools work together.
#
# Usage:
#   ./demo-analyzer.sh [log-count] [analyzer-options]
#
# Examples:
#   ./demo-analyzer.sh 100 --threshold=150
#   ./demo-analyzer.sh 50 --method=GET

# Default number of logs to generate
LOG_COUNT=${1:-100}
shift 2>/dev/null

echo "=== Log Analyzer Demonstration ==="
echo "Generating $LOG_COUNT sample log entries..."
echo "Analyzer options: $@"
echo ""
echo "This demonstrates how the log analyzer processes and analyzes logs."
echo "In a real scenario, you would pipe actual application logs to the analyzer."
echo ""
echo "Press Ctrl+C at any time to stop the demo."
echo ""

# Generate logs and pipe to analyzer
node generate-test-logs.js $LOG_COUNT | node log-analyzer.js "$@"

echo ""
echo "=== Demo Complete ==="
echo ""
echo "To analyze your actual application logs, use:"
echo "  ./analyze-performance.sh [options]"
echo ""
echo "For more information, see PERFORMANCE-ANALYSIS.md"