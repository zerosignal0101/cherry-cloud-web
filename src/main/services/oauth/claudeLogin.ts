import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { isMac } from '@main/core/platform'
import { getShellEnv } from '@main/utils/shellEnv'

const execFileAsync = promisify(execFile)

/**
 * Read-only probe of whether the operator already has a Claude Code subscription
 * login (Claude Pro/Max OAuth) usable by the Agent SDK. Never reads or stores the
 * credential value itself — only its presence.
 *
 * macOS: the OAuth token lives in the global login Keychain under the generic
 * password service `Claude Code-credentials` (independent of CLAUDE_CONFIG_DIR);
 * we query existence without `-w` so no secret is read and no ACL prompt fires.
 * Linux/Windows: it lives in `<CLAUDE_CONFIG_DIR>/.credentials.json` (default
 * `~/.claude`). A present token may still be expired — the SDK refreshes on use;
 * this is a best-effort "is the operator signed in" hint for the settings UI.
 */
export async function checkClaudeLogin(signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  if (isMac) {
    try {
      await execFileAsync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
        timeout: 3000,
        signal,
        killSignal: 'SIGKILL'
      })
      return true
    } catch (error) {
      signal?.throwIfAborted()
      if ((error as { code?: unknown }).code === 44) return false
      throw error
    }
  }
  try {
    // Resolve from the same source the runtime uses (settingsBuilder reads the
    // shell CLAUDE_CONFIG_DIR), not raw process.env: a GUI-launched Electron
    // process does not inherit rc-exported vars, so probing process.env alone
    // falsely reports "not signed in".
    const shellEnv = await getShellEnv(signal)
    const configDir =
      shellEnv.CLAUDE_CONFIG_DIR ||
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(application.getPath('sys.home'), '.claude')
    await fs.promises.access(path.join(configDir, '.credentials.json'))
    signal?.throwIfAborted()
    return true
  } catch (error) {
    signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
