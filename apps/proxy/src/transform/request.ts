// Transform Anthropic Messages API request → OpenAI Chat Completions request

import type {
  AnthropicRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTool,
} from '../types/anthropic.js'
import type {
  OpenAIRequest,
  OpenAIMessage,
  OpenAITool,
  OpenAIMessageContent,
  OpenAIToolCall,
} from '../types/openai.js'

// Model mapping: Anthropic model IDs → Copilot model IDs
// Copilot supports: claude-haiku-4.5, claude-sonnet-4.5, claude-opus-4
export function mapModel(anthropicModel: string): string {
  const model = anthropicModel.toLowerCase()

  // Match by model family
  if (model.includes('opus')) {
    return 'claude-opus-4'
  }
  if (model.includes('sonnet')) {
    return 'claude-sonnet-4.5'
  }
  if (model.includes('haiku')) {
    return 'claude-haiku-4.5'
  }

  // Fallback to original (will likely fail, but lets us see the error)
  return anthropicModel
}

function transformContentToString(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function transformContentToOpenAI(content: string | AnthropicContentBlock[]): OpenAIMessageContent {
  if (typeof content === 'string') {
    return content
  }

  // Check if there are any non-text blocks
  const hasNonText = content.some((block) => block.type !== 'text')

  if (!hasNonText) {
    // Simple text content
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  // Mixed content with images
  return content
    .filter((block) => block.type === 'text' || block.type === 'image')
    .map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text }
      }
      if (block.type === 'image') {
        return {
          type: 'image_url' as const,
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        }
      }
      throw new Error(`Unexpected block type`)
    })
}

function extractToolCalls(content: AnthropicContentBlock[]): OpenAIToolCall[] {
  return content
    .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      block.type === 'tool_use'
    )
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input),
      },
    }))
}

function transformMessage(msg: AnthropicMessage): OpenAIMessage | OpenAIMessage[] {
  if (msg.role === 'user') {
    // Check for tool_result blocks
    if (typeof msg.content !== 'string') {
      const toolResults = msg.content.filter((block) => block.type === 'tool_result')

      if (toolResults.length > 0) {
        // Return tool messages for each result
        return toolResults.map((block) => {
          if (block.type !== 'tool_result') throw new Error('Expected tool_result')
          return {
            role: 'tool' as const,
            tool_call_id: block.tool_use_id,
            content:
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
          }
        })
      }
    }

    return {
      role: 'user',
      content: transformContentToOpenAI(msg.content),
    }
  }

  // Assistant message
  if (typeof msg.content === 'string') {
    return {
      role: 'assistant',
      content: msg.content,
    }
  }

  const toolCalls = extractToolCalls(msg.content)
  const textContent = transformContentToString(msg.content)

  return {
    role: 'assistant',
    content: textContent || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

function transformTool(tool: AnthropicTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }
}

function transformToolChoice(
  toolChoice?: AnthropicRequest['tool_choice']
): OpenAIRequest['tool_choice'] {
  if (!toolChoice) return undefined

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'tool':
      return toolChoice.name
        ? { type: 'function', function: { name: toolChoice.name } }
        : 'auto'
    default:
      return 'auto'
  }
}

export function transformRequest(anthropic: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = []

  // Handle system prompt
  if (anthropic.system) {
    const systemText =
      typeof anthropic.system === 'string'
        ? anthropic.system
        : anthropic.system.map((block) => block.text).join('\n')

    messages.push({
      role: 'system',
      content: systemText,
    })
  }

  // Transform messages
  for (const msg of anthropic.messages) {
    const transformed = transformMessage(msg)
    if (Array.isArray(transformed)) {
      messages.push(...transformed)
    } else {
      messages.push(transformed)
    }
  }

  return {
    model: mapModel(anthropic.model),
    messages,
    max_tokens: anthropic.max_tokens,
    temperature: anthropic.temperature,
    top_p: anthropic.top_p,
    stop: anthropic.stop_sequences,
    stream: anthropic.stream,
    tools: anthropic.tools?.map(transformTool),
    tool_choice: transformToolChoice(anthropic.tool_choice),
  }
}
