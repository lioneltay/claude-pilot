// Daemon state management

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { CONFIG_DIR, DAEMON_FILE } from './config.js'

export type DaemonState = {
  pid: number
  port: number
  startedAt: string
}

/**
 * Load daemon state from file
 */
export async function loadDaemonState(): Promise<DaemonState | null> {
  try {
    const data = await readFile(DAEMON_FILE, 'utf-8')
    return JSON.parse(data) as DaemonState
  } catch {
    return null
  }
}

/**
 * Save daemon state to file
 */
export async function saveDaemonState(state: DaemonState): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(DAEMON_FILE, JSON.stringify(state, null, 2))
}

/**
 * Delete daemon state file
 */
export async function deleteDaemonState(): Promise<void> {
  try {
    await unlink(DAEMON_FILE)
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if a process is running by PID
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check if the daemon is currently running
 */
export async function isDaemonRunning(): Promise<{ running: boolean; state: DaemonState | null }> {
  const state = await loadDaemonState()

  if (!state) {
    return { running: false, state: null }
  }

  const running = isProcessRunning(state.pid)

  // Clean up stale daemon file if process is not running
  if (!running) {
    await deleteDaemonState()
    return { running: false, state: null }
  }

  return { running: true, state }
}
