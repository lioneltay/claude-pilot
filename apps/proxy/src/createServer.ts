// Factory function to create the proxy server with integrated dashboard
// Can be imported and used by other packages (e.g., CLI)

import Fastify, { type FastifyInstance } from 'fastify'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { getValidCopilotToken, type StoredCredentials } from './auth/storage.js'
import { transformRequest, mapModel, WEB_SEARCH_TOOL } from './transform/request.js'
import { transformResponse } from './transform/response.js'
import { createStreamTransformer } from './transform/streaming.js'
import { executeWebSearch, formatAsToolResult } from './services/webSearch.js'
import { isCopilotCLIAvailable } from './utils/validation.js'
import {
  detectWebSearchRequest,
  isSuggestionRequest,
  isSidecarRequest,
  getXInitiator,
  getSystemText,
  hasImageContent,
} from './utils/detection.js'
import { estimateInputTokens } from './utils/tokenEstimator.js'
import {
  buildEmptyStreamingResponse,
  buildEmptyNonStreamingResponse,
  setStreamingHeaders,
} from './utils/sse.js'
import {
  buildWebSearchStreamingResponse,
  buildWebSearchNonStreamingResponse,
} from './handlers/webSearchResponse.js'
import { COPILOT_API_URL, COPILOT_HEADERS, FREE_MODEL } from './constants.js'
import type { AnthropicRequest } from './types/anthropic.js'
import type { OpenAIResponse } from './types/openai.js'

// Re-export auth for consumers
export type { StoredCredentials } from './auth/storage.js'
export { loadCredentials, saveCredentials, getValidCopilotToken } from './auth/storage.js'
export type { DeviceCodeResponse, CopilotToken } from './auth/github.js'
export { initiateDeviceFlow, pollForAccessToken, getCopilotToken } from './auth/github.js'

export type ProxyServerOptions = {
  credentials: StoredCredentials
  port?: number
  host?: string
  enableWebSearch?: boolean
  enableDashboard?: boolean
  logFullRequests?: boolean
  logger?: boolean | { level: string }
  logFile?: string
  authFile?: string // Path to auth file for token refresh saves
  log?: (entry: Record<string, unknown>) => Promise<void>
  summarizeMessages?: (messages: Array<{ role: string; content: unknown }>) => Array<{
    role: string
    contentPreview: string
    contentLength: number
    hasToolUse?: boolean
    hasToolResult?: boolean
  }>
}

export type ProxyServer = {
  fastify: FastifyInstance
  start: () => Promise<void>
  stop: () => Promise<void>
  port: number
}

