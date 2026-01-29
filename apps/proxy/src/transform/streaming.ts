// Transform OpenAI streaming chunks → Anthropic streaming events

import type { OpenAIStreamChunk } from '../types/openai.js'
import { formatSSEEvent } from '../utils/sse.js'

type StreamState = {
  messageId: string
  model: string
  contentBlockIndex: number
  toolCalls: Map<number, { id: string; name: string; arguments: string }>
  inputTokens: number
  outputTokens: number
}

function createMessageStartEvent(state: StreamState) {
  return {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: state.inputTokens,
        output_tokens: 0,
      },
    },
  }
}

export function createStreamTransformer(model: string) {
  const state: StreamState = {
    messageId: `msg_${Date.now()}`,
    model,
    contentBlockIndex: 0,
    toolCalls: new Map(),
    inputTokens: 0,
    outputTokens: 0,
  }

  let sentMessageStart = false
  let sentContentBlockStart = false
  let sentMessageStop = false
  let currentContentType: 'text' | 'tool_use' | null = null
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, data: unknown) => {
    controller.enqueue(encoder.encode(formatSSEEvent(data as { type: string })))
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Decode and buffer the chunk
      buffer += decoder.decode(chunk, { stream: true })

      // Parse SSE data - process complete lines only
      const lines = buffer.split('\n')
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          // [DONE] means stream is complete - but we already handled finish_reason
          // Don't emit duplicate events
          continue
        }

        let openaiChunk: OpenAIStreamChunk
        try {
          openaiChunk = JSON.parse(data)
        } catch {
          continue
        }

        // Send message_start on first chunk
        if (!sentMessageStart) {
          if (openaiChunk.usage?.prompt_tokens) {
            state.inputTokens = openaiChunk.usage.prompt_tokens
          }
          emit(controller, createMessageStartEvent(state))
          sentMessageStart = true
        }

        const choice = openaiChunk.choices[0]
        if (!choice) continue

        const delta = choice.delta

        // Handle text content
        if (delta.content) {
          if (!sentContentBlockStart || currentContentType !== 'text') {
            // Start new text block
            if (sentContentBlockStart) {
              emit(controller, {
                type: 'content_block_stop',
                index: state.contentBlockIndex,
              })
              state.contentBlockIndex++
            }

            emit(controller, {
              type: 'content_block_start',
              index: state.contentBlockIndex,
              content_block: { type: 'text', text: '' },
            })
            sentContentBlockStart = true
            currentContentType = 'text'
          }

          emit(controller, {
            type: 'content_block_delta',
            index: state.contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          })
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const existingCall = state.toolCalls.get(toolCall.index)

            if (!existingCall && toolCall.id && toolCall.function?.name) {
              // New tool call - close any existing content block
              if (sentContentBlockStart) {
                emit(controller, {
                  type: 'content_block_stop',
                  index: state.contentBlockIndex,
                })
                state.contentBlockIndex++
              }

              // Start tool_use block
              state.toolCalls.set(toolCall.index, {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: '',
              })

              emit(controller, {
                type: 'content_block_start',
                index: state.contentBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: toolCall.id,
                  name: toolCall.function.name,
                  input: {},
                },
              })
              sentContentBlockStart = true
              currentContentType = 'tool_use'
            }

            // Stream tool call arguments
            if (toolCall.function?.arguments) {
              const call = state.toolCalls.get(toolCall.index)
              if (call) {
                call.arguments += toolCall.function.arguments

                emit(controller, {
                  type: 'content_block_delta',
                  index: state.contentBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: toolCall.function.arguments,
                  },
                })
              }
            }
          }
        }

        // Handle finish_reason
        if (choice.finish_reason && !sentMessageStop) {
          // Close current content block
          if (sentContentBlockStart) {
            emit(controller, {
              type: 'content_block_stop',
              index: state.contentBlockIndex,
            })
          }

          const stopReason = mapFinishReason(choice.finish_reason)

          // Get final usage from the chunk (OpenAI sends usage in the last chunk)
          const inputTokens = openaiChunk.usage?.prompt_tokens || state.inputTokens
          const outputTokens = openaiChunk.usage?.completion_tokens || state.outputTokens

          emit(controller, {
            type: 'message_delta',
            delta: {
              stop_reason: stopReason,
              stop_sequence: null,
            },
            usage: {
              input_tokens: inputTokens,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: outputTokens,
            },
          })

          emit(controller, { type: 'message_stop' })
          sentMessageStop = true
        }

        // Track usage
        if (openaiChunk.usage) {
          state.outputTokens = openaiChunk.usage.completion_tokens
        }
      }
    },
  })
}

function mapFinishReason(reason: string | null): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}
