# Claude Pilot

A local proxy that routes [Claude Code](https://github.com/anthropics/claude-code) requests through GitHub Copilot's API.

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

## Documentation

See the [CLI documentation](packages/cli/README.md) for:

- Prerequisites
- All commands
- Configuration
- Troubleshooting

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│ Claude Code │────▶│   Proxy     │────▶│ GitHub Copilot  │
│   (CLI)     │◀────│  (Local)    │◀────│     API         │
└─────────────┘     └─────────────┘     └─────────────────┘
```

The proxy translates between Anthropic's Messages API and OpenAI's Chat Completions format, allowing Claude Code to work with your existing GitHub Copilot subscription.

## Development

```bash
# Install dependencies
pnpm install

# Start proxy with hot reload
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
