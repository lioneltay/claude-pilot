// Constants and magic strings

// Copilot API
export const COPILOT_API_URL = 'https://api.githubcopilot.com'

export const COPILOT_HEADERS = {
  'editor-version': 'vscode/1.95.0',
  'editor-plugin-version': 'copilot-chat/0.22.4',
  'Openai-Intent': 'conversation-edits',
}

// Web search detection patterns
export const WEB_SEARCH_SYSTEM_PATTERN = 'performing a web search tool use'
export const WEB_SEARCH_MESSAGE_PATTERN = /Perform a web search for the query:\s*(.+)/i

// Suggestion detection
export const SUGGESTION_MODE_PATTERN = '[SUGGESTION MODE:'

// Sidecar/Subagent detection patterns (should be marked as agent-initiated)
// These are synthetic requests spawned by Claude Code, not direct user prompts
// Source: Claude Code v2.1.19 cli.js

export const SIDECAR_PATTERNS = [
  'Extract any file paths',           // File tracking after Bash commands
  'Analyze if this message indicates a new conversation topic',  // Title generation
  'Summarize this coding conversation',  // Title summarization
]

export const SUBAGENT_PATTERNS = [
  // Explore agent
  'file search specialist',
  // Plan agent
  'software architect and planning specialist',
  // Bash agent
  'command execution specialist',
  // Status line setup agent
  'status line setup agent',
  // Quick/fast exploration agent
  'fast agent that returns output as quickly as possible',
  // Claude Code guide agent
  'claude-code-guide',
  // Task tool generic agent (distinguishes from main conversation which has "interactive CLI tool")
  'Given the user\'s message, you should use the tools available to complete the task',
]

// Free models (0 premium multiplier)
// GPT-5 mini is free on paid Copilot plans and comparable to Haiku
export const FREE_MODEL = 'gpt-5-mini'

// Default configuration
export const DEFAULT_PORT = 8080
