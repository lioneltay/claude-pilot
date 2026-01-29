// Update command - Check for and install updates

import { execSync } from 'node:child_process'

const PACKAGE_NAME = '@lioneltay/claude-pilot'

function getInstalledVersion(): string | null {
  try {
    const output = execSync(`npm list -g ${PACKAGE_NAME} --depth=0 --json`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const data = JSON.parse(output)
    return data.dependencies?.[PACKAGE_NAME]?.version || null
  } catch {
    return null
  }
}

function getLatestVersion(): string | null {
  try {
    return execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

export async function update(): Promise<void> {
  console.log('Checking for updates...')

  const current = getInstalledVersion()
  if (!current) {
    console.error('Could not determine installed version')
    return
  }

  const latest = getLatestVersion()
  if (!latest) {
    console.error('Could not check for latest version')
    return
  }

  console.log(`  Installed: ${current}`)
  console.log(`  Latest:    ${latest}`)

  if (latest === current) {
    console.log('\n✓ Already up to date')
    return
  }

  console.log(`\nUpdating to ${latest}...`)

  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'inherit',
    })
    console.log(`\n✓ Updated to ${latest}`)
  } catch {
    console.error('\nUpdate failed. Try manually: npm install -g @lioneltay/claude-pilot@latest')
  }
}
