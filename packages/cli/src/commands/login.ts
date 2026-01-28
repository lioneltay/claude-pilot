// Login command - GitHub device flow authentication

import {
  initiateDeviceFlow,
  pollForAccessToken,
  getCopilotToken,
  saveCredentials,
  loadCredentials,
} from '@claude-pilot/proxy'
import { AUTH_FILE } from '../config.js'

export async function login(): Promise<void> {
  console.log('Claude Pilot - GitHub Copilot Authentication\n')

  // Check if already authenticated
  const existing = await loadCredentials(AUTH_FILE)
  if (existing) {
    console.log('Existing credentials found.')
    console.log(`To re-authenticate, delete ${AUTH_FILE}\n`)

    // Test if token still works
    try {
      const token = await getCopilotToken(existing.githubToken)
      console.log('✓ Credentials are valid')
      console.log(`  Copilot token expires: ${new Date(token.expiresAt).toLocaleString()}`)
      return
    } catch {
      console.log('✗ Credentials are invalid, re-authenticating...\n')
    }
  }

  // Start device flow
  console.log('Starting GitHub OAuth device flow...\n')
  const deviceCode = await initiateDeviceFlow()

  console.log('Please visit:', deviceCode.verification_uri)
  console.log('And enter code:', deviceCode.user_code)
  console.log('\nWaiting for authorization...')

  // Poll for access token
  const githubToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval
  )
  console.log('\n✓ GitHub authentication successful')

  // Exchange for Copilot token
  console.log('Exchanging for Copilot token...')
  const copilotToken = await getCopilotToken(githubToken)
  console.log('✓ Copilot token obtained')

  // Save credentials
  await saveCredentials({
    githubToken,
    copilotToken: copilotToken.token,
    copilotTokenExpiresAt: copilotToken.expiresAt,
  }, AUTH_FILE)

  console.log(`\n✓ Credentials saved to ${AUTH_FILE}`)
  console.log('\nYou can now start the proxy with: claude-pilot start')
}
