// Transform OpenAI Chat Completions response → Anthropic Messages API response

import type { AnthropicResponse, AnthropicContentBlock } from '../types/anthropic.js'
import type { OpenAIResponse } from '../types/openai.js'

function mapFinishReason(finishReason: string | null): AnthropicResponse['stop_reason'] {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return null
  }
}

export function transformResponse(openai: OpenAIResponse): AnthropicResponse {
  const choice = openai.choices[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  const content: AnthropicContentBlock[] = []

  // Handle text content
  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    })
  }

  // Handle tool calls
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      })
    }
  }

  return {
    id: openai.id,
    type: 'message',
    role: 'assistant',
    content,
    model: openai.model,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openai.usage.prompt_tokens,
      output_tokens: openai.usage.completion_tokens,
    },
  }
}
