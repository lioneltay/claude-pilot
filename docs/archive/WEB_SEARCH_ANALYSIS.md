# Web Search Analysis Report

This document explains how Anthropic's WebSearch feature works in Claude Code, based on traffic analysis of the real API.

## Overview

WebSearch is a **server-side feature** where Anthropic's servers execute the actual web search. The client (Claude Code) orchestrates the flow but doesn't perform searches directly.

## Request Flow

### 1. Initial User Request
When a user asks something that requires current information, Claude Code sends a normal `/v1/messages` request:

```
User: "search the web for the latest claude code version"
```

### 2. Model Decides to Search
Claude's response includes a tool use block indicating it wants to perform a web search:

```json
{
  "type": "tool_use",
  "name": "WebSearch",
  "input": { "query": "Claude Code CLI latest version 2026" }
}
```

### 3. Separate Web Search Request
Claude Code makes a **separate API call** specifically for the web search with a simplified prompt:

```json
{
  "model": "claude-opus-4-5-20251101",
  "messages": [{
    "role": "user",
    "content": [{
      "type": "text",
      "text": "Perform a web search for the query: Claude Code CLI latest version 2026"
    }]
  }],
  "system": [
    { "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." },
    { "type": "text", "text": "You are an assistant for performing a web search tool use" }
  ],
  "tools": [{
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 8
  }],
  "thinking": { "budget_tokens": 31999, "type": "enabled" },
  "stream": true
}
```

### 4. Anthropic Server Response
The response contains three content blocks:

#### a) Thinking Block
```json
{
  "type": "thinking",
  "thinking": "The user wants me to search for information about the latest version of Claude Code CLI in 2026. Let me perform this search."
}
```

#### b) Server Tool Use Block
```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "name": "web_search",
  "input": { "query": "Claude Code CLI latest version 2026" }
}
```

#### c) Web Search Tool Result Block
```json
{
  "type": "web_search_tool_result",
  "tool_use_id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "content": [
    {
      "type": "web_search_result",
      "title": "Claude Code 2.1 Is Here — I Tested 16 New Changes",
      "url": "https://medium.com/@joe.njenga/...",
      "encrypted_content": "EuEPCioIDBgC...",
      "page_age": "3 weeks ago"
    }
  ]
}
```

#### d) Text Blocks with Summary (Model-Generated)
After the search results, the model generates text content blocks with the summary:
```json
{
  "type": "content_block_start",
  "index": 17,
  "content_block": { "type": "text", "text": "" }
}
// Followed by text_delta events building the summary
{
  "type": "content_block_delta",
  "index": 17,
  "delta": { "type": "text_delta", "text": "## Claude Code CLI Latest Version (2026)\n\nVersion 2.1.0 shipped..." }
}
```

#### e) Citations with Readable Text Snippets
Text blocks can include citations that reference the source with **readable** `cited_text`:
```json
{
  "type": "content_block_delta",
  "index": 19,
  "delta": {
    "type": "citations_delta",
    "citation": {
      "type": "web_search_result_location",
      "cited_text": "Language-specific output via a language setting, enabling workflows that require output in Japanese, Spanish, or other languages...",
      "url": "https://venturebeat.com/...",
      "title": "Claude Code 2.1.0 arrives with smoother workflows...",
      "encrypted_index": "EpMBCioIDBgC..."
    }
  }
}
```

**Key observation**: The `cited_text` field contains the actual readable text snippet that was used. Claude Code extracts these readable fields (title, url, cited_text) - it never needs to decrypt `encrypted_content`.

### 5. Client-Side Processing
Claude Code receives the response and:
1. Extracts titles and URLs from the `web_search_tool_result`
2. Decrypts/processes the `encrypted_content` (implementation detail)
3. Formats a human-readable summary with links

### 6. Follow-up Request
Claude Code sends another request with the processed results as a tool_result:

```json
{
  "messages": [{
    "role": "user",
    "content": [{
      "type": "tool_result",
      "tool_use_id": "toolu_01Q8exH1d5TrdDL6KfkKEjyJ",
      "content": "Web search results for query: \"Claude Code CLI latest version 2026\"\n\nLinks: [{\"title\":\"...\",\"url\":\"...\"}]\n\nBased on the search results, here's what I found..."
    }]
  }]
}
```

## Key Technical Details

### Tool Type
The web search tool uses a versioned type identifier:
```
"type": "web_search_20250305"
```