// Dashboard HTML
const DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Claude Pilot Logs</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #fff; margin-bottom: 20px; }
    .controls { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
    button { padding: 8px 16px; background: #4a4a6a; border: none; color: white; cursor: pointer; border-radius: 4px; }
    button:hover { background: #5a5a7a; }
    .auto-refresh { display: flex; align-items: center; gap: 5px; }
    .entries { display: flex; flex-direction: column; gap: 10px; }
    .entry { background: #252540; border-radius: 8px; padding: 15px; border-left: 4px solid #666; }
    .entry.request { border-left-color: #4CAF50; }
    .entry.response { border-left-color: #2196F3; }
    .entry.error { border-left-color: #f44336; }
    .entry-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .entry-type { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .entry.request .entry-type { background: #4CAF50; }
    .entry.response .entry-type { background: #2196F3; }
    .entry.error .entry-type { background: #f44336; }
    .entry-time { color: #888; font-size: 12px; }
    .entry-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; }
    .meta-item { background: #1a1a2e; padding: 8px; border-radius: 4px; }
    .meta-label { color: #888; font-size: 11px; }
    .meta-value { font-size: 14px; }
    .charged { color: #f44336; }
    .free { color: #4CAF50; }
    .messages { background: #1a1a2e; padding: 10px; border-radius: 4px; max-height: 300px; overflow-y: auto; }
    .message { padding: 8px; margin: 5px 0; border-radius: 4px; background: #252540; }
    .message-role { font-weight: bold; margin-bottom: 5px; }
    .message-role.user { color: #4CAF50; }
    .message-role.assistant { color: #2196F3; }
    .message-content { font-size: 13px; white-space: pre-wrap; word-break: break-word; color: #ccc; }
    .tool-badge { display: inline-block; background: #ff9800; color: black; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 5px; }
    .system-preview { background: #1a1a2e; padding: 10px; border-radius: 4px; font-size: 12px; color: #888; max-height: 100px; overflow-y: auto; white-space: pre-wrap; }
    .tools-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .tool-name { background: #4a4a6a; padding: 2px 8px; border-radius: 3px; font-size: 11px; }
    .empty { text-align: center; color: #666; padding: 40px; }
  </style>
</head>
<body>
  <h1>Claude Pilot Logs</h1>
  <div class="controls">
    <button onclick="loadLogs()">Refresh</button>
    <button onclick="clearLogs()">Clear Logs</button>
    <div class="auto-refresh">
      <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
      <label for="autoRefresh">Auto-refresh (2s)</label>
    </div>
    <span id="status" style="color: #888; margin-left: auto;"></span>
  </div>
  <div id="entries" class="entries"><div class="empty">Loading...</div></div>
  <script>
    let autoRefreshInterval = null;
    let lastModified = null;
    async function loadLogs() {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        if (data.modified !== lastModified) {
          lastModified = data.modified;
          renderLogs(data.entries);
        }
        document.getElementById('status').textContent = 'Last update: ' + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById('status').textContent = 'Error loading logs';
      }
    }
    function renderLogs(entries) {
      const container = document.getElementById('entries');
      if (entries.length === 0) {
        container.innerHTML = '<div class="empty">No logs yet. Make a request through the proxy.</div>';
        return;
      }
      container.innerHTML = entries.reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        let html = '<div class="entry ' + entry.type + '">';
        html += '<div class="entry-header"><span class="entry-type">' + entry.type.toUpperCase() + '</span>';
        html += '<span class="entry-time">' + time + ' - ' + entry.requestId + '</span></div>';
        if (entry.type === 'request') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><div class="meta-label">Model</div><div class="meta-value">' + entry.model + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Mapped To</div><div class="meta-value">' + entry.mappedModel + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Messages</div><div class="meta-value">' + entry.messageCount + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Billing</div><div class="meta-value ' + (entry.charged ? 'charged' : 'free') + '">' + (entry.charged ? 'CHARGED' : 'FREE') + ' (' + entry.xInitiator + ')</div></div>';
          html += '</div>';
          if (entry.toolNames && entry.toolNames.length > 0) {
            html += '<div style="margin-bottom: 10px"><div class="meta-label">Tools Available</div><div class="tools-list">';
            entry.toolNames.slice(0, 10).forEach(t => { html += '<span class="tool-name">' + t + '</span>'; });
            if (entry.toolNames.length > 10) html += '<span class="tool-name">+' + (entry.toolNames.length - 10) + ' more</span>';
            html += '</div></div>';
          }
          if (entry.systemPreview) {
            html += '<div style="margin-bottom: 10px"><div class="meta-label">System Prompt (' + entry.systemLength + ' chars)</div>';
            html += '<div class="system-preview">' + escapeHtml(entry.systemPreview) + '</div></div>';
          }
          if (entry.messages && entry.messages.length > 0) {
            html += '<div class="meta-label">Messages</div><div class="messages">';
            entry.messages.forEach(msg => {
              html += '<div class="message"><div class="message-role ' + msg.role + '">' + msg.role;
              if (msg.hasToolUse) html += '<span class="tool-badge">tool_use</span>';
              if (msg.hasToolResult) html += '<span class="tool-badge">tool_result</span>';
              html += ' <span style="color:#666;font-weight:normal">(' + msg.contentLength + ' chars)</span></div>';
              html += '<div class="message-content">' + escapeHtml(msg.contentPreview || '(empty)') + '</div></div>';
            });
            html += '</div>';
          }
        } else if (entry.type === 'response') {
          html += '<div class="entry-meta"><div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">' + entry.statusCode + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Response Time</div><div class="meta-value">' + entry.responseTime + 'ms</div></div></div>';
        } else if (entry.type === 'error') {
          html += '<div class="entry-meta"><div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">' + entry.statusCode + '</div></div></div>';
          if (entry.error) html += '<div class="system-preview" style="color: #f44336;">' + escapeHtml(entry.error) + '</div>';
        }
        html += '</div>';
        return html;
      }).join('');
    }
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;
      await fetch('/api/logs', { method: 'DELETE' });
      lastModified = null;
      loadLogs();
    }
    function toggleAutoRefresh() {
      if (document.getElementById('autoRefresh').checked) {
        autoRefreshInterval = setInterval(loadLogs, 2000);
      } else {
        clearInterval(autoRefreshInterval);
      }
    }
    loadLogs();
  </script>
</body>
</html>`

export async function createProxyServer(options: ProxyServerOptions): Promise<ProxyServer> {
  const {
    credentials,
    port = 8080,
    host = '0.0.0.0',
    enableWebSearch = true,
    enableDashboard = true,
    logFullRequests = false,
    logger = false,
    logFile,
    authFile,
    log = async () => {},
    summarizeMessages = (msgs) =>
      msgs.map((m) => ({ role: m.role, contentPreview: '', contentLength: 0 })),
  } = options

  // Check Copilot CLI availability for web search
  let webSearchEnabled = enableWebSearch
  if (webSearchEnabled) {
    const copilotPath = process.env.COPILOT_PATH || 'copilot'
    const cliAvailable = await isCopilotCLIAvailable(copilotPath)
    if (!cliAvailable) {
      webSearchEnabled = false
    }
  }

  const fastify = Fastify({ logger })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }))

  // Dashboard routes (if enabled)
  if (enableDashboard && logFile) {
    fastify.get('/', async (_, reply) => {
      reply.header('Content-Type', 'text/html')
      return DASHBOARD_HTML
    })

    fastify.get('/api/logs', async () => {
      try {
        const fileStat = await stat(logFile)
        const content = await readFile(logFile, 'utf-8')
        const entries = content
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line)
            } catch {
              return null
            }
          })
          .filter(Boolean)
        return { modified: fileStat.mtimeMs, entries }
      } catch {
        return { modified: 0, entries: [] }
      }
    })

    fastify.delete('/api/logs', async () => {
      try {
        await writeFile(logFile, '')
        return { success: true }
      } catch {
        return { success: false }
      }
    })
  }

  // Main messages endpoint
  fastify.post('/v1/messages', async (request, reply) => {
    const requestId = request.id as string
    const startTime = Date.now()
    const anthropicRequest = request.body as AnthropicRequest

    // Handle web search execution requests
    if (webSearchEnabled) {
      const searchQuery = detectWebSearchRequest(anthropicRequest)
      if (searchQuery) {
        return handleWebSearchRequest(
          anthropicRequest,
          searchQuery,
          requestId,
          startTime,
          reply,
          fastify.log,
          log
        )
      }
    }

    // Route suggestion requests to free model
    if (isSuggestionRequest(anthropicRequest)) {
      return handleFreeModelRequest(
        anthropicRequest,
        credentials,
        requestId,
        startTime,
        reply,
        fastify.log,
        log,
        authFile,
        'suggestion'
      )
    }

    // Route sidecar requests (file tracking, title gen) to free model
    if (isSidecarRequest(anthropicRequest)) {
      return handleFreeModelRequest(
        anthropicRequest,
        credentials,
        requestId,
        startTime,
        reply,
        fastify.log,
        log,
        authFile,
        'sidecar'
      )
    }

    // Normal request - forward to Copilot
    return handleNormalRequest(
      anthropicRequest,
      credentials,
      requestId,
      startTime,
      reply,
      fastify.log,
      webSearchEnabled,
      logFullRequests,
      log,
      summarizeMessages,
      authFile
    )
  })

  // Token counting endpoint (stub - returns estimates)
  fastify.post('/v1/messages/count_tokens', async (request) => {
    const body = request.body as AnthropicRequest
    const charCount = estimateCharCount(body)
    return { input_tokens: Math.ceil(charCount / 4) }
  })

  return {
    fastify,
    port,
    start: async () => {
      await fastify.listen({ port, host })
    },
    stop: async () => {
      await fastify.close()
    },
  }
}

// Handle dedicated web search execution requests
async function handleWebSearchRequest(
  request: AnthropicRequest,
  searchQuery: string,
  requestId: string,
  startTime: number,
  reply: { header: (k: string, v: string) => void; send: (d: unknown) => unknown },
  logger: { info: (obj: object) => void; error: (obj: object) => void },
  log: (entry: Record<string, unknown>) => Promise<void>
) {
  logger.info({ msg: 'Executing web search request', query: searchQuery })

  try {
    const searchResult = await executeWebSearch(searchQuery)
    const formattedResult = formatAsToolResult(searchResult)

    logger.info({
      msg: 'Web search completed',
      query: searchQuery,
      sourceCount: searchResult.sources.length,
    })

    await log({
      timestamp: new Date().toISOString(),
      requestId,
      type: 'request',
      webSearch: true,
      query: searchQuery,
      sourceCount: searchResult.sources.length,
      responseTime: Date.now() - startTime,
    })

    const messageId = `msg_search_${requestId}`

    if (request.stream) {
      setStreamingHeaders(reply)
      return reply.send(
        buildWebSearchStreamingResponse(
          messageId,
          request.model,
          searchQuery,
          searchResult,
          formattedResult
        )
      )
    }

    return buildWebSearchNonStreamingResponse(
      messageId,
      request.model,
      searchQuery,
      searchResult,
      formattedResult
    )
  } catch (error) {
    logger.error({ msg: 'Web search failed', error: String(error) })
    const messageId = `msg_error_${requestId}`
    if (request.stream) {
      setStreamingHeaders(reply)
      return reply.send(buildEmptyStreamingResponse(messageId, request.model))
    }
    return buildEmptyNonStreamingResponse(messageId, request.model)
  }
}

// Handle requests that should be routed to free model (suggestions, sidecars)
async function handleFreeModelRequest(
  request: AnthropicRequest,
  credentials: StoredCredentials,
  requestId: string,
  startTime: number,
  reply: {
    header: (k: string, v: string) => void
    send: (d: unknown) => unknown
    code: (c: number) => void
  },
  logger: { info: (obj: object) => void; error: (obj: object) => void },
  log: (entry: Record<string, unknown>) => Promise<void>,
  authFile?: string,
  requestType: 'suggestion' | 'sidecar' = 'suggestion'
) {
  logger.info({ msg: `${requestType} request - routing to free model`, model: FREE_MODEL })

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'request',
    [requestType]: true,
    model: request.model,
    routedModel: FREE_MODEL,
  })

  const openaiRequest = transformRequest(request)
  // Override model to free model
  openaiRequest.model = FREE_MODEL

  const copilotToken = await getValidCopilotToken(credentials, authFile)
  const isVisionRequest = hasImageContent(request)

  const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      ...COPILOT_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${copilotToken}`,
      'X-Initiator': 'agent', // Free model requests don't need billing
      ...(isVisionRequest && { 'Copilot-Vision-Request': 'true' }),
    },
    body: JSON.stringify(openaiRequest),
  })

  if (!response.ok) {
    return handleCopilotError(response, requestId, startTime, reply, logger, log)
  }

  if (request.stream) {
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    const estimatedTokens = estimateInputTokens(request)
    const transformed = response.body!.pipeThrough(
      createStreamTransformer(FREE_MODEL, estimatedTokens)
    )
    return reply.send(transformed)
  }

  // Non-streaming
  const data = (await response.json()) as OpenAIResponse
  const anthropicResponse = transformResponse(data)

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'response',
    statusCode: 200,
    responseTime: Date.now() - startTime,
    [requestType]: true,
  })

  return anthropicResponse
}

// Handle normal requests - forward to Copilot
async function handleNormalRequest(
  request: AnthropicRequest,
  credentials: StoredCredentials,
  requestId: string,
  startTime: number,
  reply: {
    header: (k: string, v: string) => void
    send: (d: unknown) => unknown
    code: (c: number) => void
  },
  logger: { info: (obj: object) => void; error: (obj: object) => void },
  webSearchEnabled: boolean,
  logFullRequests: boolean,
  log: (entry: Record<string, unknown>) => Promise<void>,
  summarizeMessages: (messages: Array<{ role: string; content: unknown }>) => Array<{
    role: string
    contentPreview: string
    contentLength: number
    hasToolUse?: boolean
    hasToolResult?: boolean
  }>,
  authFile?: string
) {
  // Add web_search tool if not present
  let requestWithTools = request
  if (webSearchEnabled) {
    const hasWebSearch = request.tools?.some((t) => t.name === 'web_search')
    if (!hasWebSearch) {
      requestWithTools = { ...request, tools: [...(request.tools || []), WEB_SEARCH_TOOL] }
    }
  }

  const xInitiator = getXInitiator(requestWithTools)
  const mappedModel = mapModel(requestWithTools.model)
  const isSuggestion = isSuggestionRequest(requestWithTools)

  const systemText = getSystemText(requestWithTools)
  const systemPreview = systemText.slice(0, 500) + (systemText.length > 500 ? '...' : '')

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'request',
    model: requestWithTools.model,
    mappedModel,
    messageCount: requestWithTools.messages.length,
    stream: requestWithTools.stream,
    hasTools: !!requestWithTools.tools?.length,
    toolNames: requestWithTools.tools?.map((t) => t.name),
    xInitiator,
    charged: !isSuggestion && xInitiator === 'user',
    messages: summarizeMessages(requestWithTools.messages),
    systemPreview,
    systemLength: systemText.length,
    ...(logFullRequests && { fullRequest: requestWithTools }),
  })

  logger.info({
    msg: 'Incoming request',
    model: requestWithTools.model,
    mappedModel,
    messageCount: requestWithTools.messages.length,
    stream: requestWithTools.stream,
    hasTools: !!requestWithTools.tools?.length,
  })
  logger.info({ msg: 'Billing', xInitiator, charged: !isSuggestion && xInitiator === 'user' })

  const openaiRequest = transformRequest(requestWithTools)
  const copilotToken = await getValidCopilotToken(credentials, authFile)

  const isVisionRequest = hasImageContent(requestWithTools)
  const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      ...COPILOT_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${copilotToken}`,
      'X-Initiator': xInitiator,
      ...(isVisionRequest && { 'Copilot-Vision-Request': 'true' }),
    },
    body: JSON.stringify(openaiRequest),
  })

  if (!response.ok) {
    return handleCopilotError(response, requestId, startTime, reply, logger, log)
  }

  if (requestWithTools.stream) {
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    const rawChunks: string[] = []
    const captureStream = new TransformStream({
      transform(chunk, controller) {
        rawChunks.push(new TextDecoder().decode(chunk))
        controller.enqueue(chunk)
      },
      async flush() {
        await log({
          timestamp: new Date().toISOString(),
          requestId,
          type: 'response',
          statusCode: 200,
          responseTime: Date.now() - startTime,
          rawCopilotResponse: logFullRequests
            ? rawChunks.join('')
            : rawChunks.join('').slice(0, 2000),
        })
      },
    })

    const estimatedTokens = estimateInputTokens(requestWithTools)
    const transformed = response
      .body!.pipeThrough(captureStream)
      .pipeThrough(createStreamTransformer(openaiRequest.model, estimatedTokens))
    return reply.send(transformed)
  }

  const openaiResponse = (await response.json()) as OpenAIResponse

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'response',
    statusCode: 200,
    responseTime: Date.now() - startTime,
    ...(logFullRequests && { fullResponse: openaiResponse }),
  })

  logger.info({
    msg: 'Copilot response',
    model: openaiResponse.model,
    finishReason: openaiResponse.choices[0]?.finish_reason,
    usage: openaiResponse.usage,
  })

  return transformResponse(openaiResponse)
}

async function handleCopilotError(
  response: Response,
  requestId: string,
  startTime: number,
  reply: { code: (c: number) => void },
  logger: { error: (obj: object) => void },
  log: (entry: Record<string, unknown>) => Promise<void>
) {
  const errorText = await response.text()

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'error',
    statusCode: response.status,
    responseTime: Date.now() - startTime,
    error: errorText,
  })

  logger.error({
    msg: 'Copilot API error',
    status: response.status,
    statusText: response.statusText,
    body: errorText,
  })

  reply.code(response.status)
  return {
    type: 'error',
    error: {
      type: 'api_error',
      message: `Copilot API error: ${response.status} ${response.statusText} - ${errorText}`,
    },
  }
}

function estimateCharCount(body: AnthropicRequest): number {
  let charCount = 0
  if (body.system) {
    charCount +=
      typeof body.system === 'string'
        ? body.system.length
        : body.system.reduce((sum, b) => sum + b.text.length, 0)
  }
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      charCount += msg.content.length
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') charCount += block.text.length
      }
    }
  }
  return charCount
}
