#!/bin/bash

set -euo pipefail

# Check if host is provided as a command line argument
if [ -z "${1:-}" ]; then
  echo "Usage: $0 <host> [--strict]"
  echo "Example: $0 http://localhost:3000"
  echo "Example: $0 https://pizza-service.kevin-jwt-pizza.click --strict"
  exit 1
fi

host=$1
strict=${2:-}

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install jq and rerun this script."
  exit 1
fi

echo "Authenticating as admin..."
authResponse=$(curl -s -X PUT "$host/api/auth" -d '{"email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json')
token=$(echo "$authResponse" | jq -r '.token')

if [ -z "$token" ] || [ "$token" = "null" ]; then
  echo "Error: Could not authenticate admin user."
  echo "$authResponse"
  exit 1
fi

echo "Deleting all orders..."
ordersDeleteCode=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/order" -H "Authorization: Bearer $token")
if [ "$ordersDeleteCode" = "404" ]; then
  echo "  orders -> 404 (endpoint not deployed on this service yet; continuing)"
else
  echo "  orders -> $ordersDeleteCode"
fi

echo "Deleting all franchises..."
franchises=$(curl -s "$host/api/franchise?page=0&limit=500&name=%2A" -H "Authorization: Bearer $token")
echo "$franchises" | jq -r '(.franchises // [])[] | .id' | tr -d '\r' | while read -r franchiseId; do
  [ -z "$franchiseId" ] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/franchise/$franchiseId" -H "Authorization: Bearer $token")
  echo "  franchise $franchiseId -> $code"
done

echo "Deleting all non-admin users..."
users=$(curl -s "$host/api/user?page=0&limit=500&name=%2A" -H "Authorization: Bearer $token")
echo "$users" | jq -c '(.users // [])[]' | tr -d '\r' | while read -r user; do
  userId=$(echo "$user" | jq -r '.id' | tr -d '\r')
  isAdmin=$(echo "$user" | jq -r 'any(.roles[]?; .role == "admin")')
  if [ "$isAdmin" != "true" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/user/$userId" -H "Authorization: Bearer $token")
    echo "  user $userId -> $code"
  fi
done

echo "Deleting all menu items..."
menu=$(curl -s "$host/api/order/menu")
menuDeleteUnsupported=0
mapfile -t menuIds < <(echo "$menu" | jq -r '(. // [])[] | .id' | tr -d '\r')
for menuId in "${menuIds[@]}"; do
  menuId=$(echo "$menuId" | tr -d '\r')
  [ -z "$menuId" ] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/order/menu/$menuId" -H "Authorization: Bearer $token")
  if [ "$code" = "404" ]; then
    echo "  menu delete endpoint not deployed on this service; skipping menu delete pass"
    menuDeleteUnsupported=1
    break
  fi
  echo "  menu item $menuId -> $code"
done

if [ "$strict" = "--strict" ]; then
  leftoverMenuCount=$(curl -s "$host/api/order/menu" | jq 'length')
  if [ "$leftoverMenuCount" -gt 0 ]; then
    echo "Strict mode enabled: menu is not empty after delete pass. Aborting."
    exit 1
  fi
fi

echo "Recreating baseline users..."
curl -s -o /dev/null -w "  d@jwt.com:  %{http_code}\n"  -X POST "$host/api/auth" -d '{"name":"pizza diner",    "email":"d@jwt.com",  "password":"diner"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  f@jwt.com:  %{http_code}\n"  -X POST "$host/api/auth" -d '{"name":"pizza franchisee", "email":"f@jwt.com",  "password":"franchisee"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d1@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 1",  "email":"d1@jwt.com", "password":"diner1"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d2@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 2",  "email":"d2@jwt.com", "password":"diner2"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d3@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 3",  "email":"d3@jwt.com", "password":"diner3"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d4@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 4",  "email":"d4@jwt.com", "password":"diner4"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d5@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 5",  "email":"d5@jwt.com", "password":"diner5"}' -H 'Content-Type: application/json'
curl -s -o /dev/null -w "  d6@jwt.com: %{http_code}\n" -X POST "$host/api/auth" -d '{"name":"pizza diner 6",  "email":"d6@jwt.com", "password":"diner6"}' -H 'Content-Type: application/json'

currentMenuCount=$(curl -s "$host/api/order/menu" | jq 'length')
if [ "$menuDeleteUnsupported" = "1" ] && [ "$currentMenuCount" -gt 0 ]; then
  echo "Skipping baseline menu create to avoid duplicates on older service API."
else
  echo "Creating baseline menu..."
  curl -s -X PUT "$host/api/order/menu" -H 'Content-Type: application/json' -d '{ "title":"Veggie", "description": "A garden of delight", "image":"pizza1.png", "price": 0.0038 }' -H "Authorization: Bearer $token" >/dev/null
  curl -s -X PUT "$host/api/order/menu" -H 'Content-Type: application/json' -d '{ "title":"Pepperoni", "description": "Spicy treat", "image":"pizza2.png", "price": 0.0042 }' -H "Authorization: Bearer $token" >/dev/null
  curl -s -X PUT "$host/api/order/menu" -H 'Content-Type: application/json' -d '{ "title":"Margarita", "description": "Essential classic", "image":"pizza3.png", "price": 0.0042 }' -H "Authorization: Bearer $token" >/dev/null
  curl -s -X PUT "$host/api/order/menu" -H 'Content-Type: application/json' -d '{ "title":"Crusty", "description": "A dry mouthed favorite", "image":"pizza4.png", "price": 0.0028 }' -H "Authorization: Bearer $token" >/dev/null
  curl -s -X PUT "$host/api/order/menu" -H 'Content-Type: application/json' -d '{ "title":"Charred Leopard", "description": "For those with a darker side", "image":"pizza5.png", "price": 0.0099 }' -H "Authorization: Bearer $token" >/dev/null
  echo "  baseline menu created"
fi

echo "Creating baseline franchise and store..."
createFranchiseResponse=$(curl -s -X POST "$host/api/franchise" -H 'Content-Type: application/json' -d '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}' -H "Authorization: Bearer $token")
franchiseId=$(echo "$createFranchiseResponse" | jq -r '.id')
if [ -n "$franchiseId" ] && [ "$franchiseId" != "null" ]; then
  curl -s -X POST "$host/api/franchise/$franchiseId/store" -H 'Content-Type: application/json' -d "{\"franchiseId\": $franchiseId, \"name\":\"SLC\"}" -H "Authorization: Bearer $token" >/dev/null
  echo "  franchise $franchiseId with store created"
else
  echo "  warning: failed to create franchise"
  echo "$createFranchiseResponse"
fi

curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"

echo "Done."