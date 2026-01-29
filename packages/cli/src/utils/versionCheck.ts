// Non-blocking version check - notifies user if outdated

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config.js'

const PACKAGE_NAME = '@lioneltay/claude-pilot'
const CHECK_FILE = join(CONFIG_DIR, 'version-check.json')
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

type VersionCache = {
  lastCheck: number
  latestVersion: string | null
}

function readCache(): VersionCache | null {
  try {
    return JSON.parse(readFileSync(CHECK_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function writeCache(cache: VersionCache): void {
  try {
    writeFileSync(CHECK_FILE, JSON.stringify(cache))
  } catch {
    // Ignore write errors
  }
}

function getInstalledVersion(): string | null {
  try {
    const output = execSync(`npm list -g ${PACKAGE_NAME} --depth=0 --json`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const data = JSON.parse(output)
    return data.dependencies?.[PACKAGE_NAME]?.version || null
  } catch {
    return null
  }
}

function fetchLatestVersion(): string | null {
  try {
    return execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Check if there's a newer version available.
 * Uses a cached check to avoid hitting npm on every startup.
 * Only checks once every 24 hours.
 */
export function checkVersionInBackground(): void {
  // Run in next tick to not block startup
  setImmediate(() => {
    try {
      const cache = readCache()
      const now = Date.now()

      // Use cached result if recent enough
      if (cache && now - cache.lastCheck < CHECK_INTERVAL_MS) {
        if (cache.latestVersion) {
          const installed = getInstalledVersion()
          if (installed && cache.latestVersion !== installed) {
            console.log(`\n📦 Update available: ${installed} → ${cache.latestVersion}`)
            console.log('   Run: claude-pilot update\n')
          }
        }
        return
      }

      // Fetch latest version
      const latest = fetchLatestVersion()
      writeCache({ lastCheck: now, latestVersion: latest })

      if (latest) {
        const installed = getInstalledVersion()
        if (installed && latest !== installed) {
          console.log(`\n📦 Update available: ${installed} → ${latest}`)
          console.log('   Run: claude-pilot update\n')
        }
      }
    } catch {
      // Silently ignore errors
    }
  })
}
