// Anthropic Messages API types (what Claude Code sends)

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

export type AnthropicTextBlock = {
  type: 'text'
  text: string
}

export type AnthropicImageBlock = {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type AnthropicToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | AnthropicContentBlock[]
  is_error?: boolean
}

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicTool = {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export type AnthropicRequest = {
  model: string
  messages: AnthropicMessage[]
  system?: string | Array<{ type: 'text'; text: string }>
  max_tokens: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string }
}

export type AnthropicResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null
  stop_sequence?: string | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

// Streaming event types
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: Omit<AnthropicResponse, 'content'> & { content: [] } }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta'
      delta: { stop_reason: string | null; stop_sequence?: string | null }
      usage: { output_tokens: number }
    }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } }

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
