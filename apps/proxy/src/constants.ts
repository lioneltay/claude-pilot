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

// Free model for suggestions (0 premium multiplier)
export const FREE_SUGGESTION_MODEL = 'gpt-4.1'

// Default configuration
export const DEFAULT_PORT = 8080
