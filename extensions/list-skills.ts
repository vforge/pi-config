/**
 * List Skills — `/skills` command
 *
 * Lists all active skills, including those loaded from the current working
 * directory's `.skills/` folder. Works in both local and SSH (remote) modes,
 * and supports interactive (TUI), print (`-p`), and RPC output modes.
 *
 * ## Usage
 *
 * ```bash
 * pi "/skills"              # Interactive mode — shows skills in a widget panel
 * pi -p "/skills"           # Print mode — outputs to stdout
 * pissh user@host:/path -p "/skills"   # SSH mode with descriptions
 * ```
 *
 * ## Output format
 *
 * ```
 * Loaded skills:
 *   • my-global-skill — Description from pi's native Skill.description field
 *
 * Skills from .skills/:
 *   • huggingface-download — Use this skill when the user wants a Hugging Face model repo mirrored...
 *   • huggingface-index — Use this skill to regenerate the local collection index for the...
 *
 * 3 skill(s) loaded
 * ```
 *
 * Each skill shows its name and a one-line description. For pi-loaded skills,
 * uses the `Skill.description` field. For `.skills/` skills, extracts the first
 * paragraph after the title heading from SKILL.md (matching how pi's native
 * resource loader parses skill descriptions).
 *
 * ## How it works
 *
 * ### SSH detection
 * Uses `getSshConfig()` from ssh-state.ts to check if we're connected via SSH.
 * In SSH mode, finds skill files over SSH then reads each one for its description.
 *
 * ### Skill discovery
 * Looks for both formats:
 * - Subdirectories containing `SKILL.md` or `skill.md` (standard format)
 * - `.md` files directly in `.skills/` (flat format)
 *
 * ### Description extraction
 * For `.skills/` skills, extracts the first paragraph after the `# Title`
 * heading from each SKILL.md. Strips bold/italic/code markdown formatting
 * and truncates to 140 characters. Matches how pi's native resource loader
 * populates the `Skill.description` field.
 *
 * For pi-loaded skills (from ~/.pi/agent/skills/, .pi/skills/, etc.), uses
 * the `Skill.description` property directly from `getSystemPromptOptions()`.
 *
 * ### Output modes
 * - **TUI mode**: Uses `ctx.ui.setWidget()` with auto-clear on next input.
 * - **Print mode**: Uses `console.log()` for stdout output.
 *
 * ## Related extensions
 *
 * - **cwd-skills.ts** — Loads and injects .skills/ content into system prompt
 * - **ssh.ts** — Provides remote tool operations; publishes SSH config
 * - **ssh-state.ts** — Shared state module for cross-extension communication
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getSshConfig } from "./ssh/state";

let showWidget = false;

/**
 * Extract a one-line description from markdown skill content.
 * Takes the first paragraph after the title heading, strips formatting,
 * and truncates to max 140 chars.
 */
function extractDescription(content: string): string {
  const withoutTitle = content.replace(/^#\s+.+$/m, '').trimStart();
  const match = withoutTitle.match(/^(.+?)(?=\n\n(?:[#`*-]|---))/s);
  if (match) {
    let desc = match[1].trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    desc = desc.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1');
    return desc.slice(0, 140);
  }
  const firstLine = content.split('\n')[0].replace(/^#\s*/, '').trim();
  return firstLine.slice(0, 140);
}

/** Run a command over SSH and return stdout, or null on failure. */
function sshRun(remote: string, cmd: string, timeout = 5000): string | null {
  const r = spawnSync("ssh", [remote, cmd], { encoding: "utf8", timeout });
  if (r.error || r.status !== 0) return null;
  return r.stdout?.trim() ?? null;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("skills", {
    description: "List all active skills",
    handler: async (_args, ctx) => {
      const lines: string[] = [];

      // ── Show skills loaded by pi's resource loader ────────────────
      const options = ctx.getSystemPromptOptions();
      const loadedSkills = options.skills ?? [];
      if (loadedSkills.length > 0) {
        lines.push("Loaded skills:");
        for (const skill of loadedSkills) {
          const name = skill.name ?? "(unnamed)";
          const desc = skill.description?.slice(0, 120) ?? "";
          lines.push(`  \u2022 ${name}${desc ? ` \u2014 ${desc}` : ""}`);
        }
      }

      // ── Discover skills from .skills/ with descriptions ───────────
      const ssh = getSshConfig();
      interface SkillEntry { name: string; desc?: string; }
      let cwdSkills: SkillEntry[] = [];

      if (ssh) {
        // SSH mode: find skill files, then read each for description
        const skillsDir = path.join(ssh.remoteCwd, ".skills");
        const quotedDir = JSON.stringify(skillsDir);
        const fileList = sshRun(ssh.remote,
          `find ${quotedDir} -maxdepth 2 \\( -name "SKILL.md" -o -name "skill.md" \\) -type f 2>/dev/null | sort`);

        if (fileList) {
          for (const filePath of fileList.split("\n").filter(Boolean)) {
            const name = path.dirname(filePath).replace(skillsDir + "/", "");
            // Extract first paragraph after title heading
            const descRaw = sshRun(ssh.remote,
              `sed -n '1{/^# /d}; /^# /q; p' ${JSON.stringify(filePath)} | head -3 | tr '\\n' '~' | head -c 200`);
            const desc = descRaw?.replace(/~/g, " ").trim().slice(0, 140);
            cwdSkills.push({ name, desc: desc || undefined });
          }
        }
      } else {
        // Local mode: read skill files and extract descriptions
        const cwdSkillsPath = path.join(ctx.cwd, ".skills");
        try {
          const entries = fs.readdirSync(cwdSkillsPath);
          for (const entry of entries.sort()) {
            const entryPath = path.join(cwdSkillsPath, entry);
            if (fs.statSync(entryPath).isDirectory()) {
              for (const fileName of ["SKILL.md", "skill.md"]) {
                const skillFile = path.join(entryPath, fileName);
                if (fs.existsSync(skillFile)) {
                  cwdSkills.push({ name: entry, desc: extractDescription(fs.readFileSync(skillFile, "utf8")) });
                  break;
                }
              }
            } else if (entry.endsWith(".md")) {
              cwdSkills.push({ name: entry, desc: extractDescription(fs.readFileSync(path.join(cwdSkillsPath, entry), "utf8")) });
            }
          }
        } catch { /* no .skills/ directory */ }
      }

      // ── Show skills from .skills/ with descriptions ───────────────
      if (cwdSkills.length > 0) {
        lines.push("");
        lines.push("Skills from .skills/:");
        for (const skill of cwdSkills) {
          const display = skill.name.replace(/\.md$/, "");
          const desc = skill.desc ? ` \u2014 ${skill.desc}` : "";
          lines.push(`  \u2022 ${display}${desc}`);
        }
      }

      // ── Output: print mode → stdout, TUI mode → widget + notify ──
      if (lines.length === 0) {
        if (ctx.mode === "print") console.log("No skills loaded.");
        else ctx.ui.notify("No skills loaded.", "info");
        return;
      }

      const totalSkills = loadedSkills.length + cwdSkills.length;
      if (ctx.mode === "print") {
        console.log(lines.join("\n"));
        console.log(`\n${totalSkills} skill(s) loaded`);
      } else {
        showWidget = true;
        ctx.ui.setWidget("list-skills", lines);
        ctx.ui.notify(`${totalSkills} skill(s) loaded`, "info");
      }
    },
  });

  // Clear the widget on next user input so it doesn't stick around
  pi.on("input", (_event, ctx) => {
    if (showWidget) {
      showWidget = false;
      ctx.ui.setWidget("list-skills", undefined);
    }
  });
}
