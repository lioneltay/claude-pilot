# Copilot Web Search Implementation Findings

This document captures all findings from reverse-engineering how GitHub Copilot CLI implements web search.

---

## Summary

**Copilot CLI CAN do web search** - confirmed via testing. The implementation uses:
1. **MCP (Model Context Protocol)** for GitHub-related tools
2. **A built-in `web_search` tool** that uses Bing under the hood
3. **API endpoint**: `https://api.business.githubcopilot.com`

---

## How to Enable Debug Logging

```bash
copilot --log-level debug --allow-all -p "search the web for X"
```

Logs are written to: `~/.copilot/logs/`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      COPILOT CLI                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Connects to MCP Server for GitHub tools                     │
│     URL: https://api.business.githubcopilot.com/mcp/readonly    │
│                                                                 │
│  2. Has built-in web_search tool (NOT from MCP)                 │
│     - Uses Bing under the hood                                  │
│     - Returns AI-generated summary with citations               │
│                                                                 │
│  3. Main API: https://api.business.githubcopilot.com            │
│     (also: api.individual.githubcopilot.com,                    │
│            api.enterprise.githubcopilot.com)                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## MCP Server Details

### Endpoint
```
https://api.business.githubcopilot.com/mcp/readonly
```

### Protocol
- JSON-RPC 2.0 over HTTP POST
- Requires SSE accept header for some operations

### Initialize Connection
```bash
curl -s "https://api.business.githubcopilot.com/mcp/readonly" \
  -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }'
```

### Response (successful)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": {
      "completions": {},
      "prompts": {},
      "resources": {},
      "tools": {}
    },
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "github-mcp-server",
      "title": "GitHub MCP Server"
    }
  }
}
```

### MCP Tools Available (NOT web_search)
From `/mcp/readonly`:
- `get_commit`
- `get_file_contents`
- `search_code`
- `search_issues`
- `search_pull_requests`
- `search_repositories`
- `search_users`
- `list_issues`
- `list_pull_requests`
- etc.

**Note:** `web_search` is NOT in the MCP server - it's a built-in Copilot tool.

---

## The web_search Tool

### Tool Definition (from debug logs)
```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "This tool performs an AI-powered web search to provide intelligent, contextual answers with citations.\n\nUse this tool when:\n- The user's query pertains to recent events or information that is frequently updated\n- The user's query is about new developments, trends, or technologies\n- The user's query is extremely specific, detailed, or pertains to a niche subject\n- The user explicitly requests a web search\n- You need current, factual information with verifiable sources\n\nReturns an AI-generated response with inline citations and a list of sources.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "A clear, specific question or prompt that requires up-to-date information from the web."
        }
      },
      "required": ["query"]
    }
  }
}
```

### How Model Calls It
```json
{
  "tool_calls": [
    {
      "id": "toolu_016SDtGzihD3AHoCfMgsRiUw",
      "type": "function",
      "function": {
        "name": "web_search",
        "arguments": "{\"query\": \"What are the latest AI news and developments in January 2026?\"}"
      }
    }
  ]
}
```

### Response Format
```json
{
  "type": "text",
  "text": {
    "value": "Here are the key AI news highlights and developments from January 2026:\n\n**Major Model Releases**\n- OpenAI released GPT-5 Chat...\n- Google's Gemini 3 Pro...\n- Anthropic debuted Claude 3 Opus...【3:2†source】【3:1†source】\n\n...",
    "annotations": [
      {
        "text": "【3:2†source】",
        "start_index": 969,
        "end_index": 981,
        "url_citation": {
          "title": "Latest AI News and Developments: January 2026 Roundup",
          "url": "https://multi-ai.ai/en/blog/latest-news-2026-en"
        }
      },
      {
        "text": "【3:1†source】",
        "start_index": 981,
        "end_index": 993,
        "url_citation": {
          "title": "AI News January 2026: In-Depth and Concise",
          "url": "https://theaitrack.com/ai-news-january-2026-in-depth-and-concise/"
        }
      }
    ]
  },
  "bing_searches": [
    {
      "text": "What are the latest AI news and developments in January 2026?",
      "url": "https://www.bing.com/search?q=What+are+the+latest+AI+news..."
    }
  ]
}
```

---

## Key Insights

### 1. web_search is NOT from MCP Server
- The MCP server at `/mcp/readonly` provides GitHub tools only
- `web_search` is a built-in Copilot tool handled separately

### 2. web_search Uses Bing
- The `bing_searches` field in the response confirms Bing is used
- Returns AI-generated summary with inline citations

### 3. Response Contains Full Summary
- The tool returns a complete AI-generated summary
- Includes inline citation markers like `【3:2†source】`
- Has `annotations` array mapping markers to URLs

### 4. Authentication
- Uses GitHub token (`ghu_...`) or Copilot token
- Token may expire - need to refresh

---

## What We Tried

### 1. HTTPS_PROXY Interception
- **Result:** Copilot's native binary doesn't respect proxy env vars

### 2. Node.js HTTP Module Patching
- **Result:** Copilot uses native binary, not Node.js http modules

### 3. Debug Logging (--log-level debug)
- **Result:** SUCCESS - captured full request/response flow

### 4. MCP Endpoint Direct Call
- **Result:** SUCCESS - can initialize and list tools
- **But:** web_search not in MCP tools

### 5. Direct Copilot API Call
- **Result:** Token expired error - need fresh token

---

## Latest Investigation Results (January 2026)

### Confirmed: web_search is NOT accessible via API

After extensive testing:

1. **MCP Server (`/mcp/readonly`)**: Does NOT have web_search in tools list
2. **MCP Server (`/mcp` non-readonly)**: Also does NOT have web_search
3. **Tried calling `tools/call` with `web_search`**: Error "unknown tool"
4. **Tried `/search`, `/web-search` endpoints**: 404 not found

### How Copilot CLI Executes web_search

From source code analysis (`index.js`):

```javascript
// The CLI renames the MCP server tool
Ivt = "github-mcp-server-web_search"  // Original name
dvt = "web_search"                     // Exposed name

