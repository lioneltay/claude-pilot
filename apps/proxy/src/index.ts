// Claude Proxy - Main entry point

import Fastify from "fastify";
import { loadCredentials, getValidCopilotToken } from "./auth/storage.js";
import {
  transformRequest,
  mapModel,
  WEB_SEARCH_TOOL,
} from "./transform/request.js";
import { transformResponse } from "./transform/response.js";
import { createStreamTransformer } from "./transform/streaming.js";
import { executeWebSearch, formatAsToolResult } from "./services/webSearch.js";
import {
  log,
  summarizeMessages,
  getLogFilePath,
} from "@claude-proxy/shared/logger";
import type {
  AnthropicRequest,
  AnthropicToolResultBlock,
} from "./types/anthropic.js";
import type { OpenAIResponse } from "./types/openai.js";

const COPILOT_API_URL = "https://api.githubcopilot.com";
const PORT = parseInt(process.env.PORT || "8080", 10);
const LOG_FULL_REQUESTS = process.env.LOG_FULL_REQUESTS === "true";
const ENABLE_WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== "false"; // Enabled by default

// Detect if this is a dedicated web search execution request from Claude Code
// Claude Code sends these with a specific pattern when it needs to execute web_search
function isWebSearchExecutionRequest(request: AnthropicRequest): string | null {
  // Check system prompt pattern
  const systemText = typeof request.system === 'string'
    ? request.system
    : request.system?.map(b => b.text).join('') || '';

  if (!systemText.includes('performing a web search tool use')) {
    return null;
  }

  // Check for single message with search query pattern
  if (request.messages.length !== 1) {
    return null;
  }

  const msg = request.messages[0];
  const content = typeof msg.content === 'string'
    ? msg.content
    : msg.content.filter(b => b.type === 'text').map(b => (b as {text: string}).text).join('');

  const match = content.match(/Perform a web search for the query:\s*(.+)/i);
  if (match) {
    return match[1].trim();
  }

  return null;
}

// Process web search tool results - execute actual search when we see a web_search tool_result
async function processWebSearchToolResults(
  request: AnthropicRequest,
  logger: { info: (obj: object) => void },
): Promise<AnthropicRequest> {
  const processedMessages = [];

  for (const msg of request.messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const processedContent = [];

      for (const block of msg.content) {
        if (
          block.type === "tool_result" &&
          isWebSearchToolResult(block, request.messages)
        ) {
          // This is a web_search tool result - execute actual search
          const toolUse = findToolUseById(block.tool_use_id, request.messages);
          if (toolUse && toolUse.name === "web_search") {
            const query = (toolUse.input as { query?: string }).query || "";
            logger.info({ msg: "Executing web search", query });

            try {
              const searchResult = await executeWebSearch(query);
              const formattedResult = formatAsToolResult(searchResult);
              logger.info({
                msg: "Web search completed",
                query,
                sourceCount: searchResult.sources.length,
              });

              // Replace the tool_result content with actual search results
              processedContent.push({
                ...block,
                content: formattedResult,
              });
              continue;
            } catch (error) {
              logger.info({
                msg: "Web search failed",
                query,
                error: String(error),
              });
              // Keep original content on error
            }
          }
        }
        processedContent.push(block);
      }

      processedMessages.push({ ...msg, content: processedContent });
    } else {
      processedMessages.push(msg);
    }
  }

  // Add web_search tool if not already present
  let tools = request.tools || [];
  const hasWebSearch = tools.some((t) => t.name === "web_search");
  if (!hasWebSearch) {
    tools = [...tools, WEB_SEARCH_TOOL];
  }

  return {
    ...request,
    messages: processedMessages,
    tools,
  };
}

// Check if a tool_result is for web_search
function isWebSearchToolResult(
  block: { type: string; tool_use_id: string },
  messages: AnthropicRequest["messages"],
): boolean {
  const toolUse = findToolUseById(block.tool_use_id, messages);
  return toolUse?.name === "web_search";
}

// Find a tool_use block by ID in previous messages
function findToolUseById(
  toolUseId: string,
  messages: AnthropicRequest["messages"],
): { name: string; input: Record<string, unknown> } | null {
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id === toolUseId) {
          return { name: block.name, input: block.input };
        }
      }
    }
  }
  return null;
}

