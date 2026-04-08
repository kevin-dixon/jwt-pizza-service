#!/bin/bash

# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host> [failure-mode]"
  echo "Example: $0 http://localhost:3000 low"
  echo "failure-mode: off | low | medium | high (default: low)"
  exit 1
fi
host=$1
failure_mode=${2:-low}

case "$failure_mode" in
  off|low|medium|high)
    ;;
  *)
    echo "Error: invalid failure-mode '$failure_mode'. Use off | low | medium | high."
    exit 1
    ;;
esac

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install jq and rerun this script."
  exit 1
fi

# Trap SIGINT (Ctrl+C) to kill all background workers
cleanup() {
  echo "Terminating background processes..."
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap cleanup SIGINT

# Wrap curl to return the HTTP response code
execute_curl() {
  echo $(eval "curl -s -o /dev/null -w \"%{http_code}\" $1")
}

# Login and return the auth token
login() {
  local response
  response=$(curl -s -X PUT "$host/api/auth" \
    -d "{\"email\":\"$1\", \"password\":\"$2\"}" \
    -H 'Content-Type: application/json')
  echo "$response" | jq -r '.token'
}

# Sleep a random number of seconds in [min, max]
rand_sleep() {
  sleep $(( RANDOM % ($2 - $1 + 1) + $1 ))
}

menu_ids=()
valid_franchise_id=""
valid_store_id=""

# Pull current menu and franchise/store IDs so simulated orders track live data.
refresh_live_order_data() {
  local menu_response
  local franchise_response

  menu_response=$(curl -s "$host/api/order/menu")
  mapfile -t menu_ids < <(echo "$menu_response" | jq -r '(. // [])[] | .id' | tr -d '\r')

  franchise_response=$(curl -s "$host/api/franchise?page=0&limit=200&name=%2A")
  valid_franchise_id=$(echo "$franchise_response" | jq -r 'first((.franchises // [])[]? | select((.stores // []) | length > 0) | .id) // empty' | tr -d '\r')
  valid_store_id=$(echo "$franchise_response" | jq -r 'first((.franchises // [])[]? | select((.stores // []) | length > 0) | .stores[0].id) // empty' | tr -d '\r')

  if [ -z "$valid_franchise_id" ] || [ -z "$valid_store_id" ] || [ "${#menu_ids[@]}" -eq 0 ]; then
    return 1
  fi

  return 0
}

random_menu_id() {
  local idx
  idx=$(( RANDOM % ${#menu_ids[@]} ))
  echo "${menu_ids[$idx]}"
}

# ---------------------------------------------------------------------------
# Worker: browse the menu continuously (no auth, 3-8 s between requests)
# ---------------------------------------------------------------------------
while true; do
  result=$(curl -s -o /dev/null -w "%{http_code}" "$host/api/order/menu")
  echo "Requesting menu... $result"
  rand_sleep 3 8
done &
pid1=$!

# ---------------------------------------------------------------------------
# Worker: invalid credentials every 60-150 seconds
# ---------------------------------------------------------------------------
while true; do
  result=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$host/api/auth" \
    -d '{"email":"nobody@jwt.com","password":"wrong"}' \
    -H 'Content-Type: application/json')
  echo "Invalid login attempt... $result"
  rand_sleep 60 150
done &
pid2=$!

# ---------------------------------------------------------------------------
# Worker: intentional pizza creation failures via invalid storeId.
# Failure frequency is controlled by failure_mode.
# ---------------------------------------------------------------------------
failure_interval_seconds=60
failure_attempts_min=1
failure_attempts_max=2

if [ "$failure_mode" = "off" ]; then
  failure_attempts_min=0
  failure_attempts_max=0
elif [ "$failure_mode" = "medium" ]; then
  failure_attempts_min=2
  failure_attempts_max=4
elif [ "$failure_mode" = "high" ]; then
  failure_attempts_min=4
  failure_attempts_max=8
fi

echo "Traffic simulator failure mode: $failure_mode (intentional bad orders=${failure_attempts_min}-${failure_attempts_max} per ${failure_interval_seconds}s)"

submit_bad_order() {
  if ! refresh_live_order_data; then
    echo "Intentional bad order skipped: live menu/franchise/store data unavailable"
    return
  fi

  local invalid_store_id
  invalid_store_id=$(( valid_store_id + 999999 ))

  token=$(login "d@jwt.com" "diner")
  if [ -n "$token" ] && [ "$token" != "null" ]; then
    payload="{\"franchiseId\":$valid_franchise_id,\"storeId\":$invalid_store_id,\"items\":[{\"menuId\":$(random_menu_id),\"description\":\"Intentional failure\",\"price\":0.0038}]}"
    result=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$host/api/order" \
      -H 'Content-Type: application/json' -d "$payload" \
      -H "Authorization: Bearer $token")
    echo "Intentional bad order... $result"
    curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"
  fi
}

while true; do
  attempts=0
  if [ "$failure_attempts_max" -gt 0 ]; then
    attempts=$(( RANDOM % (failure_attempts_max - failure_attempts_min + 1) + failure_attempts_min ))
  fi

  for ((i = 1; i <= attempts; i++)); do
    submit_bad_order
    # Spread failures within the minute so they don't all land in a single second.
    if [ "$i" -lt "$attempts" ]; then
      rand_sleep 5 20
    fi
  done

  if [ "$attempts" -eq 0 ]; then
    echo "Intentional bad order worker paused (failure mode off)"
  fi

  sleep "$failure_interval_seconds"
done &
pid3=$!

# ---------------------------------------------------------------------------
# Diner worker: login → buy 1-4 random pizzas over a 30-120 s session →
#              logout → wait 5-60 s (offline) → repeat
# Users: d@jwt.com, d1-d6@jwt.com  (up to 7 concurrent diner sessions)
# ---------------------------------------------------------------------------
diner_worker() {
  local email=$1 password=$2 label=$3
  local token result session elapsed wait count items payload menu_id

  while true; do
    # Offline gap before next session
    rand_sleep 5 60

    if ! refresh_live_order_data; then
      echo "[$label] Live menu/franchise/store data unavailable, retrying"
      rand_sleep 10 20
      continue
    fi

    token=$(login "$email" "$password")
    if [ -z "$token" ] || [ "$token" = "null" ]; then
      echo "[$label] Login failed, will retry"
      continue
    fi
    echo "[$label] Logged in"

    # Random session length between 30 and 120 seconds
    session=$(( RANDOM % 91 + 30 ))
    elapsed=0

    while [ $elapsed -lt $session ]; do
      # Random wait between purchase events (10-35 seconds)
      wait=$(( RANDOM % 26 + 10 ))
      sleep $wait
      elapsed=$(( elapsed + wait ))

      if [ $elapsed -lt $session ]; then
        # Buy 1-4 pizzas, random live menu items
        count=$(( RANDOM % 4 + 1 ))
        menu_id=$(random_menu_id)
        items="[{\"menuId\":$menu_id,\"description\":\"Pizza\",\"price\":0.0038}"
        for ((i = 2; i <= count; i++)); do
          menu_id=$(random_menu_id)
          items="$items,{\"menuId\":$menu_id,\"description\":\"Pizza\",\"price\":0.0042}"
        done
        items="$items]"
        payload="{\"franchiseId\":$valid_franchise_id,\"storeId\":$valid_store_id,\"items\":$items}"
        result=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$host/api/order" \
          -H 'Content-Type: application/json' -d "$payload" \
          -H "Authorization: Bearer $token")
        echo "[$label] Bought $count pizza(s)... $result"
      fi
    done

    result=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/auth" \
      -H "Authorization: Bearer $token")
    echo "[$label] Logged out... $result"
  done
}

# ---------------------------------------------------------------------------
# Franchisee worker: login → stay 60-200 s → logout → wait 10-50 s → repeat
# Contributes 1 more authenticated user without pizza purchases
# ---------------------------------------------------------------------------
franchisee_worker() {
  local email=$1 password=$2 label=$3
  local token result

  while true; do
    rand_sleep 10 50

    token=$(login "$email" "$password")
    if [ -z "$token" ] || [ "$token" = "null" ]; then
      echo "[$label] Login failed, will retry"
      continue
    fi
    echo "[$label] Logged in"

    rand_sleep 60 200

    result=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/auth" \
      -H "Authorization: Bearer $token")
    echo "[$label] Logged out... $result"
  done
}

# ---------------------------------------------------------------------------
# Launch 7 diner workers  (d@jwt.com + d1-d6@jwt.com)
# ---------------------------------------------------------------------------
diner_worker "d@jwt.com"  "diner"  "diner-1" & pid4=$!
diner_worker "d1@jwt.com" "diner1" "diner-2" & pid5=$!
diner_worker "d2@jwt.com" "diner2" "diner-3" & pid6=$!
diner_worker "d3@jwt.com" "diner3" "diner-4" & pid7=$!
diner_worker "d4@jwt.com" "diner4" "diner-5" & pid8=$!
diner_worker "d5@jwt.com" "diner5" "diner-6" & pid9=$!
diner_worker "d6@jwt.com" "diner6" "diner-7" & pid10=$!

# Launch 1 franchisee worker  (f@jwt.com) — 8th possible concurrent user
franchisee_worker "f@jwt.com" "franchisee" "franchisee-1" & pid11=$!

# Wait for all workers
wait $pid1 $pid2 $pid3 $pid4 $pid5 $pid6 $pid7 $pid8 $pid9 $pid10 $pid11