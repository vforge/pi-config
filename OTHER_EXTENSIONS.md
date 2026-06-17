# Other Pi packages/extensions I use

Personal inventory of Pi packages/extensions used alongside `vforge-pi-config`.

This file is documentation only. It is **not** consumed by Pi and should not be treated as runtime config. Runtime loading still belongs in Pi's normal places:

- this package's own extensions: `package.json` → `pi.extensions`
- machine-local installed packages: `~/.pi/agent/settings.json` → `packages`
- project-local installed packages: `.pi/settings.json` → `packages`

## Currently used

| Name | Source | Type | Scope | Why I use it | Notes |
| --- | --- | --- | --- | --- | --- |
| `pi-emote` | <https://github.com/JarodMica/jarods-pi-extensions/tree/master/extensions/pi-emote> | extension | global | Adds emote/status flavor to Pi | From JarodMica's `jarods-pi-extensions` repo |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | package / extension | global | MCP adapter for Pi | Install with `pi install npm:pi-mcp-adapter` |
| _TODO_ | `npm:...` / `git:...` / local path | package / extension / skill / prompt / theme | global / project | _TODO_ | _TODO_ |

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

Prefer pinned git tags/commits for packages I expect to reproduce later.

## Maintenance commands

```bash
pi list
pi install npm:package
pi install git:github.com/user/repo@tag
pi remove npm:package
pi update --extensions
```
