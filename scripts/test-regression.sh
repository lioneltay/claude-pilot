#!/bin/bash
# Regression test script for Claude Proxy
# Run with: pnpm test

PROXY_URL="${PROXY_URL:-http://localhost:8080}"
PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

log_pass() {
  echo -e "${GREEN}✓${NC} $1"
  PASS=$((PASS + 1))
}

log_fail() {
  echo -e "${RED}✗${NC} $1"
  FAIL=$((FAIL + 1))
}

echo "=== Claude Proxy Regression Tests ==="
echo "Target: $PROXY_URL"
echo ""

# TC01: Health check
echo "Running TC01: Health check..."
health=$(curl -s "$PROXY_URL/health" 2>/dev/null)
if [ "$health" = '{"status":"ok"}' ]; then
  log_pass "TC01: Health check"
else
  log_fail "TC01: Health check"
fi

# TC02: Basic non-streaming message
echo "Running TC02: Non-streaming message (may take ~30s)..."
response=$(curl -s --max-time 60 -X POST "$PROXY_URL/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":20,"stream":false,"messages":[{"role":"user","content":"Say OK"}]}')
if echo "$response" | jq -e '.type == "message"' > /dev/null 2>&1; then
  log_pass "TC02: Non-streaming message"
else
  log_fail "TC02: Non-streaming message"
fi

# TC03: Streaming message
echo "Running TC03: Streaming message (may take ~30s)..."
stream_response=$(curl -s --max-time 60 -X POST "$PROXY_URL/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":20,"stream":true,"messages":[{"role":"user","content":"Say OK"}]}')
if echo "$stream_response" | grep -q "message_start" 2>/dev/null; then
  log_pass "TC03: Streaming message"
else
  log_fail "TC03: Streaming message"
fi

# TC04: Token counting
echo "Running TC04: Token counting..."
tokens=$(curl -s --max-time 10 -X POST "$PROXY_URL/v1/messages/count_tokens" \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hello world"}]}')
if echo "$tokens" | jq -e '.input_tokens > 0' > /dev/null 2>&1; then
  log_pass "TC04: Token counting"
else
  log_fail "TC04: Token counting"
fi

# TC05: Model in response
echo "Running TC05: Model mapping..."
model_check=$(echo "$response" | jq -r '.model' 2>/dev/null)
if [ -n "$model_check" ] && [ "$model_check" != "null" ]; then
  log_pass "TC05: Model in response"
else
  log_fail "TC05: Model in response"
fi

# TC06: Streaming has correct event types
echo "Running TC06: Streaming event types..."
if echo "$stream_response" | grep -q "message_stop" 2>/dev/null; then
  log_pass "TC06: Streaming event types (message_stop present)"
else
  log_fail "TC06: Streaming event types (message_stop present)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Some tests failed. Check if:"
  echo "  1. Proxy is running: pnpm dev"
  echo "  2. Credentials are valid: pnpm auth"
  exit 1
fi

exit 0
