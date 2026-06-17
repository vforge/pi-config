# Other Pi packages/extensions I use

Personal inventory of Pi packages/extensions used alongside `vforge-pi-config`.

This file is documentation only. It is **not** consumed by Pi and should not be treated as runtime config. Runtime loading still belongs in Pi's normal places:

- this package's own extensions: `package.json` → `pi.extensions`
- machine-local installed packages: `~/.pi/agent/settings.json` → `packages`
- project-local installed packages: `.pi/settings.json` → `packages`

## Currently used

| Name | Source | Type | Scope | Why I use it | Notes |
| --- | --- | --- | --- | --- | --- |
| `vforge/pi-config` | `git:git@github.com:vforge/pi-config.git` | package / extension | global | My personal Pi config — ssh, cwd-skills, list-skills, web-tools | Local dev repo; contains all my custom extensions |
| `pi-emote` | `git:github.com/cgxeiji/pi-emote` | extension | global | Adds emote/status flavor to Pi | Fork of JarodMica's extension |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | package / extension | global | MCP adapter for Pi | Connects MCP servers (filesystem, github) via proxy tool |
| `@juicesharp/rpiv-btw` | `npm:@juicesharp/rpiv-btw` | package / extension | global | BTW (by-the-way) skill | Quick contextual notes |
| `@juicesharp/rpiv-todo` | `npm:@juicesharp/rpiv-todo` | package / extension | global | Todo management skill | Task tracking within sessions |
| `@juicesharp/rpiv-ask-user-question` | `npm:@juicesharp/rpiv-ask-user-question` | package / extension | global | Ask user questions interactively | Structured decision prompts |
| `pi-subagents` | `npm:pi-subagents` | package / extension | global | Sub-agent orchestration for Pi | oracle, planner, researcher, reviewer, scout, worker |

## Trying / evaluating

| Name | Source | Type | Why I'm interested | Decision / follow-up |
| --- | --- | --- | --- | --- |
| _TODO_ | `npm:...` / `git:...` / local path | package / extension / skill / prompt / theme | _TODO_ | _TODO_ |

## Not using / rejected

| Name | Source | Reason |
| --- | --- | --- |
| _TODO_ | `npm:...` / `git:...` / local path | _TODO_ |

## Source format reminders

```text
npm:@scope/package@1.2.3
npm:package
git:github.com/user/repo@tag-or-commit
git:git@github.com:user/repo@tag-or-commit
/absolute/local/path
./relative/local/path
```

Packages are updated frequently — no version pins needed.

## Maintenance commands

```bash
pi list
pi install npm:package
pi install git:github.com/user/repo@tag
pi remove npm:package
pi update --extensions
```
