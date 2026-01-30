// Validation utilities

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Check if Copilot CLI is installed and accessible
 */
export async function isCopilotCLIAvailable(copilotPath = 'copilot'): Promise<boolean> {
  try {
    await execAsync(`${copilotPath} --version`)
    return true
  } catch {
    return false
  }
}
