// Request detection utilities

import type { AnthropicRequest } from '../types/anthropic.js'
import {
  WEB_SEARCH_SYSTEM_PATTERN,
  WEB_SEARCH_MESSAGE_PATTERN,
  SUGGESTION_MODE_PATTERN,
  SIDECAR_PATTERNS,
  SUBAGENT_PATTERNS,
} from '../constants.js'

/**
 * Extract system prompt text from request
 */
export function getSystemText(request: AnthropicRequest): string {
  if (!request.system) return ''
  return typeof request.system === 'string'
    ? request.system
    : request.system.map((b) => b.text).join('')
}

/**
 * Extract text content from a message
 */
export function getMessageText(
  message: AnthropicRequest['messages'][0]
): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/**
 * Detect if this is a dedicated web search execution request from Claude Code.
 * Returns the search query if detected, null otherwise.
 */
export function detectWebSearchRequest(
  request: AnthropicRequest
): string | null {
  const systemText = getSystemText(request)

  if (!systemText.includes(WEB_SEARCH_SYSTEM_PATTERN)) {
    return null
  }

  // Web search requests have exactly one message
  if (request.messages.length !== 1) {
    return null
  }

  const messageText = getMessageText(request.messages[0])
  const match = messageText.match(WEB_SEARCH_MESSAGE_PATTERN)

  return match ? match[1].trim() : null
}

/**
 * Detect if this is a suggestion request (should be blocked to save costs)
 */
export function isSuggestionRequest(request: AnthropicRequest): boolean {
  const lastMessage = request.messages[request.messages.length - 1]
  if (!lastMessage) return false

  const messageText = getMessageText(lastMessage)
  return messageText.includes(SUGGESTION_MODE_PATTERN)
}

/**
 * Check if a message contains a tool_result block
 */
function hasToolResult(message: AnthropicRequest['messages'][0]): boolean {
  if (typeof message.content === 'string') return false
  return message.content.some((block) => block.type === 'tool_result')
}

/**
 * Check if request is a sidecar utility call (file tracking, title gen, etc.)
 * These are synthetic requests spawned by Claude Code, not direct user prompts.
 */
export function isSidecarRequest(request: AnthropicRequest): boolean {
  const systemText = getSystemText(request)
  return SIDECAR_PATTERNS.some((pattern) => systemText.includes(pattern))
}

/**
 * Check if request is a subagent (Explore, etc.)
 * These are synthetic requests spawned by Claude Code, not direct user prompts.
 */
export function isSubagentRequest(request: AnthropicRequest): boolean {
  const systemText = getSystemText(request)
  return SUBAGENT_PATTERNS.some((pattern) => systemText.includes(pattern))
}

/**
 * Determine the X-Initiator header value based on request type.
 * - 'user': Direct user prompt (charged ~$0.04)
 * - 'agent': Tool result or subagent (free)
 *
 * Per GitHub docs: "Only the prompts you enter are billed—tool calls or
 * background steps taken by the agent are not charged."
 *
 * Note: Sidecars are routed to free models (gpt-5-mini), so X-Initiator
 * doesn't matter for them.
 */
export function getXInitiator(request: AnthropicRequest): 'user' | 'agent' {
  // Subagents are agent-initiated (not direct user prompts)
  if (isSubagentRequest(request)) {
    return 'agent'
  }

  const lastMessage = request.messages[request.messages.length - 1]
  if (!lastMessage) return 'user'

  // Tool results are sent with role='user' but are agent continuations (free)
  if (lastMessage.role === 'user' && hasToolResult(lastMessage)) {
    return 'agent'
  }

  return lastMessage.role === 'user' ? 'user' : 'agent'
}
