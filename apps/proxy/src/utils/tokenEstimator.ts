// Simple token estimation for Anthropic requests
// Used to provide input_tokens in message_start before we have actual usage from OpenAI

import type { AnthropicRequest } from '../types/anthropic.js'

/**
 * Rough token estimation using character count
 * Claude models average ~3.5-4 characters per token
 * We use 4 for a conservative estimate
 */
function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate input tokens from an Anthropic request
 * This is a rough estimate for the message_start event
 */
export function estimateInputTokens(request: AnthropicRequest): number {
  let totalChars = 0

  // Count system prompt
  if (request.system) {
    if (typeof request.system === 'string') {
      totalChars += request.system.length
    } else if (Array.isArray(request.system)) {
      for (const block of request.system) {
        if (block.type === 'text') {
          totalChars += block.text.length
        }
      }
    }
  }

  // Count messages
  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      totalChars += message.content.length
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          totalChars += block.text.length
        } else if (block.type === 'tool_use') {
          totalChars += JSON.stringify(block.input || {}).length
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            totalChars += block.content.length
          } else if (Array.isArray(block.content)) {
            for (const b of block.content) {
              if (b.type === 'text') {
                totalChars += b.text.length
              }
            }
          }
        }
      }
    }
  }

  // Count tool definitions
  if (request.tools) {
    totalChars += JSON.stringify(request.tools).length
  }

  return Math.ceil(totalChars / 4)
}
