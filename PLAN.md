# Claude Code to GitHub Copilot Proxy

## Overview

Build a local proxy server that intercepts Claude Code API requests (Anthropic format) and routes them through GitHub Copilot's API (OpenAI format), leveraging Copilot's request-based billing model.

---

## Research Findings

### Claude Code Configuration

Claude Code can be configured to use a custom API endpoint via:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=your-token
```

**API Format Required**: Anthropic Messages API (`/v1/messages`)

### GitHub Copilot API

**Base URL**: `https://api.githubcopilot.com`

**Available Claude Models**:
- `claude-haiku-4.5`
- `claude-sonnet-4.5`
- `claude-opus-4`

**API Format**: OpenAI-compatible (NOT Anthropic format)

### Authentication Flow

1. **OAuth Device Flow** → Get GitHub token
   - Client ID: `Iv1.b507a08c87ecfe98`
   - Endpoint: `https://github.com/login/device/code`
   - Scope: `read:user`

2. **Poll for Access Token**
   - Endpoint: `https://github.com/login/oauth/access_token`
   - Grant type: `urn:ietf:params:oauth:grant-type:device_code`

3. **Exchange for Copilot Token**
   - Endpoint: `https://api.github.com/copilot_internal/v2/token`
   - Returns: `{ token, expires_at }`

### Billing Optimization (KEY INSIGHT)

GitHub Copilot charges **per request (~$0.04)**, NOT per token.

The `X-Initiator` header controls billing:

| Header Value | When to Use | Billing |
|-------------|-------------|---------|
| `X-Initiator: "user"` | Last message is from user | **CHARGED** |
| `X-Initiator: "agent"` | Last message is from assistant/tool | **FREE** |

**Cost Savings Example**:
```
Without optimization (agent uses 5 tool calls):
- 5 API calls × $0.04 = $0.20

With optimization:
- 1 user request (charged) + 4 agent continuations (free) = $0.04
- Savings: 80%!
```

### Required Headers

```typescript
{
  'Authorization': `Bearer ${copilotToken}`,
  'X-Initiator': 'user' | 'agent',  // Billing control
  'Openai-Intent': 'conversation-edits',
  'editor-version': 'vscode/1.95.0',
  'editor-plugin-version': 'copilot-chat/0.22.4',
}
```

---

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────────┐
│ Claude Code │────────▶│   Proxy     │────────▶│ GitHub Copilot  │
│   (CLI)     │◀────────│  (Local)    │◀────────│     API         │
└─────────────┘         └─────────────┘         └─────────────────┘
     │                        │                        │
     │ Anthropic              │ Transform              │ OpenAI
     │ Messages API           │                        │ Compatible
     │ /v1/messages           │                        │ /chat/completions
     │                        │                        │
```

### Key Translation Layer

**Request Translation** (Anthropic → OpenAI):
```
Anthropic                          OpenAI
─────────                          ──────
POST /v1/messages           →      POST /chat/completions
model: "claude-sonnet-4-..."  →      model: "claude-sonnet-4.5"
system: "..."               →      messages[0]: {role: "system", ...}
messages: [...]             →      messages: [...] (role mapping)
max_tokens: 4096            →      max_tokens: 4096
tools: [...]                →      tools: [...] (schema translation)
stream: true                →      stream: true
```

**Response Translation** (OpenAI → Anthropic):
```
OpenAI                             Anthropic
──────                             ─────────
choices[0].message          →      content: [...]
choices[0].finish_reason    →      stop_reason
usage.prompt_tokens         →      usage.input_tokens
usage.completion_tokens     →      usage.output_tokens
tool_calls                  →      tool_use content blocks
```

---

## Implementation Plan

### Project Structure

```
claude-proxy/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # HTTP server (Fastify/Express)
│   ├── auth/
│   │   ├── device-flow.ts    # OAuth device code flow
│   │   ├── token.ts          # Token management & refresh
│   │   └── storage.ts        # Credential persistence
│   ├── transform/
│   │   ├── request.ts        # Anthropic → OpenAI request
│   │   ├── response.ts       # OpenAI → Anthropic response
│   │   ├── streaming.ts      # SSE translation
│   │   └── tools.ts          # Tool/function translation
│   ├── proxy/
│   │   └── handler.ts        # Main proxy request handler
│   └── types/
│       ├── anthropic.ts      # Anthropic API types
│       └── openai.ts         # OpenAI API types
├── package.json
├── tsconfig.json
└── README.md
```

### Phase 1: Authentication (MVP)

```typescript
// auth/device-flow.ts
const CLIENT_ID = 'Iv1.b507a08c87ecfe98'

async function initiateDeviceFlow() {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'read:user' }),
  })
  return response.json() // { device_code, user_code, verification_uri }
}

