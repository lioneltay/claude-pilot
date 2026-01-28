// Anthropic Passthrough Proxy - Spy on real API traffic

import Fastify from 'fastify'
import { appendFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ANTHROPIC_API_URL = 'https://api.anthropic.com'
const PORT = parseInt(process.env.SPY_PORT || '8082', 10)

// Find workspace root
function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== '/') {
    if (existsSync(join(dir, 'turbo.json'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const LOG_FILE = join(WORKSPACE_ROOT, 'logs', 'spy.jsonl')

async function logEntry(entry: Record<string, unknown>) {
  await mkdir(dirname(LOG_FILE), { recursive: true })
  await appendFile(LOG_FILE, JSON.stringify(entry) + '\n')
}

async function main() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  })

  // Register JSON body parsing
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = body ? JSON.parse(body as string) : undefined
      done(null, json)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  console.log(`Spy Proxy - Forwarding to ${ANTHROPIC_API_URL}`)
  console.log(`Logging to: ${LOG_FILE}`)

  // Catch-all route to forward everything to Anthropic
  fastify.all('/*', async (request, reply) => {
    const requestId = request.id as string
    const startTime = Date.now()
    const path = request.url
    const method = request.method

    // Log request
    const requestBody = request.body as Record<string, unknown> | undefined
    await logEntry({
      timestamp: new Date().toISOString(),
      requestId,
      type: 'request',
      method,
      path,
      headers: {
        'content-type': request.headers['content-type'],
        'anthropic-version': request.headers['anthropic-version'],
        'anthropic-beta': request.headers['anthropic-beta'],
      },
      body: requestBody,
    })

    fastify.log.info({ msg: 'Forwarding request', method, path })

    // Build headers for Anthropic
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Copy relevant headers
    if (request.headers['anthropic-version']) {
      headers['anthropic-version'] = request.headers['anthropic-version'] as string
    }
    if (request.headers['anthropic-beta']) {
      headers['anthropic-beta'] = request.headers['anthropic-beta'] as string
    }
    if (request.headers['authorization']) {
      headers['authorization'] = request.headers['authorization'] as string
    }
    if (request.headers['x-api-key']) {
      headers['x-api-key'] = request.headers['x-api-key'] as string
    }

    // Forward to Anthropic
    const response = await fetch(`${ANTHROPIC_API_URL}${path}`, {
      method,
      headers,
      body: method !== 'GET' && requestBody ? JSON.stringify(requestBody) : undefined,
    })

    const responseTime = Date.now() - startTime

    // Check if streaming
    const isStreaming = requestBody?.stream === true

    if (isStreaming && response.ok && response.body) {
      // Handle streaming response - capture and forward
      reply.header('Content-Type', 'text/event-stream')
      reply.header('Cache-Control', 'no-cache')
      reply.header('Connection', 'keep-alive')

      const chunks: string[] = []
      const transformStream = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk)
          chunks.push(text)
          controller.enqueue(chunk)
        },
        async flush() {
          // Log complete response when stream ends
          await logEntry({
            timestamp: new Date().toISOString(),
            requestId,
            type: 'response',
            statusCode: response.status,
            responseTime,
            streaming: true,
            rawResponse: chunks.join(''),
          })
        },
      })

      const piped = response.body.pipeThrough(transformStream)
      return reply.send(piped)
    }

    // Non-streaming response
    const responseBody = await response.text()

    await logEntry({
      timestamp: new Date().toISOString(),
      requestId,
      type: 'response',
      statusCode: response.status,
      responseTime,
      streaming: false,
      rawResponse: responseBody,
    })

    // Copy response headers
    reply.code(response.status)
    reply.header('Content-Type', response.headers.get('content-type') || 'application/json')

    return reply.send(responseBody)
  })

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\nSpy Proxy running on http://localhost:${PORT}`)
  console.log(`\nTo use with Claude Code:`)
  console.log(`  ANTHROPIC_BASE_URL=http://localhost:${PORT} claude`)
}

main()
