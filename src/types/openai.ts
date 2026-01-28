// OpenAI Chat Completions API types (what Copilot expects)

export type OpenAIMessageContent =
  | string
  | Array<OpenAITextContent | OpenAIImageContent>

export type OpenAITextContent = {
  type: 'text'
  text: string
}

export type OpenAIImageContent = {
  type: 'image_url'
  image_url: {
    url: string // Can be base64 data URL or HTTP URL
    detail?: 'low' | 'high' | 'auto'
  }
}

export type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OpenAIMessageContent }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  stream?: boolean
  tools?: OpenAITool[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export type OpenAIChoice = {
  index: number
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: OpenAIToolCall[]
  }
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export type OpenAIResponse = {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Streaming types
export type OpenAIStreamChunk = {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: 'assistant'
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
