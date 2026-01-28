// Dashboard command - Open browser to dashboard

import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { isDaemonRunning } from '../daemon.js'

export async function dashboard(): Promise<void> {
  const { running, state } = await isDaemonRunning()

  if (!running || !state) {
    console.log('Proxy is not running')
    console.log("Run 'claude-pilot start' first")
    return
  }

  const url = `http://localhost:${state.port}`
  console.log(`Opening dashboard at ${url}`)

  // Open browser based on platform
  const os = platform()
  let cmd: string

  if (os === 'darwin') {
    cmd = `open "${url}"`
  } else if (os === 'linux') {
    cmd = `xdg-open "${url}"`
  } else {
    console.log(`Please open ${url} in your browser`)
    return
  }

  exec(cmd, (error) => {
    if (error) {
      console.log(`Could not open browser automatically`)
      console.log(`Please open ${url} in your browser`)
    }
  })
}
