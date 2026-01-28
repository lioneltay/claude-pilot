// CLI for initial authentication

import { initiateDeviceFlow, pollForAccessToken, getCopilotToken } from './github.js'
import { saveCredentials, loadCredentials } from './storage.js'

async function main() {
  console.log('Claude Proxy - GitHub Copilot Authentication\n')

  // Check if already authenticated
  const existing = await loadCredentials()
  if (existing) {
    console.log('Existing credentials found.')
    console.log('To re-authenticate, delete ~/.config/claude-proxy/auth.json\n')

    // Test if token still works
    try {
      const token = await getCopilotToken(existing.githubToken)
      console.log('✓ Credentials are valid')
      console.log(`  Copilot token expires: ${new Date(token.expiresAt).toLocaleString()}`)
      return
    } catch (error) {
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
  })

  console.log('\n✓ Credentials saved to ~/.config/claude-proxy/auth.json')
  console.log('\nYou can now run the proxy with: pnpm dev')
}

main().catch((error) => {
  console.error('Authentication failed:', error.message)
  process.exit(1)
})
