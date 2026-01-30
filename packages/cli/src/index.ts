// Claude Pilot CLI - Main entry point

import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { login } from './commands/login.js'
import { logout } from './commands/logout.js'
import { start } from './commands/start.js'
import { stop } from './commands/stop.js'
import { status } from './commands/status.js'
import { dashboard } from './commands/dashboard.js'
import { isDaemonRunning } from './daemon.js'
import { loadCredentials } from '@claude-pilot/proxy'
import { DEFAULT_PORT, AUTH_FILE } from './config.js'
import { checkVersionInBackground, getLatestVersionCached, isNewerVersion } from './utils/versionCheck.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Read version from package.json
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    // In dist/, package.json is two levels up
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const VERSION = getVersion()

// Our built-in commands
const BUILTIN_COMMANDS = ['login', 'logout', 'start', 'stop', 'status', 'dashboard', 'help']

// Check if the first argument is one of our commands
function isBuiltinCommand(args: string[]): boolean {
  const firstArg = args[0]
  if (!firstArg) return false
  // Check for our commands or flags like --help, --version, -h, -V
  const commanderFlags = ['--help', '--version', '-h', '-V']
  return BUILTIN_COMMANDS.includes(firstArg) || commanderFlags.includes(firstArg)
}

// Run claude with proxy environment configured
async function runClaude(args: string[]): Promise<void> {
  // Check if proxy is running
  const { running, state } = await isDaemonRunning()

  if (!running) {
    // Check if we have credentials
    const credentials = await loadCredentials(AUTH_FILE)
    if (!credentials) {
      console.error('Not authenticated. Run `claude-pilot login` first.')
      process.exit(1)
    }

    // Auto-start the proxy
    console.log('Proxy not running, starting...')
    await start({ port: DEFAULT_PORT })

    // Re-check state after starting
    const { running: nowRunning, state: newState } = await isDaemonRunning()
    if (!nowRunning || !newState) {
      console.error('Failed to start proxy. Check logs with: cat ~/.config/claude-pilot/server.log')
      process.exit(1)
    }

    console.log() // Blank line before claude output
    runClaudeWithEnv(args, newState.port)
  } else {
    runClaudeWithEnv(args, state!.port)
  }
}

function runClaudeWithEnv(args: string[], port: number): void {
  const child = spawn('claude', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${port}`,
      ANTHROPIC_AUTH_TOKEN: 'dummy',
    },
  })

  child.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code')
    } else {
      console.error('Failed to run claude:', error.message)
    }
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}

// Main entry point
async function main() {
  // Check for updates (non-blocking background check)
  checkVersionInBackground()

  const args = process.argv.slice(2)

  // If no args or first arg is not a builtin command, run claude
  if (args.length === 0 || !isBuiltinCommand(args)) {
    await runClaude(args)
    return
  }

  // Otherwise, handle our builtin commands with commander
  const program = new Command()

  // Custom version output that shows if outdated
  const latestVersion = getLatestVersionCached()
  const versionOutput = latestVersion && isNewerVersion(VERSION, latestVersion)
    ? `${VERSION} (update available: ${latestVersion})`
    : VERSION

  program
    .name('claude-pilot')
    .description('Run Claude Code through GitHub Copilot API')
    .version(versionOutput)

  program
    .command('login')
    .description('Authenticate with GitHub Copilot')
    .action(async () => {
      try {
        await login()
      } catch (error) {
        console.error('Login failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('logout')
    .description('Clear credentials and stop proxy')
    .action(async () => {
      try {
        await logout()
      } catch (error) {
        console.error('Logout failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('start')
    .description('Start the proxy server in background')
    .option('-p, --port <port>', 'Port for proxy and dashboard')
    .action(async (options) => {
      try {
        await start({
          port: options.port ? parseInt(options.port, 10) : undefined,
        })
      } catch (error) {
        console.error('Start failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('stop')
    .description('Stop the running proxy server')
    .action(async () => {
      try {
        await stop()
      } catch (error) {
        console.error('Stop failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('status')
    .description('Show proxy status and configuration')
    .action(async () => {
      try {
        await status()
      } catch (error) {
        console.error('Status failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('dashboard')
    .description('Open the log viewer dashboard in browser')
    .action(async () => {
      try {
        await dashboard()
      } catch (error) {
        console.error('Dashboard failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program.parse()
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
