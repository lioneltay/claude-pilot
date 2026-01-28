# Web Search Implementation Guide

This document details how we implemented web search for Claude Code using the Copilot CLI proxy.

## Overview

Claude Code's web search works differently than expected. Instead of a simple tool_result flow, Claude Code:

1. Intercepts `web_search` tool_use from the model
2. Sends a **separate API request** to execute the search
3. Expects a specific response format with `web_search_tool_result`
4. Uses the results as tool_result content in the main conversation

## The Discovery Process

### Initial Assumption (Wrong)

We initially thought web search worked like other tools:
```
Model → tool_use(web_search) → Claude Code sends tool_result → Model continues
```

### Actual Flow (Discovered via Logs)

```
Model → tool_use(web_search) → Claude Code intercepts
                              → Sends SEPARATE API request for search execution
                              → Expects web_search_tool_result response
                              → Assembles tool_result for main conversation
```

### How We Discovered This

1. **Proxy logs showed separate requests** with pattern:
   - System prompt: `"You are an assistant for performing a web search tool use"`
   - Message: `"Perform a web search for the query: {query}"`

2. **This is NOT a normal tool flow** - it's a dedicated search execution request

## Detection Logic

In our proxy, we detect web search execution requests:

```typescript
function isWebSearchExecutionRequest(request: AnthropicRequest): string | null {
  // Check system prompt pattern
  const systemText = typeof request.system === 'string'
    ? request.system
    : request.system?.map(b => b.text).join('') || '';

  if (!systemText.includes('performing a web search tool use')) {
    return null;
  }

  // Check for single message with search query pattern
  if (request.messages.length !== 1) {
    return null;
  }

  const msg = request.messages[0];
  const content = typeof msg.content === 'string'
    ? msg.content
    : msg.content.filter(b => b.type === 'text').map(b => (b as {text: string}).text).join('');

  // Extract query from "Perform a web search for the query: X"
  const match = content.match(/Perform a web search for the query:\s*(.+)/i);
  if (match) {
    return match[1].trim();
  }

  return null;
}
```

## Anthropic's Web Search Response Format

Discovered via spy proxy logging actual Anthropic API responses.

### Block Structure

| Index | Type | Purpose |
|-------|------|---------|
| 0 | `server_tool_use` | The search query executed |
| 1 | `web_search_tool_result` | Search results array |
| 2+ | `text` | Model-generated summary |

### server_tool_use Block

```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "name": "web_search",
  "input": {}
}
```

The query comes via `input_json_delta`:
```json
{
  "type": "input_json_delta",
  "partial_json": "{\"query\": \"Bitcoin price today 2026\"}"
}
```

### web_search_tool_result Block

```json
{
  "type": "web_search_tool_result",
  "tool_use_id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "content": [
    {
      "type": "web_search_result",
      "title": "Page Title",
      "url": "https://example.com/page",
      "encrypted_content": "EuEPCioI...",  // Base64, ~2KB per result
      "page_age": "3 weeks ago"
    }
    // ... typically 10 results
  ]
}
```

**Key insight:** `encrypted_content` is ignored by Claude Code! Only these fields matter:
- `title` ✅
- `url` ✅
- `page_age` ✅

### text Blocks with Citations

```json
{
  "type": "content_block_delta",
  "index": 19,
  "delta": {
    "type": "citations_delta",
    "citation": {
      "type": "web_search_result_location",
      "cited_text": "The actual quoted text from the page",
      "url": "https://example.com",
      "title": "Page Title",
      "encrypted_index": "Eo8BCioI..."  // Also ignored
    }
  }
}
```

## Our Implementation

### Search Execution via Copilot CLI

We use Copilot CLI's built-in `web_search` tool (which uses Bing):

```typescript
const prompt = `Execute web_search for: "${query}"

Return JSON only:
{
  "query": <the search query>,
  "summary": <full text from tool response, do not truncate>,
  "sources": [{"title": ..., "url": ...}]
}`;

spawn('copilot', ['--allow-all', '--model', 'gpt-4.1', '-p', prompt]);
```

**Why gpt-4.1?**
- 0 premium requests (free)
- Fast (~10-15s)
- The web_search tool is the same regardless of model

### Parsing Copilot CLI Output

The CLI outputs:
```
● web_search
  └ {"type":"text","text":{"value":"Bitcoin is trading at...

{
  "query": "Bitcoin price",
  "summary": "As of January 28, 2026...",
  "sources": [
    {"title": "CoinMarketCap", "url": "https://..."},
    {"title": "CoinGecko", "url": "https://..."}
  ]
}

Total usage est: 0 Premium requests
```

