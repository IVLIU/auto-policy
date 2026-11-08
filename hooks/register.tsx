import type { Register } from 'claude-code'

/**
 * auto-policy — a local permission policy for auto mode.
 *
 * Auto mode hands every tool call to a classifier that runs on Anthropic's
 * servers. When ANTHROPIC_BASE_URL points at a gateway that does not forward
 * that call (DeepSeek, and most third-party relays), the classifier never
 * answers and every action falls back to a permission prompt — auto mode stops
 * being automatic.
 *
 * This mod answers at `tool.check`, which fires after the PreToolUse hooks and
 * before the mode settles an ask. A call it allows never reaches the
 * classifier. A call it does not recognise as safe still goes to a person.
 *
 * What it is not: a blanket allow. RISKY keeps every irreversible or
 * off-machine action on the asking side.
 */

type Decision = { decision: 'allow' | 'ask' | 'deny'; reason?: string }

const ALLOW: Decision = { decision: 'allow' }
const ask = (reason: string): Decision => ({ decision: 'ask', reason })

/** Refused outright: nothing a person means to type. */
const HARD: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[;&|(]\s*)rm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(\s|$)/, 'refuses to delete the filesystem root'],
  [/:\(\)\s*\{.*\};?\s*:/, 'refuses a fork bomb'],
  [/>\s*\/dev\/(disk|rdisk|sd|hd)/, 'refuses to write a raw device'],
]

/** Sent to a person. Irreversible, off-machine, or touching a credential. */
const RISKY: ReadonlyArray<readonly [RegExp, string]> = [
  // credentials first, so `cat .ssh/id_rsa` reports the right reason
  [/\.ssh\/|\.aws\/|\.gnupg\/|(^|[\s'"/])\.(env|netrc|npmrc)\b|id_rsa\b|id_ed25519\b|\.pem\b/, 'touches a credential file'],

  // delete / move
  [/(^|[;&|(]\s*)(rm|rmdir|unlink)\s/, 'deletes files'],
  [/(^|[;&|(]\s*)mv\s/, 'moves files (the source may be lost)'],
  [/\b(shred|truncate)\b/, 'erases unrecoverably'],
  [/\bfind\b.*(-delete\b|-exec\s+(rm|rmdir))/, 'find with bulk delete'],
  [/\bxargs\b[^|]*\b(rm|rmdir)\b/, 'xargs with bulk delete'],

  // privilege / system state
  [/\b(sudo|doas)\b/, 'escalates privileges'],
  [/\b(dd|mkfs\w*|shutdown|reboot|halt|diskutil|hdiutil)\b/, 'disk or power operation'],
  [/\b(launchctl|crontab|at)\s/, 'installs a persistent job'],
  [/\b(systemsetup|networksetup|sysctl|csrutil|spctl|chflags)\b/, 'changes system configuration'],
  [/\bdefaults\s+write\b/, 'writes system preferences'],
  [/\b(pkill|killall)\b|\bkill\b/, 'ends a process'],
  [/\bsecurity\b/, 'reads the keychain'],

  // git history / remote
  [/\bgit\s+push\b/, 'pushes to a remote'],
  [/\bgit\s+reset\s+--hard\b/, 'discards uncommitted work'],
  [/\bgit\s+clean\b/, 'deletes untracked files'],
  [/\bgit\s+(checkout|restore)\s+(\.\s*$|\.\s|--\s)/, 'discards changes'],
  [/\bgit\s+(rebase|filter-branch|filter-repo|commit\s+--amend)\b/, 'rewrites history'],
  [/\bgit\s+branch\s+(-D|--delete\s+--force)\b/, 'deletes a branch'],
  [/\bgit\s+tag\s+-d\b/, 'deletes a tag'],
  [/\bgit\s+stash\s+(drop|clear)\b/, 'drops a stash'],
  [/\bgit\s+remote\s+(add|remove|rm|set-url)\b/, 'changes a remote'],
  [/\bgit\s+reflog\s+expire\b|\bgit\s+update-ref\b/, 'expires references'],

  // network / install
  [/\b(curl|wget)\b/, 'makes an external request'],
  [/\b(nc|ncat|telnet|socat)\b/, 'opens a raw network connection'],
  [/\b(ssh|scp|rsync)\b/, 'reaches another machine'],
  [/\b(npx|bunx|pnpx)\b/, 'runs a remote package'],
  [/\b(npm|pnpm|yarn|bun)\s+(publish|(add|i|install)\s+(-g|--global))\b/, 'publishes or installs a package globally'],
  [/\b(pip|pip3)\s+install\b|\b(brew|cargo|gem|go)\s+install\b/, 'installs dependencies'],

  // permissions
  [/\b(chmod|chown)\b/, 'changes ownership or mode'],

  // executing foreign content
  [/\|\s*(sh|bash|zsh)\b/, 'pipes into a shell'],
  [/\beval\b/, 'evaluates a string'],
  [/>\s*\/dev\//, 'writes a device'],

  // gui
  [/\bosascript\b/, 'drives another app'],
]

/** Written or read as-is only after a person says so. */
const SENSITIVE =
  /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gh)\/|(^|\/)\.(env|netrc|npmrc|pgpass)(\.|$)|(^|\/)id_(rsa|ed25519)\b|\.pem$|(^|\/)credentials?(\.|$)/i

const norm = (p: string): string => p.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')

const inside = (p: string, cwd: string): boolean => {
  if (!p.startsWith('/')) return true
  const n = norm(p)
  const c = norm(cwd)
  return n === c || n.startsWith(`${c}/`)
}

const exempt = (p: string, home: string): boolean =>
  [`${home}/.claude`, '/tmp', '/private/tmp'].some(d => p === d || p.startsWith(`${d}/`))

export const register: Register = on => {
  on('tool.check', async ($, e) => {
    const input = (e.input ?? {}) as Record<string, unknown>

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const cmd = String(input.command ?? '')
      for (const [re, why] of HARD) if (re.test(cmd)) return { decision: 'deny', reason: why }
      for (const [re, why] of RISKY) if (re.test(cmd)) return ask(why)
      return ALLOW
    }

    const file = String(input.file_path ?? input.notebook_path ?? '')
    if (!file) return ALLOW
    if (SENSITIVE.test(file)) return ask('touches a credential file')

    if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') {
      const cwd = await $.session.cwd()
      const home = (await $.env.get('HOME')) ?? ''
      if (!inside(file, cwd) && !exempt(norm(file), home)) return ask('writes outside the working directory')
    }

    return ALLOW
  }).catch(() => ask('auto-policy failed to decide; asking a person'))
}
