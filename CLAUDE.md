# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A proxy that routes Claude Code CLI requests through GitHub Copilot's API, translating between Anthropic Messages API and OpenAI Chat Completions format. Uses Copilot's request-based billing (~$0.04 per user message, agent tool continuations free).

## Commands

```bash
# Development
pnpm dev              # Start proxy + dashboard with hot reload
pnpm dev:proxy        # Start only proxy
pnpm test             # Run regression tests (requires proxy running)
pnpm typecheck        # TypeScript validation

# Setup
pnpm auth             # Authenticate with GitHub Copilot (device flow)

# Logs
pnpm logs:clear       # Clear request logs
tail -f logs/requests.jsonl | jq .  # Watch live logs

# Release
pnpm publish:cli      # Publish CLI to npm (bump version first)
```

## Architecture

This is a Turborepo monorepo:

```
apps/
  proxy/          # Main proxy server (Fastify)
  dashboard/      # Log viewer web UI
  proxy-spy/      # Debugging: intercepts real Anthropic API
  dashboard-spy/  # Debugging: spy log viewer
packages/
  shared/         # Shared logger (JSONL to logs/requests.jsonl)
```

### Proxy Request Flow

```
Claude Code → POST /v1/messages (Anthropic format)
           → apps/proxy/src/index.ts (main handler)
           → transform/request.ts (Anthropic → OpenAI)
           → GitHub Copilot API
           → transform/response.ts or transform/streaming.ts (OpenAI → Anthropic)
           → Claude Code
```

### Key Modules (apps/proxy/src/)

- **index.ts**: Fastify server, routes requests to handlers
- **transform/request.ts**: Converts Anthropic Messages to OpenAI Chat Completions
- **transform/response.ts**: Converts non-streaming responses back
- **transform/streaming.ts**: `TransformStream` that converts SSE chunks in real-time
- **utils/detection.ts**: Detects web search requests and suggestion mode
- **utils/sse.ts**: SSE event builders for Anthropic format
- **services/webSearch.ts**: Spawns Copilot CLI for web search (free via gpt-4.1)
- **auth/**: GitHub device flow auth, token refresh, credential storage

### Routing Modes

The proxy supports two modes via `MODE` environment variable:

#### `copilot` (default)

All requests go through GitHub Copilot API. Copilot sets `X-Initiator` header:

- `user`: New user message (charged ~$0.04)
- `agent`: Tool continuation (free)

#### `split`

Routes requests based on type:

- **To Copilot**: Main conversation, subagents, tool continuations
  - User messages charged ~$0.04
  - Subagents and tool continuations are free (X-Initiator: agent)
- **To Anthropic**: Sidecars (title gen, file tracking)
  - Cheaper per-token for small utility requests

Requires `ANTHROPIC_API_KEY` environment variable.

```bash
MODE=split ANTHROPIC_API_KEY=sk-ant-... claude-pilot start
```

Benefits:

- Reduces Copilot API noise (fewer small utility requests)
- Accurate token counting via Anthropic API
- Still uses request-based billing for Opus/Sonnet

### Web Search Implementation

Claude Code web search triggers a special request pattern (system prompt contains "performing a web search tool use"). The proxy:

1. Detects this pattern in `detectWebSearchRequest()`
2. Spawns `copilot` CLI subprocess with the query
3. Parses output and returns in Anthropic `web_search_tool_result` format

## Type Preferences

Prefer `type` over `interface` for TypeScript definitions.

## Testing

Tests require the proxy to be running (`pnpm dev` in another terminal):

```bash
pnpm test  # Runs scripts/test-regression.sh
```

For manual testing with Claude Code:

```bash
tmux new-session -d -s test 'ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=dummy claude'
tmux attach -t test
```
