// Start command - Start proxy in background

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openSync, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { loadCredentials, getValidCopilotToken } from '@claude-pilot/proxy'
import { isDaemonRunning, saveDaemonState } from '../daemon.js'
import { CONFIG_DIR, LOG_FILE, DEFAULT_PORT, AUTH_FILE } from '../config.js'

type StartOptions = {
  port?: number
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort
  while (port < startPort + 100) {
    if (await isPortAvailable(port)) {
      return port
    }
    port++
  }
  throw new Error(`Could not find available port in range ${startPort}-${startPort + 100}`)
}

export async function start(options: StartOptions): Promise<void> {
  // Check if already running
  const { running, state } = await isDaemonRunning()
  if (running && state) {
    console.log(`Proxy is already running (PID: ${state.pid})`)
    console.log(`  http://localhost:${state.port}`)
    console.log(`  Dashboard: http://localhost:${state.port}/`)
    return
  }

  // Check credentials
  const credentials = await loadCredentials(AUTH_FILE)
  if (!credentials) {
    console.log('No credentials found')
    console.log("Run 'claude-pilot login' first to authenticate")
    process.exit(1)
  }

  // Ensure token is valid (auto-refreshes if needed)
  try {
    await getValidCopilotToken(credentials, AUTH_FILE)
  } catch (error) {
    console.log('Failed to validate/refresh token:', error instanceof Error ? error.message : error)
    console.log("Run 'claude-pilot login' to re-authenticate")
    process.exit(1)
  }

  // Find available port
  const requestedPort = options.port || DEFAULT_PORT
  const port = await findAvailablePort(requestedPort)

  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} in use, using ${port}`)
  }

  // Find the server.js file
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // When running from dist/, server.js is in the same directory as cli.js
  // When running via tsx during dev, we need to handle that case too
  let serverPath = join(__dirname, 'server.js')

  // If server.js doesn't exist (dev mode), try to find it
  if (!existsSync(serverPath)) {
    // Try relative to current file's parent (when running as cli.js in dist/)
    serverPath = join(__dirname, '..', 'dist', 'server.js')
  }

  if (!existsSync(serverPath)) {
    console.log('Error: server.js not found')
    console.log('If developing, run `pnpm build` first')
    process.exit(1)
  }

  console.log('Starting proxy...')

  // Ensure config directory exists
  await mkdir(CONFIG_DIR, { recursive: true })

  // Open log file for output
  const logFd = openSync(LOG_FILE, 'a')

  // Spawn server as detached process
  const child = spawn('node', [serverPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PROXY_PORT: String(port),
    },
  })

  // Unref to allow parent to exit
  child.unref()

  // Save daemon state
  await saveDaemonState({
    pid: child.pid!,
    port,
    startedAt: new Date().toISOString(),
  })

  // Wait briefly to check if server started successfully
  await new Promise((resolve) => setTimeout(resolve, 1500))

  // Verify the server is actually running by checking health endpoint
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      console.log('Proxy started successfully')
      console.log(`  PID: ${child.pid}`)
      console.log(`  http://localhost:${port}`)
      console.log(`  Dashboard: http://localhost:${port}/`)
      console.log(`  Logs: ${LOG_FILE}`)
      console.log('\nConfigure Claude Code with:')
      console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${port}`)
      console.log(`  export ANTHROPIC_AUTH_TOKEN=dummy`)
      return
    }
  } catch {
    // Server might not be ready yet or failed to start
  }

  // If health check failed, server might have crashed
  console.log('Proxy started (PID: ' + child.pid + ')')
  console.log(`  http://localhost:${port}`)
  console.log(`  Logs: ${LOG_FILE}`)
  console.log('\nNote: Check logs if the proxy is not responding')
}
