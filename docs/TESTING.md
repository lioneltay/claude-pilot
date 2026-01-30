# Testing Guide

This guide covers manual and automated testing procedures for the Claude Proxy.

## Prerequisites

- Proxy running: `pnpm dev`
- Copilot CLI authenticated: `copilot --version`
- tmux installed: `brew install tmux` (macOS)

## Quick Smoke Test

Run these commands to verify basic functionality:

```bash
# 1. Health check
curl http://localhost:8080/health
# Expected: {"status":"ok"}

# 2. Test basic message (non-streaming)
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "stream": false,
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
# Expected: JSON response with assistant message
```

## Testing with tmux

tmux allows testing Claude Code with the proxy in an isolated session.

### Setup

```bash
# Terminal 1: Start proxy
pnpm dev

# Terminal 2: Create Claude Code session
tmux new-session -d -s claude-test \
  'ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=dummy claude --dangerously-skip-permissions'

# Attach to watch
tmux attach -t claude-test
```

### Sending Commands Programmatically

```bash
# Send a prompt and press Enter
tmux send-keys -t claude-test "What is 2+2?" Enter

# Wait for response, then capture output
sleep 10
tmux capture-pane -t claude-test -p
```

**Important:** If commands aren't being received properly, add a small delay between the text and Enter:

```bash
# With delay (more reliable)
tmux send-keys -t claude-test "What is 2+2?" && sleep 0.1 && tmux send-keys -t claude-test Enter
```

This can help when tmux buffers input too quickly.

### One-liner Test (for scripts)

```bash
# Run a single prompt and capture output
tmux kill-session -t claude-test 2>/dev/null
tmux new-session -d -s claude-test \
  'ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=dummy claude --dangerously-skip-permissions -p "What is 2+2?"'
sleep 15
tmux capture-pane -t claude-test -p
tmux kill-session -t claude-test
```

### Cleanup

```bash
tmux kill-session -t claude-test
```

## Test Cases

### TC01: Basic Message (Non-Streaming)

**Purpose:** Verify basic request/response flow

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 50,
    "stream": false,
    "messages": [{"role": "user", "content": "Reply with just the word BANANA"}]
  }'
```

**Expected:**

- HTTP 200
- Response contains `"type": "message"`
- Response contains `"role": "assistant"`
- Content includes "BANANA"

**Verify:** `jq '.content[0].text' | grep -i banana`

---

### TC02: Streaming Message

**Purpose:** Verify SSE streaming works correctly

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 50,
    "stream": true,
    "messages": [{"role": "user", "content": "Count from 1 to 5"}]
  }'
```

**Expected:**

- Content-Type: text/event-stream
- Events in order: `message_start`, `content_block_start`, `content_block_delta`(s), `content_block_stop`, `message_delta`, `message_stop`
- Text content contains "1", "2", "3", "4", "5"

---

### TC03: Web Search Detection

**Purpose:** Verify proxy detects and executes web search requests

```bash
# Using tmux (Claude Code generates proper web search format)
tmux kill-session -t claude-test 2>/dev/null
tmux new-session -d -s claude-test \
  'ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=dummy claude --dangerously-skip-permissions -p "Search the web for the current price of Bitcoin"'
sleep 30
tmux capture-pane -t claude-test -p
tmux kill-session -t claude-test
```

**Expected:**

- Server logs show: `Executing web search request`
- Server logs show: `query: "..."` with search terms
- Response includes search results or summary
- Log file shows `"webSearch": true`

**Verify in logs:**

```bash
tail -5 logs/requests.jsonl | jq 'select(.webSearch == true)'
```

---

### TC04: Tool Use (Non-Search)

**Purpose:** Verify regular tool calls work

```bash
# Using tmux with a file operation
tmux kill-session -t claude-test 2>/dev/null
tmux new-session -d -s claude-test \
  'cd /tmp && ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=dummy claude --dangerously-skip-permissions -p "Create a file called test123.txt with the content hello world"'
sleep 20
tmux capture-pane -t claude-test -p
tmux kill-session -t claude-test

# Verify file was created
cat /tmp/test123.txt
```

**Expected:**

- File `/tmp/test123.txt` exists
- File contains "hello world"
- Server logs show tool_use in response

---

### TC05: Suggestion Request Blocking

**Purpose:** Verify suggestion requests are blocked (cost saving)

This is tested implicitly - suggestion requests come from Claude Code's autocomplete feature. Check logs for:

```bash
tail -20 logs/requests.jsonl | jq 'select(.blocked == true)'
```

