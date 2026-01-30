# Web Search

This document explains how web search works in the Claude Code proxy.

---

## Quick Start

Web search is **enabled by default**. When Claude Code requests a web search, the proxy:

1. Detects the special web search request pattern
2. Executes the search via Copilot CLI (using Bing)
3. Returns an Anthropic-compatible response

**Cost:** Free! Uses `gpt-4.1` model which costs 0 premium requests.

**Prerequisite:** [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) must be installed and authenticated.

---

## How It Works

### The Flow

```
User asks question requiring current info
         ↓
Claude Code sends web search execution request
(separate API call with special system prompt)
         ↓
Proxy detects the request pattern
         ↓
Proxy spawns Copilot CLI with search prompt
         ↓
Copilot executes web_search (Bing) server-side
         ↓
Proxy parses results and formats Anthropic-compatible response
         ↓
Claude Code displays "Did X searches" and shows results
```

### Key Discovery

Claude Code doesn't use normal tool_result flow for web search. It sends a **separate API request** with:

- System prompt: `"You are an assistant for performing a web search tool use"`
- Message: `"Perform a web search for the query: {query}"`

We detect this pattern and intercept it.

---

## Configuration

```bash
# Environment variables (all optional)
ENABLE_WEB_SEARCH=true      # Enable web search (default: true)
WEB_SEARCH_MODEL=gpt-4.1    # Copilot model for search (default: gpt-4.1)
WEB_SEARCH_TIMEOUT=60000    # Timeout in ms (default: 60000)
COPILOT_PATH=copilot        # Path to Copilot CLI (default: copilot)
```

### Why gpt-4.1?

- **0 premium requests** - completely free
- Same search quality as expensive models (search is server-side)
- The model only affects how results are formatted, not search quality

---

## Architecture

### Detection

```typescript
function isWebSearchExecutionRequest(request): string | null {
  // Check system prompt contains web search indicator
  if (!systemText.includes('performing a web search tool use')) {
    return null
  }

  // Extract query from message pattern
  const match = content.match(/Perform a web search for the query:\s*(.+)/i)
  return match?.[1]?.trim() ?? null
}
```

### Execution

We spawn Copilot CLI with a structured prompt:

```bash
copilot --allow-all --model gpt-4.1 -p "Execute web_search for: \"{query}\"

Return JSON only:
{
  \"query\": <the search query>,
  \"summary\": <full text from tool response>,
  \"sources\": [{\"title\": ..., \"url\": ...}]
}"
```

### Response Format

We return Anthropic's exact format:

| Block | Type                     | Purpose                                       |
| ----- | ------------------------ | --------------------------------------------- |
| 0     | `server_tool_use`        | The search query executed                     |
| 1     | `web_search_tool_result` | Array of sources (for "Did X searches" count) |
| 2     | `text`                   | Summary text                                  |

See `API_REFERENCE.md` for exact TypeScript types and payload shapes.

---

## File Structure

```
apps/proxy/src/
├── index.ts                 # Web search detection & response formatting
├── services/
│   └── webSearch.ts         # Copilot CLI execution & output parsing
└── transform/
    └── request.ts           # WEB_SEARCH_TOOL definition
```

---

## Key Findings

### 1. Claude Code Sends Separate Requests

Web search isn't a normal tool_result flow. Claude Code intercepts `web_search` tool_use and sends a dedicated API request with a special system prompt.

### 2. Anthropic's encrypted_content is Ignored

The `encrypted_content` field in Anthropic's response is never used by Claude Code. Only these fields matter:

- `title`
- `url`
- `page_age`

### 3. "Did X searches" Counter

Claude Code counts `web_search_tool_result.content.length` to display the search count. We initially showed "Did 0 searches" because we were missing this block.

### 4. Copilot's web_search is Server-Side

Copilot CLI's `web_search` tool uses Bing and executes server-side. It's not exposed via their MCP server or any public API. The only way to use it is by prompting a model to invoke it.

### 5. Model Doesn't Affect Search Quality

Since search is server-side, using `gpt-4.1` (free) gives identical search results to `claude-opus-4.5` (3 premium requests). The model only affects how results are summarized.

---

## Troubleshooting

### "Did 0 searches" in UI

Your response is missing the `web_search_tool_result` block. Check that the response includes:

```json
{
  "type": "web_search_tool_result",
  "tool_use_id": "...",
  "content": [{ "type": "web_search_result", "title": "...", "url": "..." }]
}
```

### Search returns empty results

1. Check Copilot CLI is authenticated: `copilot --version`
2. Test CLI can search: `copilot --allow-all -p "search web for test"`
3. Check proxy logs: `tail -f logs/requests.jsonl | jq .`

### Search times out

- Increase `WEB_SEARCH_TIMEOUT` environment variable
- Check network connectivity
- Typical search time is 30-40 seconds

### Request not detected as web search

Check proxy logs for the incoming request. It should have:

- System prompt containing `"performing a web search tool use"`
- Single message with `"Perform a web search for the query:"`

---

## Copilot CLI Details

### web_search Tool Definition

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "AI-powered web search with citations...",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" }
      },
      "required": ["query"]
    }
  }
}
```

### Copilot Response Format

```json
{
  "type": "text",
  "text": {
    "value": "Summary with【3:2†source】citations...",
    "annotations": [
      {
        "text": "【3:2†source】",
        "url_citation": { "title": "...", "url": "..." }
      }
    ]
  },
  "bing_searches": [{ "text": "query", "url": "bing.com/..." }]
}
```

### API Endpoints

| Endpoint                                      | Purpose                    |
| --------------------------------------------- | -------------------------- |
| `api.business.githubcopilot.com`              | Business tier              |
| `api.individual.githubcopilot.com`            | Individual tier            |
| `api.enterprise.githubcopilot.com`            | Enterprise tier            |
| `api.business.githubcopilot.com/mcp/readonly` | MCP server (no web_search) |

---

## Alternatives Considered

### 1. Direct Copilot API Call

- **Result:** web_search not exposed via API
- MCP server only has GitHub tools, not web_search

### 2. Implement Our Own Search

- Would need: Search API (Tavily/SerpAPI/Bing) + page fetching + content extraction
- More complex, additional costs

### 3. Wait for Official API

- Copilot may expose web_search in the future
- Not available now

### Chosen: Copilot CLI Subprocess

- Works with existing subscription
- No additional costs (gpt-4.1 is free)
- Simple implementation
- Returns AI-summarized content with citations

---

## Related Documentation

- `API_REFERENCE.md` - Exact TypeScript types, payload shapes, debugging techniques
- `archive/` - Historical research notes from reverse-engineering