// But the tool is NOT from MCP - it's built into the CLI
// The CLI has special handling for web_search execution
```

### Key Finding: web_search is a "Server Tool"

The `copilot_cache_control: { type: "ephemeral" }` flag in the tool definition suggests:
- This tool is handled differently from MCP tools
- The execution likely happens server-side when the model requests it
- The CLI acts as middleware between model and server

### What Happens During Execution

Timeline from debug logs:
```
08:05:20.761 - "Running tool calls in parallel"
08:05:20.863 - Flushed events to session
08:05:31.062 - "Tool invocation result" (10 seconds later)
```

The 10-second gap is the web search execution, but **no HTTP request is logged**.

This suggests the tool execution happens either:
1. **In native code** that doesn't log HTTP calls
2. **Via a streaming connection** already established
3. **Server-side** in the Copilot API (most likely)

### Conclusion

**We cannot directly call Copilot's web_search tool via API.**

The tool appears to be:
1. Defined by the Copilot backend
2. Executed server-side when model requests it
3. Not exposed through any public endpoint

### Options for Our Proxy

1. **Implement our own web search** using Tavily/SerpAPI/Bing
2. **Use a different approach** - prompt Copilot CLI via subprocess (hacky)
3. **Wait for official API** - Copilot may expose this in the future

---

## Previous Next Steps (Completed)

1. ~~**Get fresh Copilot token** and try direct API call with web_search tool~~ - Done, doesn't work
2. ~~**Check if web_search is executed server-side** when model requests it~~ - Confirmed server-side
3. ~~**Look for separate web_search endpoint** in Copilot API~~ - Not found
4. ~~**Use Copilot SDK** (`@github/copilot-sdk`) which may handle this automatically~~ - SDK doesn't expose this

---

## Relevant File Locations

- **Copilot CLI binary:** `~/.nvm/versions/node/v22.14.0/lib/node_modules/@github/copilot/`
- **Copilot config:** `~/.copilot/config.json`
- **Debug logs:** `~/.copilot/logs/`
- **Our auth tokens:** `~/.config/claude-proxy/auth.json`

---

## API Endpoints Found

| Endpoint | Purpose |
|----------|---------|
| `https://api.business.githubcopilot.com` | Main Copilot API (business tier) |
| `https://api.individual.githubcopilot.com` | Individual tier |
| `https://api.enterprise.githubcopilot.com` | Enterprise tier |
| `https://api.githubcopilot.com` | Generic endpoint |
| `https://api.business.githubcopilot.com/mcp/readonly` | MCP server for GitHub tools |
| `https://api.github.com/graphql` | Used to fetch Copilot URL for user |

---

## Potential Implementation for Our Proxy

If we can call Copilot's web_search:

```typescript
// When we intercept an Anthropic web_search request:
async function handleWebSearch(query: string) {
  // 1. Call Copilot API with web_search tool
  const response = await callCopilotWithWebSearch(query);

  // 2. Extract the summary and citations
  const { value, annotations } = response.text;

  // 3. Format as Anthropic tool_result
  const links = annotations.map(a => ({
    title: a.url_citation.title,
    url: a.url_citation.url
  }));

  return {
    type: "tool_result",
    content: `Web search results for: "${query}"\n\nLinks: ${JSON.stringify(links)}\n\n${value}`
  };
}
```

---

## Alternative: Implement Our Own

If we can't use Copilot's web search, implement our own:

1. **Search API:** Tavily, SerpAPI, or Bing API
2. **Fetch:** Get page content
3. **Extract:** Use Mozilla Readability
4. **Summarize:** Use Copilot to summarize the content
5. **Format:** Return as tool_result

See `WEB_SEARCH_METHODOLOGY.md` for full details.