**Expected:**

- Blocked requests show `"blocked": true, "reason": "suggestion"`
- Response time is very fast (< 10ms)

---

### TC06: Model Mapping

**Purpose:** Verify Claude models map to correct Copilot models

| Input Model                | Expected Mapped Model |
| -------------------------- | --------------------- |
| claude-sonnet-4-20250514   | claude-sonnet-4       |
| claude-3-5-sonnet-20241022 | claude-3.5-sonnet     |
| claude-3-opus-20240229     | claude-3-opus         |

**Verify in logs:**

```bash
tail -10 logs/requests.jsonl | jq '{model, mappedModel}'
```

---

### TC07: Error Handling

**Purpose:** Verify errors are properly returned

```bash
# Invalid model
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "invalid-model-12345",
    "max_tokens": 50,
    "stream": false,
    "messages": [{"role": "user", "content": "test"}]
  }'
```

**Expected:**

- Error response with appropriate message
- Server doesn't crash

---

### TC08: Token Counting Endpoint

**Purpose:** Verify token counting stub works

```bash
curl -X POST http://localhost:8080/v1/messages/count_tokens \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello world this is a test message"}]
  }'
```

**Expected:**

- Returns `{"input_tokens": <number>}`
- Token count is approximately chars/4

---

## Regression Test Script

A regression test script is included at `scripts/test-regression.sh`.

**Run tests:**

```bash
pnpm test
# or
./scripts/test-regression.sh
```

**Expected output:**

```
=== Claude Proxy Regression Tests ===
Target: http://localhost:8080

Running TC01: Health check...
✓ TC01: Health check
Running TC02: Non-streaming message (may take ~30s)...
✓ TC02: Non-streaming message
Running TC03: Streaming message (may take ~30s)...
✓ TC03: Streaming message
Running TC04: Token counting...
✓ TC04: Token counting
Running TC05: Model mapping...
✓ TC05: Model in response
Running TC06: Streaming event types...
✓ TC06: Streaming event types (message_stop present)

=== Results: 6 passed, 0 failed ===
```

**Custom proxy URL:**

```bash
PROXY_URL=http://localhost:9000 pnpm test
```

---

## Log Analysis

### View Recent Requests

```bash
# Last 10 requests
tail -10 logs/requests.jsonl | jq .

# Only errors
cat logs/requests.jsonl | jq 'select(.type == "error")'

# Web search requests
cat logs/requests.jsonl | jq 'select(.webSearch == true)'

# Blocked requests
cat logs/requests.jsonl | jq 'select(.blocked == true)'

# Slow requests (> 5s)
cat logs/requests.jsonl | jq 'select(.responseTime > 5000)'
```

### Live Log Monitoring

```bash
# Watch all logs
tail -f logs/requests.jsonl | jq .

# Watch only requests
tail -f logs/requests.jsonl | jq 'select(.type == "request")'

# Watch web searches
tail -f logs/requests.jsonl | jq 'select(.webSearch == true)'
```

---

## Troubleshooting

### Proxy Won't Start

```bash
# Check if port is in use
lsof -i :8080

# Kill stale processes
lsof -ti:8080 | xargs kill -9
```

### Web Search Not Working

```bash
# 1. Check Copilot CLI works
copilot --version

# 2. Test Copilot CLI search directly
copilot --allow-all -p "search the web for test"

# 3. Check proxy startup message
# Should show: "Web search: enabled (via Copilot CLI)"

# 4. Check environment variable
echo $COPILOT_PATH  # Should be empty or valid path
```

### tmux Session Issues

```bash
# List all sessions
tmux list-sessions

# Kill all test sessions
tmux kill-session -t claude-test

# Kill ALL tmux sessions (careful!)
tmux kill-server
```

### Requests Timing Out

```bash
# Check Copilot token is valid
cat ~/.config/claude-proxy/auth.json | jq .

# Re-authenticate
pnpm auth
```

---

## Performance Benchmarks

Expected response times:

| Operation             | Expected Time |
| --------------------- | ------------- |
| Health check          | < 10ms        |
| Non-streaming message | 2-5s          |
| Streaming first byte  | < 2s          |
| Web search            | 10-30s        |
| Blocked suggestion    | < 5ms         |

---

## Checklist for New Features

Before merging any new feature:

- [ ] TC01-TC08 all pass
- [ ] No TypeScript errors: `pnpm typecheck`
- [ ] Server starts without errors
- [ ] Web search still works
- [ ] Logs are being written correctly
- [ ] No regressions in response format
