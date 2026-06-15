/**
 * SSH State — Shared configuration between extensions
 *
 * Provides a way for ssh.ts, cwd-skills.ts, and list-skills.ts to share
 * the resolved SSH connection details (remote host + working directory).
 *
 * ## Why this module exists
 *
 * Pi loads extensions via jiti, which compiles each .ts file independently.
 * Imported modules get separate instances per extension, so a plain shared
 * variable won't work across extensions. This module uses the global
 * `process` object with a Symbol.for key to guarantee all extensions see
 * the same state regardless of jiti's module caching behavior.
 *
 * ## How it works
 *
 * 1. ssh.ts resolves the --ssh flag in its session_start handler and calls
 *    setSshConfig({ remote, remoteCwd }).
 * 2. cwd-skills.ts and list-skills.ts call getSshConfig() to check whether
 *    we're in SSH mode and get the connection details.
 *
 * ## Usage
 *
 * ```typescript
 * import { getSshConfig, setSshConfig } from "./ssh-state";
 *
 * // In ssh.ts (session_start handler):
 * setSshConfig({ remote: "user@host", remoteCwd: "/remote/path" });
 *
 * // In cwd-skills.ts or list-skills.ts:
 * const ssh = getSshConfig();
 * if (ssh) {
 *   // SSH mode — use ssh.remote and ssh.remoteCwd
 * } else {
 *   // Local mode
 * }
 * ```
 */

const KEY = Symbol.for("pi-ssh-config");

/** SSH connection details set by the ssh extension. */
export interface SshConfig {
  /** SSH target, e.g. "user@host" */
  remote: string;
  /** Remote working directory, e.g. "/home/user/project" */
  remoteCwd: string;
}

/** Store resolved SSH config (called by ssh.ts on session_start). */
export function setSshConfig(config: SshConfig | null): void {
  (process as any)[KEY] = config;
}

/** Retrieve SSH config (called by cwd-skills.ts and list-skills.ts). */
export function getSshConfig(): SshConfig | null {
  return (process as any)[KEY] ?? null;
}

// No-op default export so pi doesn't complain when auto-discovering this file
export default function (_pi: any) {}
