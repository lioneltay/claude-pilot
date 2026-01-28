// Configuration paths and constants

import { homedir } from 'node:os'
import { join } from 'node:path'

// Config directory: ~/.config/claude-pilot/
export const CONFIG_DIR = join(homedir(), '.config', 'claude-pilot')

// Auth credentials file
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json')

// Daemon state file (PID, ports, etc.)
export const DAEMON_FILE = join(CONFIG_DIR, 'daemon.json')

// Log file for the server
export const LOG_FILE = join(CONFIG_DIR, 'server.log')

// Request logs (JSONL format)
export const REQUEST_LOG_FILE = join(CONFIG_DIR, 'requests.jsonl')

// Default port (esoteric to avoid conflicts)
// Dashboard is served at the same port on /
export const DEFAULT_PORT = 51080
