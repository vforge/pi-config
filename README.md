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
- `web-tools` — adds `web_search` and `fetch_url` tools backed by SearXNG/fetch.

## Environment

Copy `.env.example` somewhere private or export the variables in your shell:

```bash
export SEARXNG_URL=http://localhost:8080
export LLAMACPP_BASE_URL=http://localhost:1234/v1
export LLAMACPP_API_KEY=dummy
```

`web-tools` uses `SEARXNG_URL`, defaulting to `http://localhost:8080`.

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

## Machine-local files not included

Do not commit/copy these from `~/.pi/agent`:

- `auth.json`
- `.env`
- `trust.json`
- `sessions/`
- `bin/`
- package `node_modules/`

Use `settings.example.json` and `models.example.json` as templates for machine-local Pi config.
