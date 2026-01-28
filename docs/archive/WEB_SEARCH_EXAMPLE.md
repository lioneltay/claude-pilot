# Web Search Complete Example

This shows the full flow from web search response to tool_result.

## 1. Web Search API Response (from Anthropic)

The response is a streaming SSE response with multiple content blocks:

### Content Block Structure

| Index | Type | Description |
|-------|------|-------------|
| 0 | `thinking` | Initial reasoning about the search |
| 1 | `server_tool_use` | The search query executed |
| 2 | `web_search_tool_result` | Search results with encrypted content |
| 3 | `thinking` | Processing the results |
| 4-25 | `text` | Model-generated summary with citations |

### Block 1: server_tool_use

```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "name": "web_search",
  "input": {}
}
```

Note: The actual query comes via `input_json_delta` events: `{"query": "Claude Code CLI latest version 2026"}`

### Block 2: web_search_tool_result

```json
{
  "type": "web_search_tool_result",
  "tool_use_id": "srvtoolu_01M6NgYqEpDtqG7XNfqbv1mm",
  "content": [
    {
      "type": "web_search_result",
      "title": "Claude Code 2.1 Is Here — I Tested 16 New Changes (Don't Miss This Update) | by Joe Njenga | Jan, 2026 | Medium",
      "url": "https://medium.com/@joe.njenga/claude-code-2-1-is-here-i-tested-all-16-new-changes-dont-miss-this-update-ea9ca008dab7",
      "encrypted_content": "EuEPCioIDBgC...[base64 encoded, ~2KB per result]...",
      "page_age": "3 weeks ago"
    },
    {
      "type": "web_search_result",
      "title": "claude-code/CHANGELOG.md at main · anthropics/claude-code",
      "url": "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
      "encrypted_content": "EoQhCioIDBgC...",
      "page_age": "5 days ago"
    }
    // ... more results (typically 10)
  ]
}
```

