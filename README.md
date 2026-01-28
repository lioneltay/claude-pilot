# Claude Proxy

A local proxy that routes [Claude Code](https://github.com/anthropics/claude-code) requests through GitHub Copilot's API, leveraging Copilot's request-based billing.

## Why?

- **Cost optimization**: GitHub Copilot charges ~$0.04 per request (not per token). Agent tool-use continuations are free, resulting in up to 80% savings on typical workflows.
- **Use existing subscription**: If you have a GitHub Copilot subscription, you can use Claude Code without a separate Anthropic API key.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│ Claude Code │────▶│   Proxy     │────▶│ GitHub Copilot  │
│   (CLI)     │◀────│  (Local)    │◀────│     API         │
└─────────────┘     └─────────────┘     └─────────────────┘
```

The proxy:

1. Receives Anthropic Messages API requests from Claude Code
2. Translates them to OpenAI Chat Completions format
3. Adds billing optimization headers (`X-Initiator: agent` for free requests)
4. Forwards to GitHub Copilot API
5. Translates responses back to Anthropic format

## Prerequisites

- Node.js 20+
- pnpm
- GitHub account with Copilot subscription (Individual, Business, or Enterprise)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (for web search feature)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Authenticate with GitHub Copilot

```bash
pnpm auth
```

This will:

- Open a GitHub device flow authentication
- Display a URL and code - visit the URL and enter the code
- Save credentials to `~/.config/claude-proxy/auth.json`

### 3. Start the proxy

```bash
pnpm dev
```

The proxy will start on `http://localhost:8080`.

### 4. Configure Claude Code

In your shell profile (`~/.zshrc` or `~/.bashrc`), add:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=dummy
```

Or add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_AUTH_TOKEN": "dummy"
  }
}
```

### 5. Use Claude Code

```bash
# Open a new terminal (to pick up env vars)
claude
```

## Available Models

The proxy maps Claude Code model requests to Copilot's available models:

| Claude Code Model     | Copilot Model       |
| --------------------- | ------------------- |
| `claude-sonnet-4-*`   | `claude-sonnet-4.5` |
| `claude-opus-4-*`     | `claude-opus-4`     |
| `claude-3-5-sonnet-*` | `claude-sonnet-4.5` |
| `claude-3-5-haiku-*`  | `claude-haiku-4.5`  |

## Billing Optimization

The proxy automatically optimizes billing using the `X-Initiator` header:

| Scenario                | Header               | Cost                 |
| ----------------------- | -------------------- | -------------------- |
| New user message        | `X-Initiator: user`  | **Charged** (~$0.04) |
| Agent tool continuation | `X-Initiator: agent` | **Free**             |

This means multi-step tool workflows (file reads, edits, command execution) only charge for the initial user request.

## Features

| Feature           | Status      | Notes                                        |
| ----------------- | ----------- | -------------------------------------------- |
| Basic chat        | ✅ Works    | Full support                                 |
| Streaming         | ✅ Works    | Full support                                 |
| Tool use          | ✅ Works    | Full support                                 |
| **WebSearch**     | ✅ Works    | Via Copilot CLI (free with gpt-4.1)          |
| **WebFetch**      | ✅ Works    | Client-side, pass-through                    |
| Extended thinking | ❌ N/A      | Not supported by Copilot                     |

### Web Search

Web search is implemented via Copilot CLI subprocess. When Claude Code requests a web search:
1. Proxy detects the request and spawns `copilot` CLI
2. Copilot executes Bing search server-side
3. Results returned in Anthropic-compatible format

**Cost:** Free! Uses `gpt-4.1` model (0 premium requests).

See [docs/WEB_SEARCH.md](docs/WEB_SEARCH.md) for details.

## Documentation

| Document | Description |
| -------- | ----------- |
| [docs/WEB_SEARCH.md](docs/WEB_SEARCH.md) | Web search implementation and configuration |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | TypeScript types, payload shapes, debugging techniques |

## Scripts

| Command      | Description                      |
| ------------ | -------------------------------- |
| `pnpm auth`  | Authenticate with GitHub Copilot |
| `pnpm dev`   | Start proxy with hot reload      |
| `pnpm start` | Start proxy                      |

## Troubleshooting

### "No credentials found"

Run `pnpm auth` to authenticate with GitHub Copilot.

### "Failed to get Copilot token"

Your GitHub token may have expired. Delete `~/.config/claude-proxy/auth.json` and run `pnpm auth` again.

### Claude Code not connecting

1. Ensure the proxy is running (`pnpm dev`)
2. Verify environment variables are set: `echo $ANTHROPIC_BASE_URL`
3. Open a new terminal after setting env vars

### Model not found

Copilot may not support all Claude models. Check the model mapping table above.

## License

ISC
