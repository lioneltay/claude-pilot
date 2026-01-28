// Transform OpenAI streaming chunks → Anthropic streaming events

import type { OpenAIStreamChunk } from '../types/openai.js'

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
  let currentContentType: 'text' | 'tool_use' | null = null

  return new TransformStream<string, string>({
    transform(chunk, controller) {
      // Parse SSE data
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          // Send content_block_stop if we had content
          if (sentContentBlockStart) {
            controller.enqueue(
              formatSSE({
                type: 'content_block_stop',
                index: state.contentBlockIndex,
              })
            )
          }

          // Send any pending tool calls
          for (const [index, toolCall] of state.toolCalls) {
            // Tool call was already streamed, just close it
          }

          // Send message_delta with final stop_reason
          controller.enqueue(
            formatSSE({
              type: 'message_delta',
              delta: {
                stop_reason: 'end_turn',
                stop_sequence: null,
              },
              usage: {
                output_tokens: state.outputTokens,
              },
            })
          )

          // Send message_stop
          controller.enqueue(formatSSE({ type: 'message_stop' }))
          return
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
          controller.enqueue(formatSSE(createMessageStartEvent(state)))
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
              controller.enqueue(
                formatSSE({
                  type: 'content_block_stop',
                  index: state.contentBlockIndex,
                })
              )
              state.contentBlockIndex++
            }

            controller.enqueue(
              formatSSE({
                type: 'content_block_start',
                index: state.contentBlockIndex,
                content_block: { type: 'text', text: '' },
              })
            )
            sentContentBlockStart = true
            currentContentType = 'text'
          }

          controller.enqueue(
            formatSSE({
              type: 'content_block_delta',
              index: state.contentBlockIndex,
              delta: { type: 'text_delta', text: delta.content },
            })
          )
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const existingCall = state.toolCalls.get(toolCall.index)

            if (!existingCall && toolCall.id && toolCall.function?.name) {
              // New tool call - close any existing content block
              if (sentContentBlockStart) {
                controller.enqueue(
                  formatSSE({
                    type: 'content_block_stop',
                    index: state.contentBlockIndex,
                  })
                )
                state.contentBlockIndex++
              }

              // Start tool_use block
              state.toolCalls.set(toolCall.index, {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: '',
              })

              controller.enqueue(
                formatSSE({
                  type: 'content_block_start',
                  index: state.contentBlockIndex,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: {},
                  },
                })
              )
              sentContentBlockStart = true
              currentContentType = 'tool_use'
            }

            // Stream tool call arguments
            if (toolCall.function?.arguments) {
              const call = state.toolCalls.get(toolCall.index)
              if (call) {
                call.arguments += toolCall.function.arguments

                controller.enqueue(
                  formatSSE({
                    type: 'content_block_delta',
                    index: state.contentBlockIndex,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: toolCall.function.arguments,
                    },
                  })
                )
              }
            }
          }
        }

        // Handle finish_reason
        if (choice.finish_reason) {
          // Close current content block
          if (sentContentBlockStart) {
            controller.enqueue(
              formatSSE({
                type: 'content_block_stop',
                index: state.contentBlockIndex,
              })
            )
          }

          const stopReason = mapFinishReason(choice.finish_reason)

          controller.enqueue(
            formatSSE({
              type: 'message_delta',
              delta: {
                stop_reason: stopReason,
                stop_sequence: null,
              },
              usage: {
                output_tokens: openaiChunk.usage?.completion_tokens || state.outputTokens,
              },
            })
          )

          controller.enqueue(formatSSE({ type: 'message_stop' }))
        }

        // Track usage
        if (openaiChunk.usage) {
          state.outputTokens = openaiChunk.usage.completion_tokens
        }
      }
    },
  })
}

function formatSSE(data: unknown): string {
  return `event: ${(data as { type: string }).type}\ndata: ${JSON.stringify(data)}\n\n`
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