**What Claude Code extracts from this:**
- `title` ✅ (readable)
- `url` ✅ (readable)
- `page_age` ✅ (readable)
- `encrypted_content` ❌ (ignored - Claude Code doesn't use this)

### Blocks 4-25: text (with citations)

The model generates text blocks with the summary. Some text blocks include citations:

```json
{
  "type": "content_block_delta",
  "index": 19,
  "delta": {
    "type": "citations_delta",
    "citation": {
      "type": "web_search_result_location",
      "cited_text": "The Big Picture: Version 2.1.0 shipped on January 7, 2026, with 2.1.9 following immediately with 109 CLI refinements.",
      "url": "https://mlearning.substack.com/p/claude-code-21-new-features-january-2026",
      "title": "Claude Code 2.1 NEW Features - by Datasculptor",
      "encrypted_index": "Eo8BCioIDBgC..."
    }
  }
}
```

**What Claude Code extracts from citations:**
- `cited_text` ✅ (readable - the actual text snippet!)
- `url` ✅ (readable)
- `title` ✅ (readable)
- `encrypted_index` ❌ (ignored)

---

## 2. Tool Result (sent back to main conversation)

Claude Code assembles the readable data into this `tool_result`:

```json
{
  "tool_use_id": "toolu_01Q8exH1d5TrdDL6KfkKEjyJ",
  "type": "tool_result",
  "content": "Web search results for query: \"Claude Code CLI latest version 2026\"\n\nLinks: [{\"title\":\"Claude Code 2.1 Is Here — I Tested 16 New Changes (Don't Miss This Update) | by Joe Njenga | Jan, 2026 | Medium\",\"url\":\"https://medium.com/@joe.njenga/claude-code-2-1-is-here-i-tested-all-16-new-changes-dont-miss-this-update-ea9ca008dab7\"},{\"title\":\"claude-code/CHANGELOG.md at main · anthropics/claude-code\",\"url\":\"https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md\"},{\"title\":\"Claude Code 2.1.0 is now out! claude update to get it...\",\"url\":\"https://www.threads.com/@boris_cherny/post/DTOyRyBD018/...\"},{\"title\":\"Claude Code 2.1 NEW Features - by Datasculptor\",\"url\":\"https://mlearning.substack.com/p/claude-code-21-new-features-january-2026\"},{\"title\":\"Claude Code CLI was broken | Hacker News\",\"url\":\"https://news.ycombinator.com/item?id=46532075\"},{\"title\":\"Claude Code 2.1.0 arrives with smoother workflows and smarter agents | VentureBeat\",\"url\":\"https://venturebeat.com/orchestration/claude-code-2-1-0-arrives-with-smoother-workflows-and-smarter-agents\"},{\"title\":\"Claude Code Finally Fixed Its Biggest Problems...\",\"url\":\"https://medium.com/@joe.njenga/claude-code-finally-fixed-its-biggest-problems-stats-instant-compact-and-more-0c85801c8d10\"},{\"title\":\"ClaudeLog - Claude Code Docs, Guides, Tutorials & Best Practices\",\"url\":\"https://claudelog.com/claude-code-changelog/\"},{\"title\":\"Claude Code - AI coding agent for terminal & IDE | Claude\",\"url\":\"https://claude.com/product/claude-code\"},{\"title\":\"Enabling Claude Code to work more autonomously\",\"url\":\"https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously\"}]\n\nBased on the search results, here's what I found about the latest Claude Code CLI version in 2026:\n\n## Claude Code CLI Latest Version (2026)\n\nVersion 2.1.0 shipped on January 7, 2026, with 2.1.9 following immediately with 109 CLI refinements. The team shipped 1,096 commits in this release — covering everything from terminal input improvements to a complete overhaul of how skills work.\n\n### Key Features in Version 2.1.x:\n\n**Terminal & Input Improvements:**\n- Shift+Enter now works out of the box in iTerm2, Kitty, Ghostty, and WezTerm without modifying terminal configs.\n- Clickable file path hyperlinks (OSC 8) and winget installation support were added.\n\n**Agent & Skills Enhancements:**\n- Hooks for agents, skills, and slash commands enable scoped PreToolUse, PostToolUse, and Stop logic.\n- Skills now support forked context, hot reload, custom agent support, and can be invoked with /.\n\n**Session Management:**\n- Session teleportation via /teleport and /remote-env slash commands.\n\n**Other Notable Features:**\n- Language-specific output via a language setting.\n- Pro users now have access to Opus 4.5 as part of their subscription.\n- A command injection security vulnerability in bash command processing was fixed.\n\n### How to Update:\nTo update, run `claude update` and check your version with `claude --version`.\n\n\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.",
  "cache_control": {
    "type": "ephemeral"
  }
}
```

---

## 3. Data Transformation Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WEB SEARCH RESPONSE (from Anthropic)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  web_search_tool_result:                                                │
│    ├── title: "Claude Code 2.1 Is Here..."     ──────┐                  │
│    ├── url: "https://medium.com/..."           ──────┼──► Links array   │
│    ├── page_age: "3 weeks ago"                       │                  │
│    └── encrypted_content: "EuEPCioI..."  ✗ IGNORED   │                  │
│                                                      │                  │
│  text blocks (index 4-25):                           │                  │
│    └── Generated summary text            ────────────┼──► Summary text  │
│                                                      │                  │
│  citations:                                          │                  │
│    ├── cited_text: "Version 2.1.0..."   ─────────────┘                  │
│    ├── url: "https://..."                                               │
│    └── encrypted_index: "Eo8B..."        ✗ IGNORED                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TOOL_RESULT (to main conversation)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  {                                                                      │
│    "type": "tool_result",                                               │
│    "content": "Web search results for query: \"...\"\n\n                │
│                Links: [{title, url}, ...]\n\n                           │
│                [Generated summary from text blocks]\n\n                 │
│                REMINDER: include sources..."                            │
│  }                                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Insight for Copilot Implementation

Claude Code **never decrypts** `encrypted_content`. It only uses:

1. **From `web_search_tool_result`**: `title`, `url`, `page_age` (all readable)
2. **From `text` blocks**: The model-generated summary (readable)
3. **From `citations`**: `cited_text`, `url`, `title` (all readable)

**For our Copilot proxy**, we can implement web search by:

1. Performing our own web search (Google/Bing/DuckDuckGo API)
2. Fetching and scraping page content ourselves
3. Formatting a `tool_result` with the same structure:
   - Links array with title/url
   - Content/summary (either raw content or our own summary)
   - Reminder to include sources

We don't need to replicate any encryption - just provide the actual content!