### Encrypted Content - Key Insight
The `encrypted_content` field is **NOT decrypted by Claude Code**. Here's what actually happens:

1. Anthropic's servers fetch web pages and extract content
2. The REAL (unencrypted) content is given to Claude **on Anthropic's servers**
3. Claude generates a text summary in the response (as `text` content blocks)
4. The response includes citations with `cited_text` snippets (actual text from pages)

The `encrypted_content` is just for audit/reference purposes - Claude Code simply extracts the text summary that the model already generated. It doesn't need to decrypt anything.

### Server vs Client Tool Use
- `server_tool_use` - Executed by Anthropic's servers
- Regular `tool_use` - Executed by the client (Claude Code)

### Cost Implications
Each web search incurs **3 API calls**:
1. Initial request (model decides to search)
2. Web search execution request
3. Follow-up request with results

## Why It Doesn't Work Through Copilot

GitHub Copilot's API:
1. Does NOT support the `web_search_20250305` tool type
2. Returns empty tool results when web search is requested
3. Claude then "hallucinates" a response without actual search data

## Implementing Web Search for Copilot Proxy

Since Claude Code doesn't decrypt anything (it just passes through the model's summary), we can implement our own web search without replicating the encryption:

1. **Intercept** the WebSearch tool use in the initial response
2. **Execute searches** using our own search API (Google, Bing, DuckDuckGo, SerpAPI)
3. **Fetch pages** and extract content (web scraping with Cheerio, Puppeteer, etc.)
4. **Return as tool_result** with the actual content - no encryption needed!

### Implementation Approach
```typescript
// When we detect a WebSearch tool_use in the response:
if (toolUse.name === 'WebSearch') {
  const query = toolUse.input.query;

  // 1. Search using our API
  const searchResults = await searchAPI.search(query);

  // 2. Fetch and extract content from top results
  const contents = await Promise.all(
    searchResults.slice(0, 5).map(async (result) => {
      const html = await fetch(result.url);
      const text = extractMainContent(html); // Use readability/cheerio
      return { title: result.title, url: result.url, content: text };
    })
  );

  // 3. Format as tool_result (plain text, no encryption needed)
  const toolResult = formatAsToolResult(query, contents);

  // 4. Send follow-up request with results
  return sendFollowUp(originalMessages, toolResult);
}
```

### Required Components
- **Search API**: Google Custom Search, Bing API, SerpAPI, or DuckDuckGo
- **Content extraction**: Cheerio, Mozilla Readability, or Puppeteer
- **Rate limiting**: To avoid hitting API limits

### Key Insight
We don't need to match Anthropic's `encrypted_content` format. We just provide the raw content, and the model (via Copilot) will generate its own summary. The encryption was never meant for the client to decrypt - it was just Anthropic's way of packaging server-side search results.

## Data Flow Diagram

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   User Query    │─────▶│  Claude Code    │─────▶│ Anthropic API   │
│ "search web..." │      │    (Client)     │      │   (Server)      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                │                         │
                                │ 1. Initial request      │
                                │─────────────────────────▶
                                │                         │
                                │ 2. Response: wants      │
                                │    WebSearch tool       │
                                │◀─────────────────────────
                                │                         │
                                │ 3. Web search request   │
                                │    (simplified prompt)  │
                                │─────────────────────────▶
                                │                         │
                                │                    ┌────┴────┐
                                │                    │ Execute │
                                │                    │ Search  │
                                │                    └────┬────┘
                                │                         │
                                │ 4. server_tool_use +    │
                                │    web_search_tool_result│
                                │    (encrypted_content)  │
                                │◀─────────────────────────
                                │                         │
                         ┌──────┴──────┐                  │
                         │  Process &  │                  │
                         │  Decrypt    │                  │
                         └──────┬──────┘                  │
                                │                         │
                                │ 5. Follow-up with       │
                                │    tool_result (text)   │
                                │─────────────────────────▶
                                │                         │
                                │ 6. Final response       │
                                │    to user              │
                                │◀─────────────────────────
```

## Conclusion

Web search is deeply integrated into Anthropic's server infrastructure. The `encrypted_content` mechanism ensures that raw scraped web content isn't exposed directly through the API, while still providing Claude with the information needed to answer user queries.

To implement this feature through a third-party API like Copilot, significant work would be needed to replicate the search, fetch, and content extraction pipeline.
