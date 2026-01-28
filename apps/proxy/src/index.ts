// Claude Proxy - Main entry point

import Fastify from 'fastify'
import { loadCredentials, getValidCopilotToken } from './auth/storage.js'
import { transformRequest, mapModel } from './transform/request.js'
import { transformResponse } from './transform/response.js'
import { createStreamTransformer } from './transform/streaming.js'
import { log, summarizeMessages, getLogFilePath } from '@claude-proxy/shared/logger'
import type { AnthropicRequest } from './types/anthropic.js'
import type { OpenAIResponse } from './types/openai.js'

const COPILOT_API_URL = 'https://api.githubcopilot.com'
const PORT = parseInt(process.env.PORT || '8080', 10)
const LOG_FULL_REQUESTS = process.env.LOG_FULL_REQUESTS === 'true'

// Required headers for Copilot API
const COPILOT_HEADERS = {
  'editor-version': 'vscode/1.95.0',
  'editor-plugin-version': 'copilot-chat/0.22.4',
  'Openai-Intent': 'conversation-edits',
}

async function main() {
  // Load credentials
  const credentials = await loadCredentials()
  if (!credentials) {
    console.error('No credentials found. Run `pnpm auth` first to authenticate.')
    process.exit(1)
  }

  console.log('Loaded credentials from ~/.config/claude-proxy/auth.json')
  console.log(`Logging to: ${getLogFilePath()}`)

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

    // Determine X-Initiator header based on last message role
    const lastMessage = anthropicRequest.messages[anthropicRequest.messages.length - 1]
    const xInitiator = lastMessage?.role === 'user' ? 'user' : 'agent'
    const mappedModel = mapModel(anthropicRequest.model)

    // Get system prompt preview
    let systemPreview = ''
    let systemLength = 0
    if (anthropicRequest.system) {
      const systemText = typeof anthropicRequest.system === 'string'
        ? anthropicRequest.system
        : anthropicRequest.system.map((b) => b.text).join('\n')
      systemPreview = systemText.slice(0, 500) + (systemText.length > 500 ? '...' : '')
      systemLength = systemText.length
    }

    // Log to file
    await log({
      timestamp: new Date().toISOString(),
      requestId,
      type: 'request',
      model: anthropicRequest.model,
      mappedModel,
      messageCount: anthropicRequest.messages.length,
      stream: anthropicRequest.stream,
      hasTools: !!anthropicRequest.tools?.length,
      toolNames: anthropicRequest.tools?.map((t) => t.name),
      xInitiator,
      charged: xInitiator === 'user',
      messages: summarizeMessages(anthropicRequest.messages),
      systemPreview,
      systemLength,
      ...(LOG_FULL_REQUESTS && { fullRequest: anthropicRequest }),
    })

    // Console log
    fastify.log.info({
      msg: 'Incoming request',
      model: anthropicRequest.model,
      mappedModel,
      messageCount: anthropicRequest.messages.length,
      stream: anthropicRequest.stream,
      hasTools: !!anthropicRequest.tools?.length,
    })
    fastify.log.info({ msg: 'Billing', xInitiator, charged: xInitiator === 'user' })

    // Transform request
    const openaiRequest = transformRequest(anthropicRequest)

    // Get valid Copilot token (auto-refreshes if needed)
    const copilotToken = await getValidCopilotToken(credentials)

    // Make request to Copilot
    const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        ...COPILOT_HEADERS,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${copilotToken}`,
        'X-Initiator': xInitiator,
      },
      body: JSON.stringify(openaiRequest),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const responseTime = Date.now() - startTime

      await log({
        timestamp: new Date().toISOString(),
        requestId,
        type: 'error',
        statusCode: response.status,
        responseTime,
        error: errorText,
      })

      fastify.log.error({
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

    // Handle streaming response
    if (anthropicRequest.stream) {
      reply.header('Content-Type', 'text/event-stream')
      reply.header('Cache-Control', 'no-cache')
      reply.header('Connection', 'keep-alive')

      // Log streaming response start
      await log({
        timestamp: new Date().toISOString(),
        requestId,
        type: 'response',
        statusCode: 200,
        responseTime: Date.now() - startTime,
      })

      // Pipe: Copilot response → transformer → client
      const transformed = response.body!.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk)
          },
        })
      ).pipeThrough(createStreamTransformer(openaiRequest.model))

      return reply.send(transformed)
    }

    // Handle non-streaming response
    const openaiResponse = (await response.json()) as OpenAIResponse
    const responseTime = Date.now() - startTime

    await log({
      timestamp: new Date().toISOString(),
      requestId,
      type: 'response',
      statusCode: 200,
      responseTime,
      ...(LOG_FULL_REQUESTS && { fullResponse: openaiResponse }),
    })

    fastify.log.info({
      msg: 'Copilot response',
      model: openaiResponse.model,
      finishReason: openaiResponse.choices[0]?.finish_reason,
      usage: openaiResponse.usage,
    })

    const anthropicResponse = transformResponse(openaiResponse)

    return anthropicResponse
  })

  // Token counting endpoint (stub - returns estimates)
  fastify.post('/v1/messages/count_tokens', async (request) => {
    const body = request.body as AnthropicRequest

    // Simple estimation: ~4 characters per token
    let charCount = 0

    if (body.system) {
      charCount += typeof body.system === 'string'
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

    return {
      input_tokens: Math.ceil(charCount / 4),
    }
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

main()
