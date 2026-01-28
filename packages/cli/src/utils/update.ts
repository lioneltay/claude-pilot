// Auto-update checker

import { execSync } from 'node:child_process'

const PACKAGE_NAME = '@lioneltay/claude-pilot'

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

export async function checkAndUpdate(): Promise<void> {
  try {
    const current = getInstalledVersion()
    if (!current) return // Can't determine version, skip

    // Get latest version from npm
    const latest = execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (latest === current) {
      return // Already up to date
    }

    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    // Silently fail - don't block on update errors
  }
}