async function pollForAccessToken(deviceCode: string) {
  // Poll https://github.com/login/oauth/access_token
  // Handle authorization_pending, slow_down
}

async function getCopilotToken(githubToken: string) {
  const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: { Authorization: `Bearer ${githubToken}` },
  })
  return response.json() // { token, expires_at }
}
```

### Phase 2: Basic Proxy (Non-Streaming)

```typescript
// proxy/handler.ts
async function handleRequest(anthropicRequest: AnthropicRequest) {
  // 1. Transform request
  const openaiRequest = transformRequest(anthropicRequest)

  // 2. Determine billing header
  const lastMessage = anthropicRequest.messages[anthropicRequest.messages.length - 1]
  const xInitiator = lastMessage.role === 'user' ? 'user' : 'agent'

  // 3. Send to Copilot
  const response = await fetch('https://api.githubcopilot.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${copilotToken}`,
      'X-Initiator': xInitiator,
      'Openai-Intent': 'conversation-edits',
      'editor-version': 'vscode/1.95.0',
      'editor-plugin-version': 'copilot-chat/0.22.4',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openaiRequest),
  })

  // 4. Transform response
  const openaiResponse = await response.json()
  return transformResponse(openaiResponse)
}
```

### Phase 3: Request Translation

```typescript
// transform/request.ts
function transformRequest(anthropic: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = []

  // Handle system prompt
  if (anthropic.system) {
    messages.push({
      role: 'system',
      content: typeof anthropic.system === 'string'
        ? anthropic.system
        : anthropic.system.map(block => block.text).join('\n')
    })
  }

  // Transform messages
  for (const msg of anthropic.messages) {
    messages.push(transformMessage(msg))
  }

  return {
    model: mapModel(anthropic.model),
    messages,
    max_tokens: anthropic.max_tokens,
    temperature: anthropic.temperature,
    stream: anthropic.stream,
    tools: anthropic.tools?.map(transformTool),
  }
}

function mapModel(anthropicModel: string): string {
  // claude-sonnet-4-20250514 → claude-sonnet-4.5
  const modelMap: Record<string, string> = {
    'claude-sonnet-4-20250514': 'claude-sonnet-4.5',
    'claude-haiku-3-5-20241022': 'claude-haiku-4.5',
    'claude-opus-4-20250514': 'claude-opus-4',
    // Add more mappings as needed
  }
  return modelMap[anthropicModel] || anthropicModel
}
```

### Phase 4: Response Translation

```typescript
// transform/response.ts
function transformResponse(openai: OpenAIResponse): AnthropicResponse {
  const content: AnthropicContentBlock[] = []

  const message = openai.choices[0].message

  // Handle text content
  if (message.content) {
    content.push({ type: 'text', text: message.content })
  }

  // Handle tool calls
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      })
    }
  }

  return {
    id: openai.id,
    type: 'message',
    role: 'assistant',
    content,
    model: openai.model,
    stop_reason: mapStopReason(openai.choices[0].finish_reason),
    usage: {
      input_tokens: openai.usage.prompt_tokens,
      output_tokens: openai.usage.completion_tokens,
    },
  }
}
```

### Phase 5: Streaming Translation

```typescript
// transform/streaming.ts
async function* transformStream(
  openaiStream: ReadableStream
): AsyncGenerator<string> {
  const reader = openaiStream.getReader()
  const decoder = new TextDecoder()

  let messageId = `msg_${Date.now()}`
  let inputTokens = 0

  // Emit message_start
  yield `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: { id: messageId, type: 'message', role: 'assistant', content: [] }
  })}\n\n`

  // Emit content_block_start
  yield `event: content_block_start\ndata: ${JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  })}\n\n`

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        const openaiChunk = JSON.parse(data)
        const delta = openaiChunk.choices[0]?.delta

        if (delta?.content) {
          yield `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: delta.content }
          })}\n\n`
        }

        // Handle tool calls in streaming...
      }
    }
  }

  // Emit content_block_stop, message_delta, message_stop
  yield `event: content_block_stop\ndata: ${JSON.stringify({
    type: 'content_block_stop',
    index: 0
  })}\n\n`

  yield `event: message_stop\ndata: ${JSON.stringify({
    type: 'message_stop'
  })}\n\n`
}
```

### Phase 6: Tool Use Translation

```typescript
// transform/tools.ts

// Anthropic tool → OpenAI tool
function transformTool(anthropicTool: AnthropicTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: anthropicTool.name,
      description: anthropicTool.description,
      parameters: anthropicTool.input_schema,
    },
  }
}

