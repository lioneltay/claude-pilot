# API Reference: Web Search Payload Shapes

Exact TypeScript types and payload shapes for Claude Code's web search implementation.

---

## 1. Web Search Execution Request (Claude Code → API)

When Claude Code needs to execute a web search, it sends a **separate API request** (not a normal tool flow).

### Request Shape

```typescript
type WebSearchExecutionRequest = {
  model: string
  max_tokens: number
  stream: true
  system: string | Array<{ type: 'text'; text: string }>
  messages: [
    {
      role: 'user'
      content: string  // "Perform a web search for the query: {query}"
    }
  ]
}
```

### Detection Pattern

```typescript
// System prompt contains:
"You are an assistant for performing a web search tool use"

// User message matches:
/Perform a web search for the query:\s*(.+)/i
```

### Example Request

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 16000,
  "stream": true,
  "system": "You are an assistant for performing a web search tool use. Execute the search and return results.",
  "messages": [
    {
      "role": "user",
      "content": "Perform a web search for the query: Bitcoin price today 2026"
    }
  ]
}
```

---

## 2. Web Search Response (API → Claude Code)

### TypeScript Types

```typescript
// Content block types
type ServerToolUseBlock = {
  type: 'server_tool_use'
  id: string  // Format: "srvtoolu_01XXXXXXXXXXXXXXXXXX"
  name: 'web_search'
  input: Record<string, never>  // Empty object, query comes via delta
}

type WebSearchResult = {
  type: 'web_search_result'
  title: string
  url: string
  encrypted_content: string  // Base64 encoded, ~2KB - IGNORED by Claude Code
  page_age?: string  // e.g., "3 weeks ago", "5 days ago"
}

type WebSearchToolResultBlock = {
  type: 'web_search_tool_result'
  tool_use_id: string  // Must match ServerToolUseBlock.id
  content: WebSearchResult[]
}

type TextBlock = {
  type: 'text'
  text: string
}

// Delta types for streaming
type InputJsonDelta = {
  type: 'input_json_delta'
  partial_json: string  // JSON string: '{"query": "search term"}'
}

type TextDelta = {
  type: 'text_delta'
  text: string
}

type CitationsDelta = {
  type: 'citations_delta'
  citation: {
    type: 'web_search_result_location'
    cited_text: string
    url: string
    title: string
    encrypted_index: string  // IGNORED by Claude Code
  }
}

// SSE event types
type ContentBlockStart = {
  type: 'content_block_start'
  index: number
  content_block: ServerToolUseBlock | WebSearchToolResultBlock | TextBlock
}

type ContentBlockDelta = {
  type: 'content_block_delta'
  index: number
  delta: InputJsonDelta | TextDelta | CitationsDelta
}

type ContentBlockStop = {
  type: 'content_block_stop'
  index: number
}

type MessageStart = {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: []
    model: string
    stop_reason: null
    stop_sequence: null
    usage: { input_tokens: number; output_tokens: number }
  }
}

type MessageDelta = {
  type: 'message_delta'
  delta: { stop_reason: 'end_turn' | 'tool_use' }
  usage?: { output_tokens: number }
}

