/**
 * CWD Skills — Load skills from <cwd>/.skills/
 *
 * Discovers skill definitions in the current working directory's `.skills/`
 * folder and injects them into the system prompt so the LLM can use them.
 * Works in both local and SSH (remote) modes.
 *
 * ## Skill directory layout
 *
 * Supports two formats:
 *
 * ```
 * .skills/                          .skills/
 * ├── my-skill/                     ├── feature-a.md
 * │   └── SKILL.md                  ├── feature-b.md
 * └── another-skill/                └── feature-c.md
 *     └── SKILL.md
 * ```
 *
 * Subdirectory format: each subdirectory contains a `SKILL.md` file.
 * Flat format: `.md` files directly in `.skills/`.
 *
 * ## How it works
 *
 * ### Local mode
 * Uses Node.js `fs` to read skill files and injects their content into the
 * system prompt via `before_agent_start`.
 *
 * ### SSH mode
 * Detects SSH connection via ssh-state.ts (populated by ssh.ts). Reads skill
 * files over SSH using `spawnSync("ssh", ...)` and injects them into the
 * system prompt.
 *
 * ### Why before_agent_start instead of resources_discover?
 * The original approach used `resources_discover` to return skill paths for
 * pi's resource loader. This didn't work in SSH mode because:
 * 1. `event.cwd` is the local machine's cwd, not the remote one
 * 2. Node.js `fs` can't read files on a remote machine
 * 3. pi's resource loader also uses Node.js `fs` internally
 *
 * By using `before_agent_start`, we have access to:
 * - The system prompt (to detect SSH mode via ssh extension's cwd rewrite)
 * - The shared SSH config from ssh-state.ts
 * - The ability to modify the system prompt directly
 *
 * ## Related extensions
 *
 * - **ssh.ts** — Provides remote tool operations; publishes SSH config
 * - **ssh-state.ts** — Shared state module for cross-extension communication
 * - **list-skills.ts** — `/skills` command that lists skills from .skills/
 *
 * ## See also
 *
 * Pi's built-in skill locations:
 * - ~/.pi/agent/skills/
 * - ~/.agents/skills/
 * - .pi/skills/ (project, when trusted)
 * - .agents/skills/ (project, when trusted)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getSshConfig } from "./ssh/state";

const SKILLS_MARKER = "<!-- cwd-skills -->";
let skillsInjected = false;

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    // Inject only once per session, and skip if already present in prompt
    if (skillsInjected) return;
    if (event.systemPrompt.includes(SKILLS_MARKER)) return;

    // Detect SSH mode via shared state from ssh.ts
    const ssh = getSshConfig();

    let content: string;

    if (ssh) {
      // ── SSH mode: read skill files over SSH ──────────────────────
      const rawSkillsDir = path.join(ssh.remoteCwd, ".skills");
      const skillsDir = JSON.stringify(rawSkillsDir);
      // Find SKILL.md in subdirectories and read their content
      const cmd = `test -d ${skillsDir} && while IFS= read -r f; do dir="\$(dirname "$f" | sed 's|${rawSkillsDir}/||')"; echo "=== $dir ==="; cat "$f"; echo; done < <(find ${skillsDir} \\( -name "SKILL.md" -o -name "skill.md" \\) -type f 2>/dev/null | sort)`;
      const result = spawnSync("ssh", [ssh.remote, cmd], {
        encoding: "utf8",
        timeout: 10000,
      });

      if (result.error || result.status !== 0 || !result.stdout?.trim()) {
        return;
      }

      content = result.stdout.trim();
    } else {
      // ── Local mode: read skill files via Node.js fs ──────────────
      const cwdPath = event.systemPrompt.match(/Current working directory: (\S+)/)?.[1] ?? process.cwd();
      const cwdSkills = path.join(cwdPath, ".skills");

      try {
        const entries = fs.readdirSync(cwdSkills);
        const parts: string[] = [];

        // Check subdirectories for SKILL.md (standard skill format)
        for (const entry of entries.sort()) {
          const entryPath = path.join(cwdSkills, entry);
          if (!fs.statSync(entryPath).isDirectory()) continue;
          for (const name of ["SKILL.md", "skill.md"]) {
            const skillFile = path.join(entryPath, name);
            if (fs.existsSync(skillFile)) {
              parts.push(`=== ${entry} ===\n${fs.readFileSync(skillFile, "utf8")}`);
              break;
            }
          }
        }

        // Also check for .md files at top level
        for (const entry of entries.sort()) {
          if (entry.endsWith(".md")) {
            parts.push(`=== ${entry} ===\n${fs.readFileSync(path.join(cwdSkills, entry), "utf8")}`);
          }
        }

        if (parts.length === 0) return;
        content = parts.join("\n\n");
      } catch {
        return;
      }
    }

    // ── Inject skills into system prompt ───────────────────────────
    if (!content) return;

    skillsInjected = true;
    const injected = `\n${SKILLS_MARKER}\n## Skills from .skills/\n\n${content}\n`;
    return { systemPrompt: event.systemPrompt + injected };
  });

  // Reset injection flag on session start (new session, reload, etc.)
  pi.on("session_start", () => {
    skillsInjected = false;
  });
}
