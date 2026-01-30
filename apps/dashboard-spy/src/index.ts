// Spy Dashboard - View Anthropic API traffic

import Fastify from 'fastify'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = parseInt(process.env.SPY_DASHBOARD_PORT || '8083', 10)

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== '/') {
    if (existsSync(join(dir, 'turbo.json'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const LOG_FILE = join(WORKSPACE_ROOT, 'logs', 'spy.jsonl')

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Anthropic Spy Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      margin: 0;
      padding: 20px;
      background: #0d1117;
      color: #c9d1d9;
    }
    h1 { color: #58a6ff; margin-bottom: 20px; }
    .controls {
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    button {
      padding: 8px 16px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      cursor: pointer;
      border-radius: 6px;
    }
    button:hover { background: #30363d; }
    .entries { display: flex; flex-direction: column; gap: 15px; }
    .entry {
      background: #161b22;
      border-radius: 8px;
      padding: 15px;
      border: 1px solid #30363d;
    }
    .entry.request { border-left: 4px solid #58a6ff; }
    .entry.response { border-left: 4px solid #3fb950; }
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
    .entry.request .entry-type { background: #58a6ff; color: #0d1117; }
    .entry.response .entry-type { background: #3fb950; color: #0d1117; }
    .entry-time { color: #8b949e; font-size: 12px; }
    .entry-meta {
      display: flex;
      gap: 15px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .meta-item {
      background: #21262d;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 13px;
    }
    .meta-label { color: #8b949e; margin-right: 5px; }
    .json-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      max-height: 500px;
      overflow-y: auto;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .section-title {
      color: #8b949e;
      font-size: 12px;
      margin: 10px 0 5px 0;
      text-transform: uppercase;
    }
    .empty { text-align: center; color: #8b949e; padding: 40px; }
    .streaming-badge {
      background: #a371f7;
      color: #0d1117;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <h1>Anthropic Spy Dashboard</h1>
  <div class="controls">
    <button onclick="loadLogs()">Refresh</button>
    <button onclick="clearLogs()">Clear Logs</button>
    <label style="display: flex; align-items: center; gap: 5px;">
      <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
      Auto-refresh (2s)
    </label>
    <span id="status" style="color: #8b949e; margin-left: auto;"></span>
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
        document.getElementById('status').textContent = 'Last update: ' + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById('status').textContent = 'Error loading logs';
      }
    }

    function formatJson(obj) {
      try {
        if (typeof obj === 'string') {
          // Try to parse if it's a JSON string
          try {
            obj = JSON.parse(obj);
          } catch {
            return escapeHtml(obj);
          }
        }
        return escapeHtml(JSON.stringify(obj, null, 2));
      } catch {
        return escapeHtml(String(obj));
      }
    }

    function renderLogs(entries) {
      const container = document.getElementById('entries');
      if (entries.length === 0) {
        container.innerHTML = '<div class="empty">No logs yet. Run Claude Code with ANTHROPIC_BASE_URL=http://localhost:8082</div>';
        return;
      }

      container.innerHTML = entries.reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        let html = '<div class="entry ' + entry.type + '">';
        html += '<div class="entry-header">';
        html += '<span class="entry-type">' + entry.type.toUpperCase() + '</span>';
        html += '<span class="entry-time">' + time + ' - ' + entry.requestId + '</span>';
        html += '</div>';

        if (entry.type === 'request') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><span class="meta-label">Method:</span>' + entry.method + '</div>';
          html += '<div class="meta-item"><span class="meta-label">Path:</span>' + entry.path + '</div>';
          html += '</div>';

          if (entry.body) {
            html += '<div class="section-title">Request Body</div>';
            html += '<div class="json-block">' + formatJson(entry.body) + '</div>';
          }
        } else if (entry.type === 'response') {
          html += '<div class="entry-meta">';
          html += '<div class="meta-item"><span class="meta-label">Status:</span>' + entry.statusCode + '</div>';
          html += '<div class="meta-item"><span class="meta-label">Time:</span>' + entry.responseTime + 'ms</div>';
          if (entry.streaming) {
            html += '<span class="streaming-badge">STREAMING</span>';
          }
          html += '</div>';

          if (entry.rawResponse) {
            html += '<div class="section-title">Response Body</div>';
            html += '<div class="json-block">' + formatJson(entry.rawResponse) + '</div>';
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
      if (!confirm('Clear all spy logs?')) return;
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
</html>`

async function main() {
  const fastify = Fastify()

  fastify.get('/', async (_, reply) => {
    reply.header('Content-Type', 'text/html')
    return HTML
  })

  fastify.get('/api/logs', async () => {
    try {
      const fileStat = await stat(LOG_FILE)
      const content = await readFile(LOG_FILE, 'utf-8')
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
      return { modified: fileStat.mtimeMs, entries }
    } catch {
      return { modified: 0, entries: [] }
    }
  })

  fastify.delete('/api/logs', async () => {
    try {
      await writeFile(LOG_FILE, '')
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Spy Dashboard running at http://localhost:${PORT}`)
}

main()