type MessageStop = {
  type: 'message_stop'
}
```

---

## 3. SSE Streaming Event Sequence

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_xxx","name":"web_search","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\": \"search query\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_xxx","content":[...]}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Based on the search..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 4. Complete Response Example

### Block 0: server_tool_use

```json
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "server_tool_use",
    "id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
    "name": "web_search",
    "input": {}
  }
}
```

Query via delta:
```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "input_json_delta",
    "partial_json": "{\"query\": \"Bitcoin price today 2026\"}"
  }
}
```

### Block 1: web_search_tool_result

```json
{
  "type": "content_block_start",
  "index": 1,
  "content_block": {
    "type": "web_search_tool_result",
    "tool_use_id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
    "content": [
      {
        "type": "web_search_result",
        "title": "Bitcoin Price Today | BTC USD Live",
        "url": "https://www.coinmarketcap.com/currencies/bitcoin/",
        "encrypted_content": "EuEPCioIDBgCIh...",
        "page_age": "1 hour ago"
      },
      {
        "type": "web_search_result",
        "title": "Bitcoin (BTC) Price, Charts, and News | Coinbase",
        "url": "https://www.coinbase.com/price/bitcoin",
        "encrypted_content": "EoQhCioIDBgCIh...",
        "page_age": "2 hours ago"
      }
    ]
  }
}
```

### Block 2+: text (with optional citations)

```json
{
  "type": "content_block_start",
  "index": 2,
  "content_block": {
    "type": "text",
    "text": ""
  }
}
```

Text delta:
```json
{
  "type": "content_block_delta",
  "index": 2,
  "delta": {
    "type": "text_delta",
    "text": "Based on the search results, Bitcoin is currently trading at..."
  }
}
```

Citation delta (optional):
```json
{
  "type": "content_block_delta",
  "index": 2,
  "delta": {
    "type": "citations_delta",
    "citation": {
      "type": "web_search_result_location",
      "cited_text": "Bitcoin reached $105,000 in January 2026",
      "url": "https://www.coinmarketcap.com/currencies/bitcoin/",
      "title": "Bitcoin Price Today",
      "encrypted_index": "Eo8BCioIDBgC..."
    }
  }
}
```

---

## 5. What Claude Code Actually Uses

### From web_search_tool_result.content[]

| Field | Used | Notes |
|-------|------|-------|
| `type` | ✅ | Must be `"web_search_result"` |
| `title` | ✅ | Displayed in UI |
| `url` | ✅ | Displayed in UI, used for links |
| `page_age` | ✅ | Displayed in UI |
| `encrypted_content` | ❌ | **Ignored** - can be dummy value |

### From citations

| Field | Used | Notes |
|-------|------|-------|
| `type` | ✅ | Must be `"web_search_result_location"` |
| `cited_text` | ✅ | The quoted text |
| `url` | ✅ | Link to source |
| `title` | ✅ | Source title |
| `encrypted_index` | ❌ | **Ignored** - can be dummy value |

### UI "Did X searches" Counter

Claude Code counts `web_search_tool_result.content.length` to show "Did X searches".

---

## 6. Minimal Working Response (for proxy implementation)

```typescript
const toolUseId = `srvtoolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`

const events = [
  // Message start
  `event: message_start`,
  `data: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-20250514',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })}`,

  // Block 0: server_tool_use
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'server_tool_use',
      id: toolUseId,
      name: 'web_search',
      input: {},
    },
  })}`,

  `event: content_block_delta`,
  `data: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({ query: searchQuery }),
    },
  })}`,

  `event: content_block_stop`,
  `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,

  // Block 1: web_search_tool_result
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      content: sources.map(s => ({
        type: 'web_search_result',
        title: s.title,
        url: s.url,
        encrypted_content: 'encrypted',  // Dummy - ignored
        page_age: 'recent',
      })),
    },
  })}`,

  `event: content_block_stop`,
  `data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}`,

  // Block 2: text summary
  `event: content_block_start`,
  `data: ${JSON.stringify({
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: '' },
  })}`,

  `event: content_block_delta`,
  `data: ${JSON.stringify({
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'text_delta', text: summary },
  })}`,

  `event: content_block_stop`,
  `data: ${JSON.stringify({ type: 'content_block_stop', index: 2 })}`,

  // Message end
  `event: message_delta`,
  `data: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 100 },
  })}`,

  `event: message_stop`,
  `data: ${JSON.stringify({ type: 'message_stop' })}`,
]

// Join with double newlines, end with double newline
const body = events.join('\n\n') + '\n\n'
```

---

## 7. Copilot CLI web_search Tool

### Tool Definition (from Copilot)

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "This tool performs an AI-powered web search...",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "A clear, specific question..."
        }
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
    "value": "Here are the key findings...",
    "annotations": [
      {
        "text": "【3:2†source】",
        "start_index": 969,
        "end_index": 981,
        "url_citation": {
          "title": "Page Title",
          "url": "https://example.com"
        }
      }
    ]
  },
  "bing_searches": [
    {
      "text": "search query",
      "url": "https://www.bing.com/search?q=..."
    }
  ]
}
```

---

## 8. Quick Reference

### Detect Web Search Request

```typescript
function isWebSearchRequest(req: Request): string | null {
  const system = getSystemText(req)
  if (!system.includes('performing a web search tool use')) return null

  const content = getMessageContent(req.messages[0])
  const match = content.match(/Perform a web search for the query:\s*(.+)/i)
  return match?.[1]?.trim() ?? null
}
```

### Generate Tool Use ID

```typescript
const toolUseId = `srvtoolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
```

### Required Response Headers

```typescript
{
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
}
```