We parse the JSON block between the tool output and usage stats.

### Response Format

We return a streaming response matching Anthropic's format:

```typescript
const events = [
  // Message start
  `event: message_start`,
  `data: ${JSON.stringify({ type: "message_start", message: {...} })}`,

  // Block 0: server_tool_use
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: {
      type: "server_tool_use",
      id: toolUseId,
      name: "web_search",
      input: {},
    },
  })}`,

  `event: content_block_delta`,
  `data: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "input_json_delta",
      partial_json: JSON.stringify({ query: searchQuery }),
    },
  })}`,

  // Block 1: web_search_tool_result
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: toolUseId,
      content: webSearchResults,  // Array of {type, title, url, encrypted_content, page_age}
    },
  })}`,

  // Block 2: text summary
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: "content_block_start",
    index: 2,
    content_block: { type: "text", text: "" },
  })}`,

  `event: content_block_delta`,
  `data: ${JSON.stringify({
    type: "content_block_delta",
    index: 2,
    delta: { type: "text_delta", text: formattedResult },
  })}`,

  // Message end
  `event: message_delta`,
  `data: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
  })}`,

  `event: message_stop`,
  `data: ${JSON.stringify({ type: "message_stop" })}`,
];
```

## UI Display: "Did X searches"

Claude Code counts searches from `web_search_tool_result.content.length`.

### Before (showed "0 searches")

We returned a simple text response - no `web_search_tool_result` block.

### After (shows correct count)

We include `web_search_tool_result` with our sources array:
```javascript
const webSearchResults = searchResult.sources.map((source) => ({
  type: "web_search_result",
  title: source.title,
  url: source.url,
  encrypted_content: "encrypted",  // Dummy - ignored
  page_age: "recent",
}));
```

Now Claude Code correctly displays "Did 5 searches" (or however many sources we have).

## Configuration

```bash
# Environment variables
ENABLE_WEB_SEARCH=true      # Enable web search (default: true)
WEB_SEARCH_MODEL=gpt-4.1    # Model for search (default: gpt-4.1)
WEB_SEARCH_TIMEOUT=60000    # Timeout in ms (default: 60000)
COPILOT_PATH=copilot        # Path to Copilot CLI (default: copilot)
```

## File Structure

```
apps/proxy/src/
├── index.ts                 # Main proxy, web search detection & response
├── services/
│   └── webSearch.ts         # Copilot CLI execution & parsing
└── transform/
    └── request.ts           # WEB_SEARCH_TOOL definition
```

## Interesting Findings

### 1. encrypted_content is Never Used

Anthropic's response includes `encrypted_content` for each search result, but Claude Code completely ignores it. Only `title`, `url`, and `page_age` matter.

### 2. Citations Have encrypted_index

Similarly, citation blocks have `encrypted_index` which is also ignored. Only `cited_text`, `url`, and `title` are used.

### 3. Copilot's web_search is Server-Side

Copilot CLI's `web_search` tool is not exposed via their MCP server. It's executed server-side when the model requests it. We tested:
- MCP `/mcp/readonly` endpoint - no web_search
- MCP `/mcp` endpoint - no web_search
- Direct `tools/call` - "unknown tool"

The only way to use it is by prompting a model to use it.

### 4. Model Doesn't Matter for Search Quality

Since `web_search` is a server-side Bing integration, using `gpt-4.1` (free) gives identical search results to `claude-opus-4.5` (3 premium requests). The model only affects how results are formatted.

### 5. Search Takes ~30-40s

Copilot CLI web search typically takes 30-40 seconds:
- ~10-15s for Bing search + AI summarization
- ~15-20s for CLI overhead

### 6. Claude Code Sends Dedicated Search Requests

Claude Code doesn't just forward tool_result - it intercepts web_search and sends a completely separate API request with a special system prompt. This is different from how other tools work.

## Troubleshooting

### "Did 0 searches" in UI

Check that your response includes `web_search_tool_result` block with `content` array.

### Search returns empty results

1. Check Copilot CLI is authenticated: `copilot --version`
2. Check CLI can search: `copilot --allow-all -p "search web for test"`
3. Check proxy logs for parsing errors

### Search times out

Increase `WEB_SEARCH_TIMEOUT` or check network connectivity.

## References

- `docs/WEB_SEARCH_ANALYSIS.md` - Initial Anthropic API analysis
- `docs/WEB_SEARCH_EXAMPLE.md` - Full response example
- `docs/COPILOT_WEB_SEARCH_FINDINGS.md` - Copilot CLI investigation
- `docs/COPILOT_WEB_SEARCH_WORKAROUND.md` - CLI subprocess approach
