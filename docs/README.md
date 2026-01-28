# Documentation

This directory contains documentation for the Claude Code to GitHub Copilot proxy.

---

## Overview

This proxy allows you to run [Claude Code](https://github.com/anthropics/claude-code) using your GitHub Copilot subscription instead of paying for Anthropic API credits.

**Key features:**
- Full Claude Code functionality (chat, tools, streaming)
- Web search via Copilot CLI (free!)
- Cost optimization (~$0.04 per request, tool continuations free)

---

## Documents

| Document | Description |
|----------|-------------|
| [WEB_SEARCH.md](WEB_SEARCH.md) | How web search works, configuration, troubleshooting |
| [API_REFERENCE.md](API_REFERENCE.md) | TypeScript types, payload shapes, debugging techniques |

---

## Quick Links

### Getting Started
See the main [README.md](../README.md) for setup instructions.

### Web Search
Web search is enabled by default and costs **0 premium requests** (free).
- [How it works](WEB_SEARCH.md#how-it-works)
- [Configuration](WEB_SEARCH.md#configuration)
- [Troubleshooting](WEB_SEARCH.md#troubleshooting)

### Debugging & Development
- [Debugging methodology](API_REFERENCE.md#debugging--reverse-engineering-methodology)
- [Spy proxy technique](API_REFERENCE.md#technique-1-spy-proxy-intercept-real-api-traffic)
- [Testing with tmux](API_REFERENCE.md#technique-2-test-proxy-with-tmux)

### API Reference
- [Web search request format](API_REFERENCE.md#1-web-search-execution-request-claude-code--api)
- [Response TypeScript types](API_REFERENCE.md#2-web-search-response-api--claude-code)
- [SSE streaming sequence](API_REFERENCE.md#3-sse-streaming-event-sequence)
- [Minimal working response](API_REFERENCE.md#6-minimal-working-response-for-proxy-implementation)

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│ Claude Code │────▶│   Proxy     │────▶│ GitHub Copilot  │
│   (CLI)     │◀────│  (Local)    │◀────│     API         │
└─────────────┘     └─────────────┘     └─────────────────┘
                          │
                          │ Web Search
                          ▼
                    ┌─────────────┐
                    │ Copilot CLI │
                    │  (subprocess)│
                    └─────────────┘
```

---

## Archive

Historical research notes from reverse-engineering are preserved in [archive/](archive/).

These were used during development but the information has been consolidated into the main docs above.
