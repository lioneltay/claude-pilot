// Stop command - Stop running proxy

import { isDaemonRunning, deleteDaemonState } from '../daemon.js'

export async function stop(): Promise<void> {
  const { running, state } = await isDaemonRunning()

  if (!running || !state) {
    console.log('Proxy is not running')
    return
  }

  console.log(`Stopping proxy (PID: ${state.pid})...`)

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(state.pid, 'SIGTERM')

    // Wait briefly for process to exit
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Check if still running and force kill if necessary
    try {
      process.kill(state.pid, 0)
      // Still running, send SIGKILL
      console.log('Process did not exit gracefully, forcing...')
      process.kill(state.pid, 'SIGKILL')
    } catch {
      // Process exited, which is what we want
    }

    await deleteDaemonState()
    console.log('✓ Proxy stopped')
  } catch (error) {
    // Process might have already exited
    await deleteDaemonState()
    console.log('✓ Proxy stopped (was already exiting)')
  }
}