// Anthropic tool_result message → OpenAI tool message
function transformToolResult(msg: AnthropicMessage): OpenAIMessage {
  const toolResult = msg.content.find(c => c.type === 'tool_result')
  return {
    role: 'tool',
    tool_call_id: toolResult.tool_use_id,
    content: typeof toolResult.content === 'string'
      ? toolResult.content
      : JSON.stringify(toolResult.content),
  }
}
```

---

## Usage

### First Time Setup

```bash
# Start the proxy
npx claude-proxy

# On first run, it will:
# 1. Show a device code and GitHub URL
# 2. Wait for you to authorize
# 3. Save credentials to ~/.config/claude-proxy/auth.json
# 4. Start the proxy server on localhost:8080
```

### Configure Claude Code

```bash
# Add to ~/.zshrc or ~/.bashrc
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=dummy  # Not used, but required

# Or add to ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_AUTH_TOKEN": "dummy"
  }
}
```

### Run Claude Code

```bash
claude  # Will now route through the proxy to Copilot
```

---

## Implementation Checklist

### MVP (Basic Functionality)
- [ ] Project setup (TypeScript, package.json)
- [ ] OAuth device flow authentication
- [ ] Token refresh mechanism
- [ ] Credential storage (~/.config/claude-proxy/)
- [ ] HTTP server on localhost
- [ ] Basic request translation (Anthropic → OpenAI)
- [ ] Basic response translation (OpenAI → Anthropic)
- [ ] Model name mapping
- [ ] X-Initiator billing optimization header

### Streaming Support
- [ ] SSE parsing from OpenAI format
- [ ] SSE generation in Anthropic format
- [ ] Handle text streaming
- [ ] Handle tool call streaming
- [ ] Proper event types (message_start, content_block_delta, etc.)

### Tool Use Support
- [ ] Tool definition translation
- [ ] Tool call response translation
- [ ] Tool result message translation
- [ ] Multiple tool calls in single response

### Advanced Features
- [ ] Extended thinking support (if available via Copilot)
- [ ] Vision/image support
- [ ] Token counting endpoint (/v1/messages/count_tokens)
- [ ] Error translation (Copilot errors → Anthropic format)
- [ ] Rate limit handling
- [ ] Request logging for debugging

### Polish
- [ ] CLI with nice output
- [ ] Auto-start on system boot (optional)
- [ ] Configuration file support
- [ ] Model selection override
- [ ] Proxy status endpoint

---

## Feature Parity Analysis

### Server-Side vs Client-Side Features

| Feature | Implementation | Proxy Support | Notes |
|---------|---------------|---------------|-------|
| Basic chat | API call | ✅ Full | Core functionality |
| Streaming | SSE | ✅ Full | Requires translation |
| Tool use | API feature | ✅ Full | Schema translation needed |
| **WebSearch** | **Server-side** | ❌ **Not possible** | Uses Anthropic's `web_search_20250305` tool |
| **WebFetch** | **Client-side** | ⚠️ **Partial** | See details below |
| Extended thinking | API feature | ❓ Unknown | Need to test with Copilot |
| Vision/images | API feature | ⚠️ Likely works | Need to verify Copilot support |

### WebSearch (❌ Cannot be proxied)

WebSearch is a **server-side Anthropic feature**:
- Uses proprietary `web_search_20250305` tool
- Searches happen on Anthropic's infrastructure
- Billed at $10 per 1,000 searches
- **Cannot be replaced or proxied to Copilot**

**Workaround Options:**
1. **Disable WebSearch** - Claude Code will fall back to other methods
2. **Implement custom search tool** - Add a local MCP server that provides web search via:
   - Brave Search API
   - SerpAPI
   - Google Custom Search
   - DuckDuckGo (free, no API key)

### WebFetch (⚠️ Partial support)

WebFetch has a **hybrid implementation**:
1. **Local HTTP fetch** via Axios (works through proxy)
2. **Domain safety check** via Anthropic's `domain_info` endpoint (needs Anthropic access)
3. **Content summarization** via Claude Haiku (secondary API call)

**Proxy Challenges:**
- Domain safety validation requires Anthropic API
- Summarization needs a secondary LLM call

**Workaround Options:**
1. **Skip domain validation** - Risky, but possible
2. **Use local Haiku via Copilot** - Route secondary calls through proxy too
3. **Implement local summarization** - Use a different model or skip summarization

### Extended Thinking (❓ Unknown)

Need to test if Copilot's Claude access supports:
- `anthropic-beta: interleaved-thinking-2025-05-14` header
- Thinking blocks in responses

**If not supported:**
- Claude Code may work but without extended thinking capabilities
- Could significantly impact code quality for complex tasks

---

## Potential Solutions for Missing Features

### Option A: Hybrid Proxy (Recommended)

Route MOST requests through Copilot, but fall back to Anthropic for:
- WebSearch (if user has Anthropic API key)
- Domain validation

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│ Claude Code │────▶│   Proxy     │────▶│ GitHub Copilot  │ (main requests)
│   (CLI)     │     │  (Local)    │     └─────────────────┘
└─────────────┘     │             │
                    │             │────▶┌─────────────────┐
                    │             │     │ Anthropic API   │ (WebSearch only)
                    └─────────────┘     └─────────────────┘
```

