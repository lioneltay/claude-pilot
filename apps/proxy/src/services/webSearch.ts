// Web Search Service - Uses Copilot CLI to perform web searches

import { spawn } from 'child_process'

export type WebSearchResult = {
  query: string
  summary: string
  sources: Array<{ title: string; url: string }>
}

// Path to Copilot CLI - can be overridden via env var
const COPILOT_PATH = process.env.COPILOT_PATH || 'copilot'

// Timeout for web search (default 60 seconds)
const SEARCH_TIMEOUT = parseInt(process.env.WEB_SEARCH_TIMEOUT || '60000', 10)

// Model to use for web search (gpt-4.1 is free, fast, and sufficient)
const SEARCH_MODEL = process.env.WEB_SEARCH_MODEL || 'gpt-4.1'

/**
 * Execute a web search using Copilot CLI
 *
 * This prompts Copilot to use its built-in web_search tool,
 * which uses Bing under the hood and returns AI-summarized results.
 */
export async function executeWebSearch(query: string): Promise<WebSearchResult> {
  const prompt = `Execute web_search for: "${query}"

Return JSON only:
{
  "query": <the search query>,
  "summary": <full text from tool response, do not truncate>,
  "sources": [{"title": ..., "url": ...}]
}`

  return new Promise((resolve, reject) => {
    const args = ['--allow-all', '--model', SEARCH_MODEL, '-p', prompt]
    const copilot = spawn(COPILOT_PATH, args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    copilot.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    copilot.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    // Timeout handler
    const timeout = setTimeout(() => {
      copilot.kill('SIGTERM')
      reject(new Error(`Web search timed out after ${SEARCH_TIMEOUT}ms`))
    }, SEARCH_TIMEOUT)

    copilot.on('close', (code) => {
      clearTimeout(timeout)

      if (code !== 0 && code !== null) {
        reject(new Error(`Copilot exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const result = parseWebSearchOutput(stdout, query)
        resolve(result)
      } catch (error) {
        reject(new Error(`Failed to parse web search output: ${error}`))
      }
    })

    copilot.on('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to spawn Copilot: ${error.message}`))
    })
  })
}

/**
 * Parse the Copilot CLI output to extract web search results
 */
function parseWebSearchOutput(output: string, originalQuery: string): WebSearchResult {
  // Try to find JSON in the output
  // The output format is:
  // ● web_search
  //   └ {"type":"text",...}
  //
  // {
  //   "query": "...",
  //   "summary": "...",
  //   "sources": [...]
  // }
  //
  // Total usage est: ...

  // First, try to find a clean JSON object with query, summary, sources
  // Look for JSON that starts with { on its own line
  const jsonMatch = output.match(/^\{[^{}]*"query"[^{}]*"summary"[^{}]*"sources"\s*:\s*\[[^\]]*\][^{}]*\}/m)

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        query: parsed.query || originalQuery,
        summary: parsed.summary || '',
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      }
    } catch {
      // Fall through to alternative parsing
    }
  }

  // Second attempt: look for the JSON block more flexibly
  const jsonMatch2 = output.match(/\{\s*\n\s*"query"[\s\S]*?"sources"\s*:\s*\[[\s\S]*?\]\s*\n\s*\}/m)

  if (jsonMatch2) {
    try {
      const parsed = JSON.parse(jsonMatch2[0])
      return {
        query: parsed.query || originalQuery,
        summary: parsed.summary || '',
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      }
    } catch {
      // Fall through to fallback parsing
    }
  }

  // Alternative: extract content between the JSON line and "Total usage"
  const lines = output.split('\n')
  let contentStart = -1
  let contentEnd = lines.length

  for (let i = 0; i < lines.length; i++) {
    // Look for start of actual content (markdown headers or bold text)
    if (contentStart === -1 && (lines[i].startsWith('## ') || lines[i].startsWith('**') || lines[i].startsWith('# '))) {
      contentStart = i
    }
    // Look for end (usage stats)
    if (lines[i].startsWith('Total usage est:')) {
      contentEnd = i
      break
    }
  }

  if (contentStart !== -1) {
    const summary = lines.slice(contentStart, contentEnd).join('\n').trim()

    // Extract URLs from markdown links
    const sources: Array<{ title: string; url: string }> = []
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
    let match: RegExpExecArray | null
    while ((match = linkRegex.exec(summary)) !== null) {
      // Avoid duplicates
      if (!sources.some(s => s.url === match![2])) {
        sources.push({ title: match[1], url: match[2] })
      }
    }

    return {
      query: originalQuery,
      summary,
      sources,
    }
  }

  // Fallback: return raw output as summary
  return {
    query: originalQuery,
    summary: output.slice(0, 5000), // Limit length
    sources: [],
  }
}

/**
 * Format web search results as a tool_result content string
 */
export function formatAsToolResult(result: WebSearchResult): string {
  const sourcesText = result.sources.length > 0
    ? `\n\n**Sources:**\n${result.sources.map(s => `- [${s.title}](${s.url})`).join('\n')}`
    : ''

  return `# Web Search Results for: "${result.query}"

${result.summary}${sourcesText}`
}
