// JSONL file logger for request/response inspection

import { appendFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Find workspace root by looking for turbo.json
function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== '/') {
    if (existsSync(join(dir, 'turbo.json')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return process.cwd()
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const LOG_DIR = join(WORKSPACE_ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, 'requests.jsonl')

export type LogEntry = {
  timestamp: string
  requestId: string
  type: 'request' | 'response' | 'error'
  // Request info
  model?: string
  mappedModel?: string
  messageCount?: number
  stream?: boolean
  hasTools?: boolean
  toolNames?: string[]
  xInitiator?: string
  charged?: boolean
  isSuggestion?: boolean
  // Web search info
  webSearch?: boolean
  query?: string
  sourceCount?: number
  // Suggestion blocking
  blocked?: boolean
  reason?: string
  // Messages summary
  messages?: Array<{
    role: string
    contentPreview: string
    contentLength: number
    hasToolUse?: boolean
    hasToolResult?: boolean
  }>
  // System prompt
  systemPreview?: string
  systemLength?: number
  // Response info
  statusCode?: number
  responseTime?: number
  error?: string
  rawCopilotResponse?: string
  // Full data for debugging (optional, can be large)
  fullRequest?: unknown
  fullResponse?: unknown
}

let initialized = false

async function ensureLogDir() {
  if (!initialized) {
    await mkdir(LOG_DIR, { recursive: true })
    initialized = true
  }
}

export async function log(entry: LogEntry) {
  await ensureLogDir()
  const line = JSON.stringify(entry) + '\n'
  await appendFile(LOG_FILE, line)
}

export function getLogFilePath() {
  return LOG_FILE
}

// Helper to summarize messages for logging
export function summarizeMessages(messages: Array<{ role: string; content: unknown }>) {
  return messages.map((msg) => {
    let contentPreview = ''
    let contentLength = 0
    let hasToolUse = false
    let hasToolResult = false

    if (typeof msg.content === 'string') {
      contentPreview = msg.content.slice(0, 200)
      contentLength = msg.content.length
    } else if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type: string; text?: string }>
      hasToolUse = blocks.some((b) => b.type === 'tool_use')
      hasToolResult = blocks.some((b) => b.type === 'tool_result')

      const textBlocks = blocks.filter((b) => b.type === 'text' && b.text)
      contentPreview = textBlocks
        .map((b) => b.text?.slice(0, 100))
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
