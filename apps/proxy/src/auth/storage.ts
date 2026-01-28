// Credential storage and token refresh

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCopilotToken, type CopilotToken } from './github.js'

const CONFIG_DIR = join(homedir(), '.config', 'claude-proxy')
const AUTH_FILE = join(CONFIG_DIR, 'auth.json')

export type StoredCredentials = {
  githubToken: string
  copilotToken: string
  copilotTokenExpiresAt: number
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const data = await readFile(AUTH_FILE, 'utf-8')
    return JSON.parse(data) as StoredCredentials
  } catch {
    return null
  }
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(AUTH_FILE, JSON.stringify(credentials, null, 2))
}

export async function getValidCopilotToken(credentials: StoredCredentials): Promise<string> {
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
  await saveCredentials(credentials)

  console.log('Copilot token refreshed')
  return newToken.token
}
