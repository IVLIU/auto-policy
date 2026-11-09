import { test, expect } from 'claude-code/testing'

const check = ($: any, command: string) => $.tool.check({ tool: 'Bash', input: { command } })

test('allows ordinary commands', async $ => {
  for (const command of ['ls -la', 'node scripts/fetch.js', 'git status', 'npm test', 'jq . a.json']) {
    expect((await check($, command)).decision).toBe('allow')
  }
})

test('allows the usual stderr redirections', async $ => {
  // `2>/dev/null` is in most shell lines; asking for it made every other call prompt.
  for (const command of [
    'ls .claude 2>/dev/null',
    'cat package.json 2>/dev/null | head -40',
    'grep -rn foo . 2> /dev/null',
    'node x.js > /dev/null',
    'node x.js >/dev/null 2>&1',
    'ls /dev/disk*',
  ]) {
    expect((await check($, command)).decision).toBe('allow')
  }
})

test('asks before writing a real device', async $ => {
  expect((await check($, 'echo x > /dev/mem')).decision).toBe('ask')
  expect((await check($, 'cat img > /dev/disk2')).decision).toBe('deny')
})

test('asks before irreversible git actions', async $ => {
  for (const command of ['git push origin main', 'git reset --hard HEAD~1', 'git clean -fd', 'git commit --amend', 'git branch -D old']) {
    expect((await check($, command)).decision).toBe('ask')
  }
})

test('asks before deleting, moving or escalating', async $ => {
  for (const command of ['rm -rf dist', 'mv a b', 'sudo ls', 'chmod +x run.sh', 'kill 1234']) {
    expect((await check($, command)).decision).toBe('ask')
  }
})

test('asks before reaching off the machine', async $ => {
  for (const command of ['curl https://example.com', 'ssh host', 'npx some-package', 'npm install -g x', 'pip install requests']) {
    expect((await check($, command)).decision).toBe('ask')
  }
})

test('asks before touching a credential', async $ => {
  for (const command of ['cat .ssh/id_rsa', 'cat .env', 'chmod 600 ~/.aws/credentials']) {
    expect((await check($, command)).decision).toBe('ask')
  }
})

test('denies what nobody means to type', async $ => {
  for (const command of ['rm -rf /', 'rm -rf / ']) {
    expect((await check($, command)).decision).toBe('deny')
  }
})

test('asks before writing outside the working directory', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home/u' }))

  const outside = await $.tool.check({ tool: 'Write', input: { file_path: '/etc/hosts' } })
  expect(outside.decision).toBe('ask')

  const inside = await $.tool.check({ tool: 'Write', input: { file_path: 'reports/today.md' } })
  expect(inside.decision).toBe('allow')
})
