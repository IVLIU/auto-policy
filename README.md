<div align="center">

# Auto Policy

**Auto mode, without the prompts.**

[![license](https://img.shields.io/github/license/IVLIU/auto-policy?style=flat-square&color=9FB49B)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.0-C2A2A0?style=flat-square)](.claude-plugin/plugin.json)

</div>

Claude Code's auto mode asks a classifier, running on Anthropic's servers, whether each tool call may proceed. Point `ANTHROPIC_BASE_URL` at a gateway that does not forward that call — DeepSeek, and most third-party relays — and the classifier never answers. Every action falls back to a permission prompt, and auto mode stops being automatic.

**Auto Policy** answers locally instead. It hooks `tool.check`, the event that fires after the `PreToolUse` hooks and before the mode settles an ask, and returns a verdict itself:

- ordinary commands, file edits inside the working directory, searches and MCP tools → **allow**
- irreversible, off-machine, or credential-touching actions → **ask**
- a filesystem-root wipe, a fork bomb, a raw-device write → **deny**

An allowed call never reaches the classifier, so nothing prompts.

## Install

```
/plugin marketplace add IVLIU/auto-policy
/plugin install auto-policy@auto-policy
```

Restart Claude Code, then check that `/permissions` shows auto mode.

## What it asks about

Deletes and moves; `sudo`; `launchctl` and `crontab`; `chmod`/`chown`; `kill`/`pkill`; `curl`, `wget`, `ssh`, `scp`, `rsync`; `npx` and global installs; `git push`, `reset --hard`, `clean`, `rebase`, `commit --amend`, branch and tag deletion, remote rewrites; reads and writes of `.ssh`, `.aws`, `.gnupg`, `.env`, `.npmrc`, `.netrc`, `id_rsa`; writes outside the session's working directory except under `~/.claude` and `/tmp`.

The lists live in `hooks/register.tsx` as `RISKY` and `HARD`. Edit them and restart Claude Code.

## Scope

This trades the server-side classifier for a small local ruleset. It is closer to `bypassPermissions` in reach than to the real classifier, and the `RISKY` list is the only thing standing between auto mode and the whole machine. If that trade is not what you want, do not install it.

It cannot loosen anything the engine requires a person for: plan approval and `AskUserQuestion` still show their dialogs.

## License

MIT
