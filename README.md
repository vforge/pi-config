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

```bash
pi --ssh user@host
pi --ssh user@host:/remote/path
pissh user@host:/remote/path
```

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
