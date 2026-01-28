// Credential storage and token refresh

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { getCopilotToken } from './github.js'

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'claude-pilot')
const DEFAULT_AUTH_FILE = join(DEFAULT_CONFIG_DIR, 'auth.json')

export type StoredCredentials = {
  githubToken: string
  copilotToken: string
  copilotTokenExpiresAt: number
}

export async function loadCredentials(authFile = DEFAULT_AUTH_FILE): Promise<StoredCredentials | null> {
  try {
    const data = await readFile(authFile, 'utf-8')
    return JSON.parse(data) as StoredCredentials
  } catch {
    return null
  }
}

export async function saveCredentials(credentials: StoredCredentials, authFile = DEFAULT_AUTH_FILE): Promise<void> {
  await mkdir(dirname(authFile), { recursive: true })
  await writeFile(authFile, JSON.stringify(credentials, null, 2))
}

export async function getValidCopilotToken(credentials: StoredCredentials, authFile = DEFAULT_AUTH_FILE): Promise<string> {
  // Refresh if token expires in less than 5 minutes
  const refreshThreshold = 5 * 60 * 1000
  const now = Date.now()

  if (credentials.copilotTokenExpiresAt - now > refreshThreshold) {
    return credentials.copilotToken
  }

  console.log('Refreshing Copilot token...')
  const newToken = await getCopilotToken(credentials.githubToken)

  // Update stored credentials
  credentials.copilotToken = newToken.token
  credentials.copilotTokenExpiresAt = newToken.expiresAt
  await saveCredentials(credentials, authFile)

  console.log('Copilot token refreshed')
  return newToken.token
}
