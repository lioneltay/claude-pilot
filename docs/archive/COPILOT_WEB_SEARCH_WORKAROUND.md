# Copilot Web Search Workaround

## The Solution

Instead of calling the web_search API directly (which is not exposed), we can **run Copilot CLI as a subprocess** with a prompt that triggers web search.

## How It Works

```bash
copilot --allow-all -p "Search the web and answer: {query}"
```

This:
1. Prompts the model to use the `web_search` tool
2. Copilot executes the search server-side
3. Returns a formatted markdown response with sources

## Example Output

```
● web_search
  └ {"type":"text","text":{"value":"TypeScript 5.7 introduces several improvement...

## TypeScript 5.7 New Features

**1. Checks for Never-Initialized Variables**
TypeScript now reliably detects variables...

**Sources:**
- [TypeScript Official Docs](https://www.typescriptlang.org/docs/...)

Total usage est:        3 Premium requests
API time spent:         12s
```

## Implementation for the Proxy

```typescript
import { spawn } from 'child_process';

interface WebSearchResult {
  content: string;
  sources: Array<{ title: string; url: string }>;
}

async function copilotWebSearch(query: string): Promise<WebSearchResult> {
  return new Promise((resolve, reject) => {
    const copilot = spawn('copilot', [
      '--allow-all',
      '-p',
      `Search the web and provide a detailed answer with sources: ${query}`
    ]);

    let stdout = '';
    let stderr = '';

    copilot.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    copilot.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    copilot.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Copilot exited with code ${code}: ${stderr}`));
        return;
      }

      // Parse the output
      const result = parseCopilotOutput(stdout);
      resolve(result);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      copilot.kill();
      reject(new Error('Web search timed out'));
    }, 60000);
  });
}

function parseCopilotOutput(output: string): WebSearchResult {
  // Remove the tool indicator line and JSON preview
  const lines = output.split('\n');

  // Find where the actual content starts (after the JSON line)
  let contentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') || lines[i].startsWith('**')) {
      contentStart = i;
      break;
    }
  }

  // Find where the usage stats start
  let contentEnd = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('Total usage est:')) {
      contentEnd = i;
      break;
    }
  }

  const content = lines.slice(contentStart, contentEnd).join('\n').trim();

  // Extract sources from markdown links
  const sourceRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const sources: Array<{ title: string; url: string }> = [];
  let match;
  while ((match = sourceRegex.exec(content)) !== null) {
    sources.push({ title: match[1], url: match[2] });
  }

  return { content, sources };
}
```

## Integration with Anthropic Web Search

When the proxy intercepts an Anthropic `web_search_20250305` tool request:

```typescript
async function handleAnthropicWebSearch(toolUse: any): Promise<any> {
  const query = toolUse.input.query;

  // Use Copilot CLI for web search
  const result = await copilotWebSearch(query);

  // Format as Anthropic tool_result
  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: [
      {
        type: 'web_search_tool_result',
        content: result.sources.map((source, i) => ({
          type: 'web_search_result',
          url: source.url,
          title: source.title,
          // Include the relevant portion of the content
          page_content: result.content
        }))
      }
    ]
  };
}
```

## Pros and Cons

### Pros
- ✅ Works with existing Copilot subscription
- ✅ No additional API costs (uses Copilot's Bing integration)
- ✅ Returns AI-summarized content with citations
- ✅ Simple to implement

### Cons
- ❌ Requires Copilot CLI installed
- ❌ Spawns subprocess for each search (some overhead)
- ❌ Depends on CLI output format (may break with updates)
- ❌ Uses "premium requests" from Copilot quota
- ❌ Slower than direct API call (~10-20 seconds per search)

## Alternative: Parse JSON from Output

The output includes raw JSON from the tool result:

```
└ {"type":"text","text":{"value":"...","annotations":[...]},"bing_searches":[...]}
```

We could parse this for more structured data:

```typescript
function parseToolResult(output: string): any {
  const jsonMatch = output.match(/└ ({.*})/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse tool result JSON');
    }
  }
  return null;
}
```

This gives us:
- `text.value` - The full summary text
- `text.annotations` - Citation markers with URLs
- `bing_searches` - The actual Bing search queries used

## Conclusion

This workaround allows us to leverage Copilot's web search through the CLI, providing a functional (if not ideal) solution for adding web search to the Claude Code proxy.
