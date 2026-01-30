// Non-blocking version check - notifies user if outdated

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version || null
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
 * Simple semver comparison - returns true if v2 > v1
 */
export function isNewerVersion(v1: string, v2: string): boolean {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p2 > p1) return true
    if (p2 < p1) return false
  }
  return false
}

/**
 * Get cached latest version (returns null if no cache or cache is stale)
 */
export function getLatestVersionCached(): string | null {
  const cache = readCache()
  if (!cache) return null
  if (Date.now() - cache.lastCheck > CHECK_INTERVAL_MS) return null
  return cache.latestVersion
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
          if (installed && isNewerVersion(installed, cache.latestVersion)) {
            console.log(`\n📦 Update available: ${installed} → ${cache.latestVersion}`)
            console.log(`   npm install -g @lioneltay/claude-pilot@latest\n`)
          }
        }
        return
      }

      // Fetch latest version
      const latest = fetchLatestVersion()
      writeCache({ lastCheck: now, latestVersion: latest })

      if (latest) {
        const installed = getInstalledVersion()
        if (installed && isNewerVersion(installed, latest)) {
          console.log(`\n📦 Update available: ${installed} → ${latest}`)
          console.log(`   npm install -g @lioneltay/claude-pilot@latest\n`)
        }
      }
    } catch {
      // Silently ignore errors
    }
  })
}
