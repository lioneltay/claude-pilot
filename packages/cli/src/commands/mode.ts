// Mode command - Change proxy routing mode

import { isDaemonRunning } from '../daemon.js'
import { loadConfig, saveConfig, type ProxyMode } from '../config.js'

export async function mode(newMode?: string): Promise<void> {
  const { running, state } = await isDaemonRunning()

  // If no mode specified, show current mode
  if (!newMode) {
    const config = loadConfig()
    console.log(`Current mode: ${config.mode}`)

    if (running && state) {
      // Also check runtime mode matches config
      try {
        const response = await fetch(`http://localhost:${state.port}/config`)
        const runtimeConfig = (await response.json()) as { mode: string }
        if (runtimeConfig.mode !== config.mode) {
          console.log(`  (runtime: ${runtimeConfig.mode} - will sync on next request)`)
        }
      } catch {
        // Ignore fetch errors
      }
    }

    console.log()
    console.log('Available modes:')
    console.log('  copilot  - All requests go through GitHub Copilot (default)')
    console.log('  split    - Sidecars go to Anthropic, main conversation to Copilot')
    console.log()
    console.log('Change mode with: claude-pilot mode <copilot|split>')
    return
  }

  // Validate mode
  if (newMode !== 'copilot' && newMode !== 'split') {
    console.error(`Invalid mode: ${newMode}`)
    console.error('Valid modes: copilot, split')
    process.exit(1)
  }

  // Save to config file (persists across restarts)
  saveConfig({ mode: newMode as ProxyMode })

  // If proxy is running, also update runtime mode
  if (running && state) {
    try {
      const response = await fetch(`http://localhost:${state.port}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })

      const result = (await response.json()) as { mode: string; error?: string }
      if (result.error) {
        console.error(`Warning: Failed to update running proxy: ${result.error}`)
      }
    } catch {
      console.error('Warning: Could not connect to running proxy')
    }
  }

  console.log(`Mode changed to: ${newMode}`)

  if (newMode === 'split') {
    console.log()
    console.log('Split mode enabled:')
    console.log('  - Main conversation → Copilot (request-based billing)')
    console.log('  - Sidecars (title gen, etc.) → Anthropic (passthrough)')
  }

  if (!running) {
    console.log()
    console.log('Note: Proxy is not running. Mode will apply on next start.')
  }
}
