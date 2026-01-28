# Claude Pilot

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through GitHub Copilot's API.

## Prerequisites

### 1. GitHub Copilot Subscription

You need an active GitHub Copilot subscription (Individual, Business, or Enterprise).

### 2. Copilot CLI

Install the GitHub Copilot CLI:

```bash
npm install -g @github/copilot

# Verify installation
copilot --version
```

### 3. Claude Code

Install the Claude Code CLI:

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex

# Verify installation
claude --version
```

See [Claude Code setup docs](https://code.claude.com/docs/en/setup) for more details.

## Installation

```bash
npm install -g @lioneltay/claude-pilot
```

## Quick Start

```bash
# 1. Authenticate with GitHub Copilot
claude-pilot login

# 2. Run Claude Code (proxy starts automatically)
claude-pilot
```

## Commands

### `claude-pilot`

Run Claude Code with the proxy. If no arguments are provided, launches Claude Code interactively. Any arguments are passed through to Claude.

```bash
# Interactive mode
claude-pilot

# Pass arguments to claude
claude-pilot --help
claude-pilot "explain this codebase"
```

The proxy starts automatically if not already running.

### `claude-pilot login`

Authenticate with GitHub Copilot using the device flow.

```bash
claude-pilot login
```

This will:

1. Display a code and URL
2. Open GitHub in your browser
3. Enter the code to authorize
4. Save credentials to `~/.config/claude-pilot/auth.json`

### `claude-pilot start`

Start the proxy server in the background.

```bash
claude-pilot start
claude-pilot start -p 8080  # Custom port
```

### `claude-pilot stop`

Stop the running proxy server.

```bash
claude-pilot stop
```

### `claude-pilot status`

Show proxy status and authentication state.

```bash
claude-pilot status
```

### `claude-pilot dashboard`

Open the log viewer dashboard in your browser.

```bash
claude-pilot dashboard
```

## Configuration

All configuration is stored in `~/.config/claude-pilot/`:

| File             | Description                     |
| ---------------- | ------------------------------- |
| `auth.json`      | GitHub and Copilot tokens       |
| `daemon.json`    | Running proxy state (PID, port) |
| `server.log`     | Proxy server logs               |
| `requests.jsonl` | Request/response logs           |

## How It Works

Claude Pilot runs a local proxy that:

1. Receives requests from Claude Code in Anthropic's Messages API format
2. Transforms them to OpenAI's Chat Completions format
3. Forwards to GitHub Copilot's API
4. Transforms responses back to Anthropic format

This allows Claude Code to work with your existing GitHub Copilot subscription.

## Troubleshooting

### "Copilot CLI not found"

Make sure the Copilot CLI is installed and in your PATH:

```bash
copilot --version
```

If not installed, see [Prerequisites](#2-copilot-cli).

### "Claude CLI not found"

Make sure Claude Code is installed:

```bash
claude --version
```

If not installed, see [Prerequisites](#3-claude-code).

### "Token expired"

Re-authenticate:

```bash
claude-pilot login
```

### Check logs

```bash
# Server logs
cat ~/.config/claude-pilot/server.log

# Request logs
cat ~/.config/claude-pilot/requests.jsonl | jq .
```

## License

MIT
