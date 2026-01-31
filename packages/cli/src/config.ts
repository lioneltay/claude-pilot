// Configuration paths and constants

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// Config directory: ~/.config/claude-pilot/
export const CONFIG_DIR = join(homedir(), '.config', 'claude-pilot')

// Auth credentials file
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json')

// Daemon state file (PID, ports, etc.)
export const DAEMON_FILE = join(CONFIG_DIR, 'daemon.json')

// User config file (mode, etc.)
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// Log file for the server
export const LOG_FILE = join(CONFIG_DIR, 'server.log')

// Request logs (JSONL format)
export const REQUEST_LOG_FILE = join(CONFIG_DIR, 'requests.jsonl')

// Default port (esoteric to avoid conflicts)
// Dashboard is served at the same port on /
export const DEFAULT_PORT = 51080

// Config types
export type ProxyMode = 'copilot' | 'split'

export type ProxyConfig = {
  mode: ProxyMode
}

const DEFAULT_CONFIG: ProxyConfig = {
  mode: 'copilot',
}

// Read config from file
export function loadConfig(): ProxyConfig {
  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) }
  } catch {
    return DEFAULT_CONFIG
  }
}

// Write config to file
export function saveConfig(config: Partial<ProxyConfig>): ProxyConfig {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const current = loadConfig()
  const updated = { ...current, ...config }
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2))
  return updated
}
