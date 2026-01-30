// Token counting using tiktoken (cl100k_base)
// Note: This is an approximation - Claude uses its own tokenizer
// but cl100k_base is reasonably close for estimation purposes

import { getEncoding } from 'js-tiktoken'
import type { AnthropicRequest } from '../types/anthropic.js'

// Use cl100k_base (GPT-4 tokenizer) as approximation for Claude
const encoding = getEncoding('cl100k_base')

export function countTokens(text: string): number {
  return encoding.encode(text).length
}

export function countRequestTokens(request: AnthropicRequest): number {
  let tokens = 0

  // Count system prompt
  if (request.system) {
    if (typeof request.system === 'string') {
      tokens += countTokens(request.system)
    } else {
      for (const block of request.system) {
        tokens += countTokens(block.text)
      }
    }
  }

  // Count messages
  for (const msg of request.messages) {
    // Add overhead for message structure (role, etc.)
    tokens += 4 // Approximate overhead per message

    if (typeof msg.content === 'string') {
      tokens += countTokens(msg.content)
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          tokens += countTokens(block.text)
        } else if (block.type === 'tool_use') {
          tokens += countTokens(block.name)
          tokens += countTokens(JSON.stringify(block.input))
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            tokens += countTokens(block.content)
          } else if (Array.isArray(block.content)) {
            for (const c of block.content) {
              if (c.type === 'text') {
                tokens += countTokens(c.text)
              }
              // Images would need special handling
            }
          }
        }
      }
    }
  }

  // Count tools definitions if present
  if (request.tools) {
    for (const tool of request.tools) {
      tokens += countTokens(tool.name)
      if (tool.description) {
        tokens += countTokens(tool.description)
      }
      if (tool.input_schema) {
        tokens += countTokens(JSON.stringify(tool.input_schema))
      }
    }
  }

  return tokens
}
