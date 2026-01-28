// GitHub OAuth device flow + Copilot token exchange

const CLIENT_ID = 'Iv1.b507a08c87ecfe98' // GitHub Copilot client ID

export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export type CopilotToken = {
  token: string
  expiresAt: number // milliseconds
}

export async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: 'read:user',
    }),
  })

  if (!response.ok) {
    throw new Error(`Device flow initiation failed: ${response.statusText}`)
  }

  return response.json() as Promise<DeviceCodeResponse>
}

export async function pollForAccessToken(
  deviceCode: string,
  interval: number = 5
): Promise<string> {
  let pollInterval = interval

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data = (await response.json()) as {
      access_token?: string
      error?: string
    }

    if (data.access_token) {
      return data.access_token
    }

    if (data.error === 'authorization_pending') {
      continue
    }

    if (data.error === 'slow_down') {
      pollInterval += 5
      continue
    }

    throw new Error(`Authentication failed: ${data.error || 'Unknown error'}`)
  }
}

export async function getCopilotToken(githubToken: string): Promise<CopilotToken> {
  const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to get Copilot token: ${response.status} ${response.statusText} - ${text}`
    )
  }

  const data = (await response.json()) as {
    token: string
    expires_at: number
  }

  return {
    token: data.token,
    expiresAt: data.expires_at * 1000, // Convert to milliseconds
  }
}
