// Server entry point - spawned as background process by the CLI
// This file imports the proxy factory and starts the server

import { mkdir, appendFile } from 'node:fs/promises'
import { createProxyServer, loadCredentials } from '@claude-pilot/proxy'
import { CONFIG_DIR, AUTH_FILE, REQUEST_LOG_FILE } from './config.js'

const PORT = parseInt(process.env.PROXY_PORT || '51080', 10)
const LOG_FULL_REQUESTS = process.env.LOG_FULL_REQUESTS === 'true'

type AnthropicMessage = {
  role: string
  content: unknown
}

type AnthropicContentBlock = {
  type: string
  text?: string
}

function summarizeMessages(messages: AnthropicMessage[]) {
  return messages.map((msg) => {
    let contentPreview = ''
    let contentLength = 0
    let hasToolUse = false
    let hasToolResult = false

    if (typeof msg.content === 'string') {
      contentPreview = msg.content.slice(0, 200)
      contentLength = msg.content.length
    } else if (Array.isArray(msg.content)) {
      const content = msg.content as AnthropicContentBlock[]
      hasToolUse = content.some((b) => b.type === 'tool_use')
      hasToolResult = content.some((b) => b.type === 'tool_result')
      const textBlocks = content.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text'
      )
      contentPreview = textBlocks
        .map((b) => b.text.slice(0, 100))
        .join(' ')
        .slice(0, 200)
      contentLength = JSON.stringify(msg.content).length
    }

    return {
      role: msg.role,
      contentPreview: contentPreview + (contentPreview.length >= 200 ? '...' : ''),
      contentLength,
      ...(hasToolUse && { hasToolUse }),
      ...(hasToolResult && { hasToolResult }),
    }
  })
}

async function log(entry: Record<string, unknown>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  const line = JSON.stringify(entry) + '\n'
  await appendFile(REQUEST_LOG_FILE, line)
}

async function main() {
  // Load credentials
  const credentials = await loadCredentials(AUTH_FILE)
  if (!credentials) {
    console.error('No credentials found. Run `claude-pilot login` first.')
    process.exit(1)
  }
  console.log(`Loaded credentials from ${AUTH_FILE}`)
  console.log(`Logging to: ${REQUEST_LOG_FILE}`)

  // Create and start the proxy server
  const server = await createProxyServer({
    credentials,
    port: PORT,
    enableWebSearch: true,
    enableDashboard: true,
    logFullRequests: LOG_FULL_REQUESTS,
    logFile: REQUEST_LOG_FILE,
    authFile: AUTH_FILE,
    log,
    summarizeMessages,
    logger: { level: 'info' },
  })

  await server.start()
  console.log(`\nProxy + Dashboard running on http://localhost:${PORT}`)
  console.log(`  Dashboard: http://localhost:${PORT}/`)
  console.log(`  API: http://localhost:${PORT}/v1/messages`)
  console.log(`\nConfigure Claude Code with:`)
  console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${PORT}`)
  console.log(`  export ANTHROPIC_AUTH_TOKEN=dummy`)
}

main()
