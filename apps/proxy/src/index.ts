// Claude Proxy - Main entry point

import Fastify from 'fastify'
import { loadCredentials, getValidCopilotToken } from './auth/storage.js'
import { transformRequest, mapModel, WEB_SEARCH_TOOL } from './transform/request.js'
import { transformResponse } from './transform/response.js'
import { createStreamTransformer } from './transform/streaming.js'
import { executeWebSearch, formatAsToolResult } from './services/webSearch.js'
import { isCopilotCLIAvailable } from './utils/validation.js'
import { detectWebSearchRequest, isSuggestionRequest, getXInitiator, getSystemText, hasImageContent } from './utils/detection.js'
import { buildEmptyStreamingResponse, buildEmptyNonStreamingResponse, setStreamingHeaders } from './utils/sse.js'
import {
  buildWebSearchStreamingResponse,
  buildWebSearchNonStreamingResponse,
} from './handlers/webSearchResponse.js'
import { COPILOT_API_URL, COPILOT_HEADERS, DEFAULT_PORT } from './constants.js'
import { log, summarizeMessages, getLogFilePath } from '@claude-pilot/shared/logger'
import type { AnthropicRequest } from './types/anthropic.js'
import type { OpenAIResponse } from './types/openai.js'

const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10)
const LOG_FULL_REQUESTS = process.env.LOG_FULL_REQUESTS === 'true'
const ENABLE_WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== 'false'

