#!/bin/bash

# Usage:
#   ./runDevDashboardTraffic.sh
#   ./runDevDashboardTraffic.sh http://localhost:3000
#   ./runDevDashboardTraffic.sh http://localhost:3000 --skip-seed
#   ./runDevDashboardTraffic.sh http://localhost:3000 --failure-mode=low

set -e

host=${1:-http://localhost:3000}
skip_seed=""
failure_mode="low"

if [ "$host" = "--skip-seed" ]; then
  host="http://localhost:3000"
fi

shifted_args="${*:2}"
for arg in $shifted_args; do
  if [ "$arg" = "--skip-seed" ]; then
    skip_seed="--skip-seed"
  elif [ "$arg" = "--failure-mode=off" ]; then
    failure_mode="off"
  elif [ "$arg" = "--failure-mode=low" ]; then
    failure_mode="low"
  elif [ "$arg" = "--failure-mode=medium" ]; then
    failure_mode="medium"
  elif [ "$arg" = "--failure-mode=high" ]; then
    failure_mode="high"
  fi
done

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
echo "Failure mode: $failure_mode"
echo "Press Ctrl+C to stop all traffic workers."
./generatePizzaTraffic.sh "$host" "$failure_mode"
