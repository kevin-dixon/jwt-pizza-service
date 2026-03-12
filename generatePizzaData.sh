#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 [service-host] [db-host] [db-user] [db-password] [db-port]"
  echo "Values are read from .env by default and can be overridden with args."
  echo "Example: $0 https://pizza-service.kevin-jwt-pizza.click jwt-pizza-service-db.example.us-east-1.rds.amazonaws.com admin mySecret 3306"
}

if [ "$#" -gt 5 ]; then
  usage
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

host="${1:-${SERVICE_HOST:-}}"
db_host="${2:-${DB_HOST:-}}"
db_user="${3:-${DB_USER:-}}"
db_password="${4:-${DB_PASSWORD:-}}"
db_port="${5:-${DB_PORT:-3306}}"

if [ -z "$host" ] || [ -z "$db_host" ] || [ -z "$db_user" ] || [ -z "$db_password" ]; then
  echo "Missing required values. Set SERVICE_HOST, DB_HOST, DB_USER, DB_PASSWORD in .env or pass args."
  usage
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_command curl
require_command jq
require_command mysql

api_call() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local auth="${4:-}"

  local response
  local body
  local code

  if [ -n "$data" ]; then
    if [ -n "$auth" ]; then
      response=$(curl -sS -w "\n%{http_code}" -X "$method" "$host$path" -H "Content-Type: application/json" -H "Authorization: Bearer $auth" -d "$data")
    else
      response=$(curl -sS -w "\n%{http_code}" -X "$method" "$host$path" -H "Content-Type: application/json" -d "$data")
    fi
  else
    if [ -n "$auth" ]; then
      response=$(curl -sS -w "\n%{http_code}" -X "$method" "$host$path" -H "Authorization: Bearer $auth")
    else
      response=$(curl -sS -w "\n%{http_code}" -X "$method" "$host$path")
    fi
  fi

  body="${response%$'\n'*}"
  code="${response##*$'\n'}"

  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "Request failed: $method $path (HTTP $code)"
    echo "$body"
    exit 1
  fi

  echo "$body"
}

echo "Resetting database 'pizza' on ${db_host}:${db_port} ..."
mysql --host="$db_host" --port="$db_port" --user="$db_user" --password="$db_password" <<'SQL'
DROP DATABASE IF EXISTS pizza;
CREATE DATABASE pizza CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL

echo "Verifying service is reachable ..."
api_call GET "/" >/dev/null

echo "Logging in as admin ..."
login_response=$(api_call PUT "/api/auth" '{"email":"a@jwt.com", "password":"admin"}')
token=$(echo "$login_response" | jq -r '.token // empty')

if [ -z "$token" ]; then
  echo "Failed to get admin token from /api/auth response"
  echo "$login_response"
  exit 1
fi

echo "Creating starter users ..."
api_call POST "/api/auth" '{"name":"pizza diner", "email":"d@jwt.com", "password":"diner"}' >/dev/null
api_call POST "/api/auth" '{"name":"pizza franchisee", "email":"f@jwt.com", "password":"franchisee"}' >/dev/null

echo "Creating starter menu ..."
api_call PUT "/api/order/menu" '{ "title":"Veggie", "description": "A garden of delight", "image":"pizza1.png", "price": 0.0038 }' "$token" >/dev/null
api_call PUT "/api/order/menu" '{ "title":"Pepperoni", "description": "Spicy treat", "image":"pizza2.png", "price": 0.0042 }' "$token" >/dev/null
api_call PUT "/api/order/menu" '{ "title":"Margarita", "description": "Essential classic", "image":"pizza3.png", "price": 0.0042 }' "$token" >/dev/null
api_call PUT "/api/order/menu" '{ "title":"Crusty", "description": "A dry mouthed favorite", "image":"pizza4.png", "price": 0.0028 }' "$token" >/dev/null
api_call PUT "/api/order/menu" '{ "title":"Charred Leopard", "description": "For those with a darker side", "image":"pizza5.png", "price": 0.0099 }' "$token" >/dev/null

echo "Creating starter franchise and store ..."
api_call POST "/api/franchise" '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}' "$token" >/dev/null
api_call POST "/api/franchise/1/store" '{"franchiseId": 1, "name":"SLC"}' "$token" >/dev/null

echo "Database reset and starter data generated"