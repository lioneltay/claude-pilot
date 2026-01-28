// Status command - Show running state

import { isDaemonRunning } from '../daemon.js'
import { loadCredentials } from '@claude-pilot/proxy'
import { AUTH_FILE } from '../config.js'

export async function status(): Promise<void> {
  console.log('Claude Pilot Status\n')

  // Check credentials
  const credentials = await loadCredentials(AUTH_FILE)
  if (credentials) {
    const expiresAt = new Date(credentials.copilotTokenExpiresAt)
    const isExpired = expiresAt < new Date()
    console.log(`Authentication: ${isExpired ? '✗ expired' : '✓ valid'}`)
    console.log(`  Token expires: ${expiresAt.toLocaleString()}`)
  } else {
    console.log('Authentication: ✗ not configured')
    console.log(`  Run 'claude-pilot login' to authenticate`)
  }

  console.log()

  // Check daemon status
  const { running, state } = await isDaemonRunning()

  if (running && state) {
    const startedAt = new Date(state.startedAt)
    const uptime = formatUptime(Date.now() - startedAt.getTime())

    console.log('Proxy: ✓ running')
    console.log(`  PID: ${state.pid}`)
    console.log(`  Port: ${state.port}`)
    console.log(`  Dashboard: http://localhost:${state.port}/`)
    console.log(`  Uptime: ${uptime}`)
    console.log(`  Started: ${startedAt.toLocaleString()}`)

    console.log('\nConfigure Claude Code with:')
    console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${state.port}`)
    console.log(`  export ANTHROPIC_AUTH_TOKEN=dummy`)
  } else {
    console.log('Proxy: ✗ not running')
    console.log(`  Run 'claude-pilot start' to start the proxy`)
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}