// Required headers for Copilot API
const COPILOT_HEADERS = {
  "editor-version": "vscode/1.95.0",
  "editor-plugin-version": "copilot-chat/0.22.4",
  "Openai-Intent": "conversation-edits",
};

async function main() {
  // Load credentials
  const credentials = await loadCredentials();
  if (!credentials) {
    console.error(
      "No credentials found. Run `pnpm auth` first to authenticate.",
    );
    process.exit(1);
  }

  console.log("Loaded credentials from ~/.config/claude-proxy/auth.json");
  console.log(`Logging to: ${getLogFilePath()}`);
  console.log(
    `Web search: ${ENABLE_WEB_SEARCH ? "enabled (via Copilot CLI)" : "disabled"}`,
  );

  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  });

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  // Main messages endpoint
  fastify.post("/v1/messages", async (request, reply) => {
    const requestId = request.id as string;
    const startTime = Date.now();
    let anthropicRequest = request.body as AnthropicRequest;

    // Check if this is a dedicated web search execution request
    if (ENABLE_WEB_SEARCH) {
      const searchQuery = isWebSearchExecutionRequest(anthropicRequest);
      if (searchQuery) {
        fastify.log.info({ msg: "Executing web search request", query: searchQuery });

        try {
          const searchResult = await executeWebSearch(searchQuery);
          const formattedResult = formatAsToolResult(searchResult);

          fastify.log.info({
            msg: "Web search completed",
            query: searchQuery,
            sourceCount: searchResult.sources.length,
          });

          await log({
            timestamp: new Date().toISOString(),
            requestId,
            type: "request",
            webSearch: true,
            query: searchQuery,
            sourceCount: searchResult.sources.length,
          } as Parameters<typeof log>[0]);

          // Return streaming response matching Anthropic's web_search format
          // This includes: server_tool_use, web_search_tool_result, and text blocks
          if (anthropicRequest.stream) {
            reply.header("Content-Type", "text/event-stream");
            reply.header("Cache-Control", "no-cache");
            reply.header("Connection", "keep-alive");

            const messageId = `msg_search_${requestId}`;
            const toolUseId = `srvtoolu_${Date.now()}`;

            // Build web_search_result items from our sources
            const webSearchResults = searchResult.sources.map((source) => ({
              type: "web_search_result",
              title: source.title,
              url: source.url,
              encrypted_content: "encrypted", // Dummy - Claude Code ignores this
              page_age: "recent",
            }));

            // Build streaming response matching Anthropic's format
            const events = [
              // Message start
              `event: message_start`,
              `data: ${JSON.stringify({
                type: "message_start",
                message: {
                  id: messageId,
                  type: "message",
                  role: "assistant",
                  content: [],
                  model: anthropicRequest.model,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              })}`,
              ``,

              // Block 0: server_tool_use (the search query)
              `event: content_block_start`,
              `data: ${JSON.stringify({
                type: "content_block_start",
                index: 0,
                content_block: {
                  type: "server_tool_use",
                  id: toolUseId,
                  name: "web_search",
                  input: {},
                },
              })}`,
              ``,
              `event: content_block_delta`,
              `data: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "input_json_delta",
                  partial_json: JSON.stringify({ query: searchQuery }),
                },
              })}`,
              ``,
              `event: content_block_stop`,
              `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
              ``,

              // Block 1: web_search_tool_result (the search results)
              `event: content_block_start`,
              `data: ${JSON.stringify({
                type: "content_block_start",
                index: 1,
                content_block: {
                  type: "web_search_tool_result",
                  tool_use_id: toolUseId,
                  content: webSearchResults,
                },
              })}`,
              ``,
              `event: content_block_stop`,
              `data: ${JSON.stringify({ type: "content_block_stop", index: 1 })}`,
              ``,

              // Block 2: text (the summary)
              `event: content_block_start`,
              `data: ${JSON.stringify({
                type: "content_block_start",
                index: 2,
                content_block: {
                  type: "text",
                  text: "",
                },
              })}`,
              ``,
              `event: content_block_delta`,
              `data: ${JSON.stringify({
                type: "content_block_delta",
                index: 2,
                delta: {
                  type: "text_delta",
                  text: formattedResult,
                },
              })}`,
              ``,
              `event: content_block_stop`,
              `data: ${JSON.stringify({ type: "content_block_stop", index: 2 })}`,
              ``,

              // Message end
              `event: message_delta`,
              `data: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: 100 },
              })}`,
              ``,
              `event: message_stop`,
              `data: ${JSON.stringify({ type: "message_stop" })}`,
              ``,
            ].join("\n");

            return reply.send(events);
          }

          // Non-streaming response
          const toolUseId = `srvtoolu_${Date.now()}`;
          const webSearchResults = searchResult.sources.map((source) => ({
            type: "web_search_result",
            title: source.title,
            url: source.url,
            encrypted_content: "encrypted",
            page_age: "recent",
          }));

          return {
            id: `msg_search_${requestId}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "server_tool_use",
                id: toolUseId,
                name: "web_search",
                input: { query: searchQuery },
              },
              {
                type: "web_search_tool_result",
                tool_use_id: toolUseId,
                content: webSearchResults,
              },
              {
                type: "text",
                text: formattedResult,
              },
            ],
            model: anthropicRequest.model,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 100 },
          };
        } catch (error) {
          fastify.log.error({ msg: "Web search failed", error: String(error) });
          // Fall through to normal processing on error
        }
      }

      // Handle web search tool results in normal requests
      anthropicRequest = await processWebSearchToolResults(
        anthropicRequest,
        fastify.log,
      );
    }

    // Determine X-Initiator header based on last message role
    const lastMessage =
      anthropicRequest.messages[anthropicRequest.messages.length - 1];
    const xInitiator = lastMessage?.role === "user" ? "user" : "agent";
    const mappedModel = mapModel(anthropicRequest.model);

    // Get system prompt preview
    let systemPreview = "";
    let systemLength = 0;
    if (anthropicRequest.system) {
      const systemText =
        typeof anthropicRequest.system === "string"
          ? anthropicRequest.system
          : anthropicRequest.system.map((b) => b.text).join("\n");
      systemPreview =
        systemText.slice(0, 500) + (systemText.length > 500 ? "..." : "");
      systemLength = systemText.length;
    }

    // Check if this is a suggestion request
    let lastMessageContent = "";
    if (typeof lastMessage?.content === "string") {
      lastMessageContent = lastMessage.content;
    } else if (Array.isArray(lastMessage?.content)) {
      // Handle array of content blocks
      lastMessageContent = lastMessage.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join(" ");
    }
    const isSuggestion = lastMessageContent.includes("[SUGGESTION MODE:");

    // Log to file
    await log({
      timestamp: new Date().toISOString(),
      requestId,
      type: "request",
      model: anthropicRequest.model,
      mappedModel,
      messageCount: anthropicRequest.messages.length,
      stream: anthropicRequest.stream,
      hasTools: !!anthropicRequest.tools?.length,
      toolNames: anthropicRequest.tools?.map((t) => t.name),
      xInitiator,
      charged: isSuggestion ? false : xInitiator === "user",
      messages: summarizeMessages(anthropicRequest.messages),
      systemPreview,
      systemLength,
      isSuggestion,
      ...(LOG_FULL_REQUESTS && { fullRequest: anthropicRequest }),
    });

    // Console log
    fastify.log.info({
      msg: "Incoming request",
      model: anthropicRequest.model,
      mappedModel,
      messageCount: anthropicRequest.messages.length,
      stream: anthropicRequest.stream,
      hasTools: !!anthropicRequest.tools?.length,
      isSuggestion,
    });
    fastify.log.info({
      msg: "Billing",
      xInitiator,
      charged: isSuggestion ? false : xInitiator === "user",
    });

    // Block suggestion requests - return empty response
    if (isSuggestion) {
      fastify.log.info({
        msg: "Blocking suggestion request - returning empty response",
      });

      await log({
        timestamp: new Date().toISOString(),
        requestId,
        type: "response",
        statusCode: 200,
        responseTime: Date.now() - startTime,
      });

      if (anthropicRequest.stream) {
        reply.header("Content-Type", "text/event-stream");
        reply.header("Cache-Control", "no-cache");
        reply.header("Connection", "keep-alive");

        // Return empty streaming response
        const messageId = `msg_blocked_${requestId}`;
        const emptyStreamResponse = [
          `event: message_start`,
          `data: ${JSON.stringify({
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              content: [],
              model: anthropicRequest.model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          })}`,
          ``,
          `event: message_delta`,
          `data: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 0 },
          })}`,
          ``,
          `event: message_stop`,
          `data: ${JSON.stringify({ type: "message_stop" })}`,
          ``,
        ].join("\n");

        return reply.send(emptyStreamResponse);
      }

      // Non-streaming empty response
      return {
        id: `msg_blocked_${requestId}`,
        type: "message",
        role: "assistant",
        content: [],
        model: anthropicRequest.model,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    }

    // Transform request
    const openaiRequest = transformRequest(anthropicRequest);

    // Get valid Copilot token (auto-refreshes if needed)
    const copilotToken = await getValidCopilotToken(credentials);

    // Make request to Copilot
    const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        ...COPILOT_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${copilotToken}`,
        "X-Initiator": xInitiator,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const responseTime = Date.now() - startTime;

      await log({
        timestamp: new Date().toISOString(),
        requestId,
        type: "error",
        statusCode: response.status,
        responseTime,
        error: errorText,
      });

      fastify.log.error({
        msg: "Copilot API error",
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });

      reply.code(response.status);
      return {
        type: "error",
        error: {
          type: "api_error",
          message: `Copilot API error: ${response.status} ${response.statusText} - ${errorText}`,
        },
      };
    }

    // Handle streaming response
    if (anthropicRequest.stream) {
      reply.header("Content-Type", "text/event-stream");
      reply.header("Cache-Control", "no-cache");
      reply.header("Connection", "keep-alive");

      // Capture raw Copilot response for logging
      const rawChunks: string[] = [];
      const captureStream = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          rawChunks.push(text);
          controller.enqueue(chunk);
        },
        async flush() {
          // Log the complete raw response when stream ends
          const rawResponse = rawChunks.join("");
          await log({
            timestamp: new Date().toISOString(),
            requestId,
            type: "response",
            statusCode: 200,
            responseTime: Date.now() - startTime,
            rawCopilotResponse: LOG_FULL_REQUESTS
              ? rawResponse
              : rawResponse.slice(0, 2000),
          });
        },
      });

      // Pipe: Copilot response → capture → transformer → client
      const transformed = response
        .body!.pipeThrough(captureStream)
        .pipeThrough(createStreamTransformer(openaiRequest.model));

      return reply.send(transformed);
    }

    // Handle non-streaming response
    const openaiResponse = (await response.json()) as OpenAIResponse;
    const responseTime = Date.now() - startTime;

    await log({
      timestamp: new Date().toISOString(),
      requestId,
      type: "response",
      statusCode: 200,
      responseTime,
      ...(LOG_FULL_REQUESTS && { fullResponse: openaiResponse }),
    });

    fastify.log.info({
      msg: "Copilot response",
      model: openaiResponse.model,
      finishReason: openaiResponse.choices[0]?.finish_reason,
      usage: openaiResponse.usage,
    });

    const anthropicResponse = transformResponse(openaiResponse);

    return anthropicResponse;
  });

  // Token counting endpoint (stub - returns estimates)
  fastify.post("/v1/messages/count_tokens", async (request) => {
    const body = request.body as AnthropicRequest;

    // Simple estimation: ~4 characters per token
    let charCount = 0;

    if (body.system) {
      charCount +=
        typeof body.system === "string"
          ? body.system.length
          : body.system.reduce((sum, b) => sum + b.text.length, 0);
    }

    for (const msg of body.messages) {
      if (typeof msg.content === "string") {
        charCount += msg.content.length;
      } else {
        for (const block of msg.content) {
          if (block.type === "text") {
            charCount += block.text.length;
          }
        }
      }
    }

    return {
      input_tokens: Math.ceil(charCount / 4),
    };
  });

  // Start server
  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`\nClaude Proxy running on http://localhost:${PORT}`);
    console.log(`\nConfigure Claude Code with:`);
    console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${PORT}`);
    console.log(`  export ANTHROPIC_AUTH_TOKEN=dummy`);
    console.log(`\nView logs:`);
    console.log(`  pnpm logs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
