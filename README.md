# vforge-pi-config

Personal Pi package for reusable extensions and workflow helpers.

## Install

```bash
pi install git:git@github.com:vforge/pi-config
```

For local development:

```bash
pi -e ~/Developer/vforge/pi-config
pi install ~/Developer/vforge/pi-config
```

After changing extensions in an active Pi session, run:

```text
/reload
```

## Included extensions

- `ssh` — adds `--ssh user@host[:/path]` and routes built-in tools over SSH:
  - `read`
  - `write`
  - `edit`
  - `bash`
  - `grep`
  - `find`
  - `ls`
  - user `!` commands
- `cwd-skills` — injects skills from `<cwd>/.skills/`, including SSH remote cwd.
- `list-skills` — adds `/skills` command for loaded skills and `.skills/` skills.
- `web-tools` — adds web tools backed by SearXNG, fetch, and local Firecrawl:
  - `web_search`
  - `fetch_url`
  - `web_extract`

## Environment

Copy `.env.example` somewhere private or export the variables in your shell:

```bash
export SEARXNG_URL=http://localhost:8080
export FIRECRAWL_URL=http://localhost:3002
export LLAMACPP_BASE_URL=http://localhost:1234/v1
export LLAMACPP_API_KEY=dummy
```

`web-tools` uses:

- `SEARXNG_URL`, defaulting to `http://localhost:8080`
- `FIRECRAWL_URL`, defaulting to `http://localhost:3002`

## SSH usage

The `ssh` extension adds a Pi flag:

```bash
pi --ssh user@host
pi --ssh user@host:/remote/path
```

When `--ssh` is set, Pi still runs locally, but the built-in tools operate on the remote machine:

- `read`, `write`, `edit`
- `bash` and user `!` commands
- `grep`, `find`, `ls`

### `pissh` dotfiles wrapper

My dotfiles include a small convenience wrapper at `~/.dotfiles/bin/pissh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") user@host[:/remote/path] [additional pi args...]" >&2
  echo "Example: $(basename "$0") dev@mybox:/srv/app" >&2
  exit 1
fi

remote="$1"
shift || true

exec pi --ssh "$remote" "$@"
```

Usage:

```bash
pissh user@host
pissh user@host:/remote/path
pissh user@host:/remote/path -p "/skills"
pissh user@host:/remote/path -p "List files, find TypeScript files, and grep for TODO"
```

`pissh` is not installed by this Pi package; it comes from `vforge/dotfiles` and must be on `PATH`. It simply forwards its first argument to `pi --ssh` and passes all remaining arguments through to Pi.

Remote requirements:

- SSH key auth; no interactive password prompts
- `bash`
- `rg` for the remote `grep` tool

## Other installed packages

Beyond this package's own extensions, the following third-party packages are installed globally:

| Package | Source | Purpose |
| --- | --- | --- |
| `pi-emote` | `git:github.com/cgxeiji/pi-emote` | Emote/status flavor |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | MCP server proxy (filesystem, github) |
| `@juicesharp/rpiv-btw` | `npm:@juicesharp/rpiv-btw` | BTW contextual notes skill |
| `@juicesharp/rpiv-todo` | `npm:@juicesharp/rpiv-todo` | Todo management skill |
| `@juicesharp/rpiv-ask-user-question` | `npm:@juicesharp/rpiv-ask-user-question` | Interactive user questions |
| `pi-subagents` | `npm:pi-subagents` | Sub-agent orchestration (oracle, planner, researcher, etc.) |
| `pi-goal-x` | `npm:pi-goal-x` | Goal management |
| `pi-token-usage` | `npm:pi-token-usage` | Token usage tracking |
| `@latent-variable/pi-auto-continue` | `npm:@latent-variable/pi-auto-continue` | Auto-continue sessions |
| `@koltmcbride/pi-loop` | `npm:@koltmcbride/pi-loop` | Scheduled/repeating task loops |

These are managed via `pi install` and tracked in `~/.pi/agent/settings.json` → `packages`.

## Machine-local files not included

Do not commit/copy these from `~/.pi/agent`:

- `auth.json`
- `.env`
- `trust.json`
- `sessions/`
- `bin/`
- package `node_modules/`

Use `settings.example.json` and `models.example.json` as templates for machine-local Pi config.

## Model choices

The default in `settings.example.json` uses a **local-first** profile (Qwen 3.6 27B via llama.cpp) for privacy and low latency:

```json
{
  "defaultProvider": "local-openai",
  "defaultModel": "qwen3.6-27b-balanced",
  "defaultThinkingLevel": "medium",
  "theme": "dark"
}
```

To switch to a **cloud-first** profile (GPT-5.5 via GitHub Copilot) for stronger reasoning and higher output limits, update `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "github-copilot",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "medium",
  "theme": "dark"
}
```
