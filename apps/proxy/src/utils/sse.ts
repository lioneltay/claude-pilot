// SSE (Server-Sent Events) utilities

export type SSEEvent = {
  type: string
  [key: string]: unknown
}

/**
 * Format a single SSE event
 */
export function formatSSEEvent(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Build a complete SSE stream from an array of events
 */
export function buildSSEStream(events: SSEEvent[]): string {
  return events.map(formatSSEEvent).join('')
}

/**
 * Create a message_start event
 */
export function createMessageStart(
  messageId: string,
  model: string,
  inputTokens = 0
): SSEEvent {
  return {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  }
}

/**
 * Create a content_block_start event
 */
export function createContentBlockStart(
  index: number,
  contentBlock: { type: string; [key: string]: unknown }
): SSEEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: contentBlock,
  }
}

/**
 * Create a content_block_delta event
 */
export function createContentBlockDelta(
  index: number,
  delta: { type: string; [key: string]: unknown }
): SSEEvent {
  return {
    type: 'content_block_delta',
    index,
    delta,
  }
}

/**
 * Create a content_block_stop event
 */
export function createContentBlockStop(index: number): SSEEvent {
  return {
    type: 'content_block_stop',
    index,
  }
}

/**
 * Create a message_delta event (end of message)
 */
export function createMessageDelta(
  stopReason: string,
  outputTokens = 0
): SSEEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }
}

/**
 * Create a message_stop event
 */
export function createMessageStop(): SSEEvent {
  return { type: 'message_stop' }
}

/**
 * Build an empty streaming response (for blocked requests)
 */
export function buildEmptyStreamingResponse(
  messageId: string,
  model: string
): string {
  const events: SSEEvent[] = [
    createMessageStart(messageId, model),
    createMessageDelta('end_turn', 0),
    createMessageStop(),
  ]
  return buildSSEStream(events)
}

/**
 * Build an empty non-streaming response (for blocked requests)
 */
export function buildEmptyNonStreamingResponse(
  messageId: string,
  model: string
): object {
  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: [],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

/**
 * Set standard SSE headers on a reply object
 */
export function setStreamingHeaders(
  reply: { header: (k: string, v: string) => void }
): void {
  reply.header('Content-Type', 'text/event-stream')
  reply.header('Cache-Control', 'no-cache')
  reply.header('Connection', 'keep-alive')
}
