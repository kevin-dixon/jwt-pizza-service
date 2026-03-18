#!/bin/bash

# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

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
# Worker: pizza creation failure via invalid storeId (every 3-8 minutes)
# ---------------------------------------------------------------------------
while true; do
  token=$(login "d@jwt.com" "diner")
  if [ -n "$token" ] && [ "$token" != "null" ]; then
    payload='{"franchiseId":1,"storeId":9999,"items":[{"menuId":1,"description":"Veggie","price":0.0038}]}'
    result=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$host/api/order" \
      -H 'Content-Type: application/json' -d "$payload" \
      -H "Authorization: Bearer $token")
    echo "Intentional bad order... $result"
    curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"
  fi
  rand_sleep 180 480
done &
pid3=$!

# ---------------------------------------------------------------------------
# Diner worker: login → buy 1-4 random pizzas over a 30-120 s session →
#              logout → wait 5-60 s (offline) → repeat
# Users: d@jwt.com, d1-d6@jwt.com  (up to 7 concurrent diner sessions)
# ---------------------------------------------------------------------------
diner_worker() {
  local email=$1 password=$2 label=$3
  local token result session elapsed wait count mid items payload

  while true; do
    # Offline gap before next session
    rand_sleep 5 60

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
        # Buy 1-4 pizzas, random menu items 1-5
        count=$(( RANDOM % 4 + 1 ))
        items='[{"menuId":1,"description":"Veggie","price":0.0038}'
        for i in $(seq 2 $count); do
          mid=$(( RANDOM % 5 + 1 ))
          items="$items,{\"menuId\":$mid,\"description\":\"Pizza\",\"price\":0.0042}"
        done
        items="$items]"
        payload="{\"franchiseId\":1,\"storeId\":1,\"items\":$items}"
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