**Pros:** Full feature parity
**Cons:** Requires Anthropic API key for WebSearch

### Option B: MCP-Based Search Replacement

Add an MCP server that provides search capabilities:

```typescript
// mcp-search-server
{
  "tools": [{
    "name": "web_search",
    "description": "Search the web",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": { "type": "string" }
      }
    }
  }]
}
```

**Implementations:**
- [Brave Search MCP](https://github.com/anthropics/brave-search-mcp)
- [SerpAPI MCP](https://github.com/anthropics/serpapi-mcp)
- Custom DuckDuckGo implementation (free)

**Pros:** No Anthropic dependency for search
**Cons:** Different search quality, needs MCP setup

### Option C: Pure Copilot (Limited Features)

Accept that some features won't work:
- WebSearch: Disabled
- WebFetch: Works but without domain validation

**Pros:** Simplest implementation
**Cons:** Reduced functionality

---

## Potential Issues & Mitigations

| Issue | Mitigation |
|-------|------------|
| Model version mismatch | Map specific versions to Copilot's available models |
| Missing Anthropic features | Log warnings, return graceful errors |
| Token expiration | Auto-refresh 5 minutes before expiry |
| Rate limits | Implement exponential backoff |
| Extended thinking not available | May need to disable or emulate |
| WebSearch not available | Implement MCP-based alternative or hybrid routing |
| WebFetch domain validation | Skip validation or maintain Anthropic fallback |

---

## LiteLLM vs Custom Proxy

### Can We Use LiteLLM?

LiteLLM is mentioned in Claude Code docs as a supported gateway. However:

| Feature | LiteLLM | Custom Proxy |
|---------|---------|--------------|
| Basic proxying | ✅ | ✅ |
| Static headers | ✅ | ✅ |
| **Dynamic X-Initiator header** | ❌ | ✅ |
| Anthropic → OpenAI translation | ❌ | ✅ |
| Billing optimization | ❌ | ✅ |

**LiteLLM Limitations:**
- Can forward headers or set static headers
- **Cannot dynamically set X-Initiator based on message content**
- Doesn't translate Anthropic format → OpenAI format (for Copilot)

**Conclusion:** LiteLLM won't work for our use case because:
1. Copilot uses OpenAI format, Claude Code sends Anthropic format
2. We need dynamic `X-Initiator` header based on last message role
3. LiteLLM doesn't have request content inspection for header injection

**We need a custom proxy.**

---

## Tech Stack

- **Runtime**: Node.js 20+ (TypeScript)
- **HTTP Server**: Fastify (fast, low overhead)
- **Build**: tsup or esbuild
- **Package Manager**: pnpm
- **Distribution**: Local project (run with `pnpm dev`)

---

## Outstanding Questions (To Validate During Implementation)

### High Priority

| Question | Risk | How to Validate | Status |
|----------|------|-----------------|--------|
| Does Copilot support extended thinking? | **High** - Claude Code relies on this for complex reasoning | Send request with `anthropic-beta: interleaved-thinking-2025-05-14` header, check if thinking blocks appear in response | ⏳ Pending |
| Streaming tool calls format? | **Medium** - Claude Code uses tools heavily | Test tool-using request with streaming, verify format translation works | ⏳ Pending |

### Medium Priority

| Question | Risk | How to Validate | Status |
|----------|------|-----------------|--------|
| Vision/image support? | Medium - needed for screenshot analysis | Send request with base64 image, see if Copilot accepts it | ⏳ Pending |
| What model IDs does Claude Code actually send? | Medium - need accurate mapping | Log incoming requests from Claude Code, capture exact model strings | ⏳ Pending |
| Does Claude Code require `/v1/messages/count_tokens`? | Low - may be optional | Run Claude Code, check if it calls this endpoint | ⏳ Pending |

### Low Priority

| Question | Risk | How to Validate | Status |
|----------|------|-----------------|--------|
| Rate limits on Copilot API? | Low - can handle with backoff | Monitor 429 responses during testing | ⏳ Pending |
| Token usage accuracy? | Low - cosmetic | Compare reported tokens between Copilot and expected values | ⏳ Pending |

---

## References

- Source: `~/dev/coding-agent/packages/llm/src/providers/github-copilot.ts`
- Source: `~/dev/coding-agent/packages/auth/src/github.ts`
- Source: `~/dev/opencode/packages/opencode/src/plugin/copilot.ts`
