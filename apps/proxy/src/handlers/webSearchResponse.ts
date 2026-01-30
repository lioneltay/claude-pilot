// Web search response building

import type { WebSearchResult } from '../services/webSearch.js'
import {
  buildSSEStream,
  createMessageStart,
  createContentBlockStart,
  createContentBlockDelta,
  createContentBlockStop,
  createMessageDelta,
  createMessageStop,
  type SSEEvent,
} from '../utils/sse.js'

type WebSearchResultItem = {
  type: 'web_search_result'
  title: string
  url: string
  encrypted_content: string
  page_age: string
}

/**
 * Build web_search_result items from sources
 */
function buildWebSearchResults(sources: WebSearchResult['sources']): WebSearchResultItem[] {
  return sources.map((source) => ({
    type: 'web_search_result',
    title: source.title,
    url: source.url,
    encrypted_content: 'encrypted', // Dummy - Claude Code ignores this
    page_age: 'recent',
  }))
}

/**
 * Build a streaming response for web search results
 * Matches Anthropic's format: server_tool_use → web_search_tool_result → text
 */
export function buildWebSearchStreamingResponse(
  messageId: string,
  model: string,
  searchQuery: string,
  searchResult: WebSearchResult,
  formattedResult: string
): string {
  const toolUseId = `srvtoolu_${Date.now()}`
  const webSearchResults = buildWebSearchResults(searchResult.sources)

  const events: SSEEvent[] = [
    // Message start
    createMessageStart(messageId, model),

    // Block 0: server_tool_use (the search query)
    createContentBlockStart(0, {
      type: 'server_tool_use',
      id: toolUseId,
      name: 'web_search',
      input: {},
    }),
    createContentBlockDelta(0, {
      type: 'input_json_delta',
      partial_json: JSON.stringify({ query: searchQuery }),
    }),
    createContentBlockStop(0),

    // Block 1: web_search_tool_result (the search results)
    createContentBlockStart(1, {
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      content: webSearchResults,
    }),
    createContentBlockStop(1),

    // Block 2: text (the summary)
    createContentBlockStart(2, {
      type: 'text',
      text: '',
    }),
    createContentBlockDelta(2, {
      type: 'text_delta',
      text: formattedResult,
    }),
    createContentBlockStop(2),

    // Message end
    createMessageDelta('end_turn', 100),
    createMessageStop(),
  ]

  return buildSSEStream(events)
}

/**
 * Build a non-streaming response for web search results
 */
export function buildWebSearchNonStreamingResponse(
  messageId: string,
  model: string,
  searchQuery: string,
  searchResult: WebSearchResult,
  formattedResult: string
): object {
  const toolUseId = `srvtoolu_${Date.now()}`
  const webSearchResults = buildWebSearchResults(searchResult.sources)

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'server_tool_use',
        id: toolUseId,
        name: 'web_search',
        input: { query: searchQuery },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: toolUseId,
        content: webSearchResults,
      },
      {
        type: 'text',
        text: formattedResult,
      },
    ],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 100 },
  }
}

// Note: buildEmptyNonStreamingResponse is exported from utils/sse.ts for consistency
