// Logout command - Clear credentials

import { unlink } from 'node:fs/promises'
import { AUTH_FILE } from '../config.js'
import { isDaemonRunning, clearDaemonState } from '../daemon.js'
import { stop } from './stop.js'

export async function logout(): Promise<void> {
  // Stop proxy if running
  const { running } = await isDaemonRunning()
  if (running) {
    await stop()
  }

  // Delete auth file
  try {
    await unlink(AUTH_FILE)
    console.log('✓ Logged out successfully')
    console.log(`  Removed ${AUTH_FILE}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('Already logged out (no credentials found)')
    } else {
      throw error
    }
  }
}
