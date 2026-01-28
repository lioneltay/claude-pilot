// Simple web-based log viewer

import Fastify from 'fastify'
import { readFile, stat } from 'node:fs/promises'
import { getLogFilePath } from '@claude-proxy/shared/logger'

const PORT = parseInt(process.env.VIEWER_PORT || '8081', 10)

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Claude Proxy Logs</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
    }
    h1 { color: #fff; margin-bottom: 20px; }
    .controls {
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    button {
      padding: 8px 16px;
      background: #4a4a6a;
      border: none;
      color: white;
      cursor: pointer;
      border-radius: 4px;
    }
    button:hover { background: #5a5a7a; }
    .auto-refresh { display: flex; align-items: center; gap: 5px; }
    .entries { display: flex; flex-direction: column; gap: 10px; }
    .entry {
      background: #252540;
      border-radius: 8px;
      padding: 15px;
      border-left: 4px solid #666;
    }
    .entry.request { border-left-color: #4CAF50; }
    .entry.response { border-left-color: #2196F3; }
    .entry.error { border-left-color: #f44336; }
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .entry-type {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
    }
    .entry.request .entry-type { background: #4CAF50; }
    .entry.response .entry-type { background: #2196F3; }
    .entry.error .entry-type { background: #f44336; }
    .entry-time { color: #888; font-size: 12px; }
    .entry-meta {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .meta-item {
      background: #1a1a2e;
      padding: 8px;
      border-radius: 4px;
    }
    .meta-label { color: #888; font-size: 11px; }
    .meta-value { font-size: 14px; }
    .charged { color: #f44336; }
    .free { color: #4CAF50; }
    .suggestion-badge {
      background: #9c27b0;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      margin-left: 8px;
    }
    .messages {
      background: #1a1a2e;
      padding: 10px;
      border-radius: 4px;
      max-height: 300px;
      overflow-y: auto;
    }
    .message {
      padding: 8px;
      margin: 5px 0;
      border-radius: 4px;
      background: #252540;
    }
    .message-role {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .message-role.user { color: #4CAF50; }
    .message-role.assistant { color: #2196F3; }
    .message-content {
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      color: #ccc;
    }
    .tool-badge {
      display: inline-block;
      background: #ff9800;
      color: black;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      margin-left: 5px;
    }
    .system-preview {
      background: #1a1a2e;
      padding: 10px;
      border-radius: 4px;
      font-size: 12px;
      color: #888;
      max-height: 100px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .tools-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .tool-name {
      background: #4a4a6a;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
    }
    .empty { text-align: center; color: #666; padding: 40px; }
  </style>
</head>
<body>
  <h1>Claude Proxy Logs</h1>
  <div class="controls">
    <button onclick="loadLogs()">Refresh</button>
    <button onclick="clearLogs()">Clear Logs</button>
    <div class="auto-refresh">
      <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
      <label for="autoRefresh">Auto-refresh (2s)</label>
    </div>
    <span id="status" style="color: #888; margin-left: auto;"></span>
  </div>
  <div id="entries" class="entries">
    <div class="empty">Loading...</div>
  </div>

  <script>
    let autoRefreshInterval = null;
    let lastModified = null;

    async function loadLogs() {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();

        if (data.modified !== lastModified) {
          lastModified = data.modified;
          renderLogs(data.entries);
        }

        document.getElementById('status').textContent =
          'Last update: ' + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById('status').textContent = 'Error loading logs';
      }
    }

    function renderLogs(entries) {
      const container = document.getElementById('entries');

      if (entries.length === 0) {
        container.innerHTML = '<div class="empty">No logs yet. Make a request through the proxy.</div>';
        return;
      }

      // Reverse to show newest first
      container.innerHTML = entries.reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();

        let html = '<div class="entry ' + entry.type + '">';
        html += '<div class="entry-header">';
        html += '<span class="entry-type">' + entry.type.toUpperCase() + '</span>';
        html += '<span class="entry-time">' + time + ' - ' + entry.requestId + '</span>';
        html += '</div>';

        if (entry.type === 'request') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><div class="meta-label">Model</div><div class="meta-value">' + entry.model + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Mapped To</div><div class="meta-value">' + entry.mappedModel + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Messages</div><div class="meta-value">' + entry.messageCount + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Billing</div><div class="meta-value ' + (entry.charged ? 'charged' : 'free') + '">' + (entry.charged ? 'CHARGED' : 'FREE') + ' (' + entry.xInitiator + ')' + (entry.isSuggestion ? '<span class="suggestion-badge">BLOCKED</span>' : '') + '</div></div>';
          html += '</div>';

          if (entry.toolNames && entry.toolNames.length > 0) {
            html += '<div style="margin-bottom: 10px"><div class="meta-label">Tools Available</div><div class="tools-list">';
            entry.toolNames.slice(0, 10).forEach(t => {
              html += '<span class="tool-name">' + t + '</span>';
            });
            if (entry.toolNames.length > 10) {
              html += '<span class="tool-name">+' + (entry.toolNames.length - 10) + ' more</span>';
            }
            html += '</div></div>';
          }

          if (entry.systemPreview) {
            html += '<div style="margin-bottom: 10px"><div class="meta-label">System Prompt (' + entry.systemLength + ' chars)</div>';
            html += '<div class="system-preview">' + escapeHtml(entry.systemPreview) + '</div></div>';
          }

          if (entry.messages && entry.messages.length > 0) {
            html += '<div class="meta-label">Messages</div>';
            html += '<div class="messages">';
            entry.messages.forEach(msg => {
              html += '<div class="message">';
              html += '<div class="message-role ' + msg.role + '">' + msg.role;
              if (msg.hasToolUse) html += '<span class="tool-badge">tool_use</span>';
              if (msg.hasToolResult) html += '<span class="tool-badge">tool_result</span>';
              html += ' <span style="color:#666;font-weight:normal">(' + msg.contentLength + ' chars)</span></div>';
              html += '<div class="message-content">' + escapeHtml(msg.contentPreview || '(empty)') + '</div>';
              html += '</div>';
            });
            html += '</div>';
          }
        } else if (entry.type === 'response') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">' + entry.statusCode + '</div></div>';
          html += '<div class="meta-item"><div class="meta-label">Response Time</div><div class="meta-value">' + entry.responseTime + 'ms</div></div>';
          html += '</div>';
          if (entry.rawCopilotResponse) {
            html += '<div style="margin-top: 10px"><div class="meta-label">Raw Copilot Response (' + entry.rawCopilotResponse.length + ' chars)</div>';
            html += '<div class="system-preview" style="max-height: 200px;">' + escapeHtml(entry.rawCopilotResponse) + '</div></div>';
          }
        } else if (entry.type === 'error') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">' + entry.statusCode + '</div></div>';
          html += '</div>';
          if (entry.error) {
            html += '<div class="system-preview" style="color: #f44336;">' + escapeHtml(entry.error) + '</div>';
          }
        }

        html += '</div>';
        return html;
      }).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;
      await fetch('/api/logs', { method: 'DELETE' });
      lastModified = null;
      loadLogs();
    }

    function toggleAutoRefresh() {
      if (document.getElementById('autoRefresh').checked) {
        autoRefreshInterval = setInterval(loadLogs, 2000);
      } else {
        clearInterval(autoRefreshInterval);
      }
    }

    loadLogs();
  </script>
</body>
</html>`;

async function main() {
  const fastify = Fastify()
  const logFile = getLogFilePath()

  fastify.get('/', async (_, reply) => {
    reply.header('Content-Type', 'text/html')
    return HTML
  })

  fastify.get('/api/logs', async () => {
    try {
      const fileStat = await stat(logFile)
      const content = await readFile(logFile, 'utf-8')
      const entries = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return {
        modified: fileStat.mtimeMs,
        entries,
      }
    } catch {
      return { modified: 0, entries: [] }
    }
  })

  fastify.delete('/api/logs', async () => {
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(logFile, '')
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Log viewer running at http://localhost:${PORT}`)
}

main()