async function main() {
  // Load credentials
  const credentials = await loadCredentials()
  if (!credentials) {
    console.error('No credentials found. Run `pnpm auth` first to authenticate.')
    process.exit(1)
  }
  console.log('Loaded credentials from ~/.config/claude-proxy/auth.json')
  console.log(`Logging to: ${getLogFilePath()}`)

  // Check Copilot CLI availability for web search
  let webSearchEnabled = ENABLE_WEB_SEARCH
  if (webSearchEnabled) {
    const copilotPath = process.env.COPILOT_PATH || 'copilot'
    const cliAvailable = await isCopilotCLIAvailable(copilotPath)
    if (!cliAvailable) {
      console.warn(`Copilot CLI not found at '${copilotPath}' - web search disabled`)
      webSearchEnabled = false
    } else {
      console.log('Web search: enabled (via Copilot CLI)')
    }
  } else {
    console.log('Web search: disabled')
  }

  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }))

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
          fastify.log
        )
      }
    }

    // Block suggestion requests to save costs
    if (isSuggestionRequest(anthropicRequest)) {
      return handleSuggestionRequest(anthropicRequest, requestId, startTime, reply, fastify.log)
    }

    // Normal request - forward to Copilot
    return handleNormalRequest(
      anthropicRequest,
      credentials,
      requestId,
      startTime,
      reply,
      fastify.log
    )
  })

  // Token counting endpoint (stub - returns estimates)
  fastify.post('/v1/messages/count_tokens', async (request) => {
    const body = request.body as AnthropicRequest
    const charCount = estimateCharCount(body)
    return { input_tokens: Math.ceil(charCount / 4) }
  })

  // Start server
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`\nClaude Proxy running on http://localhost:${PORT}`)
    console.log(`\nConfigure Claude Code with:`)
    console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${PORT}`)
    console.log(`  export ANTHROPIC_AUTH_TOKEN=dummy`)
    console.log(`\nView logs:`)
    console.log(`  pnpm logs`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

// Handle dedicated web search execution requests
async function handleWebSearchRequest(
  request: AnthropicRequest,
  searchQuery: string,
  requestId: string,
  startTime: number,
  reply: { header: (k: string, v: string) => void; send: (d: unknown) => unknown },
  logger: { info: (obj: object) => void; error: (obj: object) => void }
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
    } as Parameters<typeof log>[0])

    const messageId = `msg_search_${requestId}`

    if (request.stream) {
      setStreamingHeaders(reply)

      const response = buildWebSearchStreamingResponse(
        messageId,
        request.model,
        searchQuery,
        searchResult,
        formattedResult
      )
      return reply.send(response)
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
    // Return empty response on error
    const messageId = `msg_error_${requestId}`
    if (request.stream) {
      setStreamingHeaders(reply)
      return reply.send(buildEmptyStreamingResponse(messageId, request.model))
    }
    return buildEmptyNonStreamingResponse(messageId, request.model)
  }
}

// Handle suggestion requests (blocked to save costs)
async function handleSuggestionRequest(
  request: AnthropicRequest,
  requestId: string,
  startTime: number,
  reply: { header: (k: string, v: string) => void; send: (d: unknown) => unknown },
  logger: { info: (obj: object) => void }
) {
  logger.info({ msg: 'Blocking suggestion request - returning empty response' })

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'response',
    statusCode: 200,
    responseTime: Date.now() - startTime,
    blocked: true,
    reason: 'suggestion',
  })

  const messageId = `msg_blocked_${requestId}`

  if (request.stream) {
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    return reply.send(buildEmptyStreamingResponse(messageId, request.model))
  }

  return buildEmptyNonStreamingResponse(messageId, request.model)
}

// Handle normal requests - forward to Copilot
async function handleNormalRequest(
  request: AnthropicRequest,
  credentials: Awaited<ReturnType<typeof loadCredentials>>,
  requestId: string,
  startTime: number,
  reply: { header: (k: string, v: string) => void; send: (d: unknown) => unknown; code: (c: number) => void },
  logger: { info: (obj: object) => void; error: (obj: object) => void }
) {
  // Add web_search tool if not present
  let requestWithTools = request
  if (process.env.ENABLE_WEB_SEARCH !== 'false') {
    const hasWebSearch = request.tools?.some((t) => t.name === 'web_search')
    if (!hasWebSearch) {
      requestWithTools = {
        ...request,
        tools: [...(request.tools || []), WEB_SEARCH_TOOL],
      }
    }
  }

  const xInitiator = getXInitiator(requestWithTools)
  const mappedModel = mapModel(requestWithTools.model)
  const isSuggestion = isSuggestionRequest(requestWithTools)

  // Get system prompt preview for logging
  const systemText = getSystemText(requestWithTools)
  const systemPreview = systemText.slice(0, 500) + (systemText.length > 500 ? '...' : '')

  // Log request
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
    ...(LOG_FULL_REQUESTS && { fullRequest: requestWithTools }),
  })

  logger.info({
    msg: 'Incoming request',
    model: requestWithTools.model,
    mappedModel,
    messageCount: requestWithTools.messages.length,
    stream: requestWithTools.stream,
    hasTools: !!requestWithTools.tools?.length,
  })
  logger.info({
    msg: 'Billing',
    xInitiator,
    charged: !isSuggestion && xInitiator === 'user',
  })

  // Transform and forward to Copilot
  const openaiRequest = transformRequest(requestWithTools)
  const copilotToken = await getValidCopilotToken(credentials!)
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
    return handleCopilotError(response, requestId, startTime, reply, logger)
  }

  // Handle streaming response
  if (requestWithTools.stream) {
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    const rawChunks: string[] = []
    const captureStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        rawChunks.push(text)
        controller.enqueue(chunk)
      },
      async flush() {
        const rawResponse = rawChunks.join('')
        await log({
          timestamp: new Date().toISOString(),
          requestId,
          type: 'response',
          statusCode: 200,
          responseTime: Date.now() - startTime,
          rawCopilotResponse: LOG_FULL_REQUESTS ? rawResponse : rawResponse.slice(0, 2000),
        })
      },
    })

    const transformed = response
      .body!.pipeThrough(captureStream)
      .pipeThrough(createStreamTransformer(openaiRequest.model))

    return reply.send(transformed)
  }

  // Handle non-streaming response
  const openaiResponse = (await response.json()) as OpenAIResponse

  await log({
    timestamp: new Date().toISOString(),
    requestId,
    type: 'response',
    statusCode: 200,
    responseTime: Date.now() - startTime,
    ...(LOG_FULL_REQUESTS && { fullResponse: openaiResponse }),
  })

  logger.info({
    msg: 'Copilot response',
    model: openaiResponse.model,
    finishReason: openaiResponse.choices[0]?.finish_reason,
    usage: openaiResponse.usage,
  })

  return transformResponse(openaiResponse)
}

// Handle Copilot API errors
async function handleCopilotError(
  response: Response,
  requestId: string,
  startTime: number,
  reply: { code: (c: number) => void },
  logger: { error: (obj: object) => void }
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

// Estimate character count for token counting
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
        if (block.type === 'text') {
          charCount += block.text.length
        }
      }
    }
  }

  return charCount
}

main()
