#!/bin/bash

# Usage:
#   ./runDevDashboardTraffic.sh
#   ./runDevDashboardTraffic.sh http://localhost:3000
#   ./runDevDashboardTraffic.sh http://localhost:3000 --skip-seed

set -e

host=${1:-http://localhost:3000}
skip_seed=${2:-}

if [ "$host" = "--skip-seed" ]; then
  host="http://localhost:3000"
  skip_seed="--skip-seed"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install jq and rerun this script."
  exit 1
fi

if [ "$skip_seed" != "--skip-seed" ]; then
  echo "Seeding service data on $host ..."
  ./generatePizzaData.sh "$host"
  echo "Seed step complete."
else
  echo "Skipping seed step."
fi

echo "Starting continuous traffic simulation against $host ..."
echo "Press Ctrl+C to stop all traffic workers."
./generatePizzaTraffic.sh "$host"
