// Request detection utilities

import type { AnthropicRequest } from '../types/anthropic.js'
import {
  WEB_SEARCH_SYSTEM_PATTERN,
  WEB_SEARCH_MESSAGE_PATTERN,
  SUGGESTION_MODE_PATTERN,
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
 * Determine the X-Initiator header value based on the last message role
 */
export function getXInitiator(request: AnthropicRequest): 'user' | 'agent' {
  const lastMessage = request.messages[request.messages.length - 1]
  return lastMessage?.role === 'user' ? 'user' : 'agent'
}
