/**
 * SSH Remote Execution
 *
 * Delegates tool operations to a remote machine via SSH. When --ssh is provided,
 * all built-in file/search/shell tools run on the remote host.
 *
 * ## Usage
 *
 * ```bash
 * pi --ssh user@host                         # uses remote $HOME
 * pi --ssh user@host:/remote/path            # uses explicit path
 * pissh user@host:/remote/path -p "/skills"  # single-line via wrapper script
 * ```
 *
 * ## Requirements
 *
 * - SSH key-based auth (no password prompts)
 * - bash on remote
 * - rg on remote for the grep tool
 *
 * ## Architecture
 *
 * This extension wraps pi's built-in tools with remote operations. When the
 * --ssh flag is provided, read/write/edit/bash/grep/find/ls execute over SSH
 * instead of locally.
 *
 * The resolved SSH config ({ remote, remoteCwd }) is published via ssh-state.ts
 * so that other extensions (cwd-skills, list-skills) can detect SSH mode and
 * read files from the remote machine. See ssh-state.ts for details.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import type {
	BashOperations,
	EditOperations,
	ExtensionAPI,
	FindOperations,
	GrepOperations,
	LsOperations,
	ReadOperations,
	WriteOperations,
} from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { setSshConfig } from "./state";

function shQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isWithin(base: string, candidate: string): boolean {
	return candidate === base || candidate.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
}

function toRemotePath(p: string, remoteCwd: string, localCwd: string): string {
	if (p === remoteCwd || p.startsWith(`${remoteCwd}/`)) return p;
	if (isWithin(localCwd, p)) return `${remoteCwd}${p.slice(localCwd.length)}`;
	return p;
}

function toLocalPath(p: string, remoteCwd: string, localCwd: string): string {
	if (isWithin(remoteCwd, p)) return `${localCwd}${p.slice(remoteCwd.length)}`;
	return p;
}

function resolveLocalPath(p: string | undefined, localCwd: string): string {
	if (!p || p === ".") return localCwd;
	return path.isAbsolute(p) ? p : path.resolve(localCwd, p);
}

function sshExec(remote: string, command: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn("ssh", [remote, command], { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		const errChunks: Buffer[] = [];
		child.stdout.on("data", (data) => chunks.push(data));
		child.stderr.on("data", (data) => errChunks.push(data));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`SSH failed (${code}): ${Buffer.concat(errChunks).toString()}`));
			} else {
				resolve(Buffer.concat(chunks));
			}
		});
	});
}

function createRemoteReadOps(remote: string, remoteCwd: string, localCwd: string): ReadOperations {
	const toRemote = (p: string) => toRemotePath(p, remoteCwd, localCwd);
	return {
		readFile: (p) => sshExec(remote, `cat ${shQuote(toRemote(p))}`),
		access: (p) => sshExec(remote, `test -r ${shQuote(toRemote(p))}`).then(() => {}),
		detectImageMimeType: async (p) => {
			try {
				const r = await sshExec(remote, `file --mime-type -b ${shQuote(toRemote(p))}`);
				const m = r.toString().trim();
				return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m) ? m : null;
			} catch {
				return null;
			}
		},
	};
}

function createRemoteWriteOps(remote: string, remoteCwd: string, localCwd: string): WriteOperations {
	const toRemote = (p: string) => toRemotePath(p, remoteCwd, localCwd);
	return {
		writeFile: async (p, content) => {
			const b64 = Buffer.from(content).toString("base64");
			await sshExec(remote, `printf %s ${shQuote(b64)} | base64 -d > ${shQuote(toRemote(p))}`);
		},
		mkdir: (dir) => sshExec(remote, `mkdir -p ${shQuote(toRemote(dir))}`).then(() => {}),
	};
}

function createRemoteEditOps(remote: string, remoteCwd: string, localCwd: string): EditOperations {
	const r = createRemoteReadOps(remote, remoteCwd, localCwd);
	const w = createRemoteWriteOps(remote, remoteCwd, localCwd);
	return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createRemoteLsOps(remote: string, remoteCwd: string, localCwd: string): LsOperations {
	const toRemote = (p: string) => toRemotePath(p, remoteCwd, localCwd);
	return {
		exists: (p) => sshExec(remote, `test -e ${shQuote(toRemote(p))}`).then(() => true, () => false),
		stat: async (p) => {
			const isDir = await sshExec(remote, `test -d ${shQuote(toRemote(p))}`).then(() => true, () => false);
			return { isDirectory: () => isDir };
		},
		readdir: async (p) => {
			const dir = toRemote(p);
			const cmd = `bash -lc ${shQuote(`dir=${shQuote(dir)}; for f in "$dir"/.[!.]* "$dir"/..?* "$dir"/*; do [ -e "$f" ] || continue; basename -- "$f"; done`)}`;
			const out = await sshExec(remote, cmd);
			return out.toString("utf8").split("\n").map((s) => s.trim()).filter(Boolean);
		},
	};
}

function createRemoteFindOps(remote: string, remoteCwd: string, localCwd: string): FindOperations {
	const toRemote = (p: string) => toRemotePath(p, remoteCwd, localCwd);
	const toLocal = (p: string) => toLocalPath(p, remoteCwd, localCwd);
	return {
		exists: (p) => sshExec(remote, `test -e ${shQuote(toRemote(p))}`).then(() => true, () => false),
		glob: async (pattern, cwd, options) => {
			const remoteSearchPath = toRemote(cwd);
			const limit = Math.max(1, options.limit ?? 1000);
			// Match fd's common behavior: basename globs like "*.ts" search recursively.
			const effectivePattern = pattern.includes("/") ? pattern : `**/${pattern}`;
			const cmd = `bash -lc ${shQuote(`
set -e
cd ${shQuote(remoteSearchPath)}
shopt -s globstar dotglob nullglob
count=0
while IFS= read -r f; do
  [ -e "$f" ] || continue
  case "$f" in */node_modules/*|node_modules/*|*/.git/*|.git/*) continue;; esac
  case "$f" in ./*) f="\${f#./}";; esac
  printf '%s/%s\n' "$PWD" "$f"
  count=$((count + 1))
  [ "$count" -ge ${limit} ] && break
done < <(compgen -G ${shQuote(effectivePattern)} | sort)
`)}`;
			const out = await sshExec(remote, cmd);
			return out.toString("utf8").split("\n").filter(Boolean).map(toLocal);
		},
	};
}

function createRemoteGrepOps(remote: string, remoteCwd: string, localCwd: string): GrepOperations {
	const readOps = createRemoteReadOps(remote, remoteCwd, localCwd);
	return {
		isDirectory: (p) => sshExec(remote, `test -d ${shQuote(toRemotePath(p, remoteCwd, localCwd))}`).then(() => true, () => false),
		readFile: async (p) => (await readOps.readFile(p)).toString("utf8"),
	};
}

async function executeRemoteGrep(remote: string, remoteCwd: string, localCwd: string, params: any) {
	const pattern = String(params.pattern ?? "");
	const searchPath = toRemotePath(resolveLocalPath(params.path || ".", localCwd), remoteCwd, localCwd);
	const limit = Math.max(1, Number(params.limit ?? 100));
	const args: string[] = ["--line-number", "--color=never", "--hidden"];
	if (params.ignoreCase) args.push("--ignore-case");
	if (params.literal) args.push("--fixed-strings");
	if (params.context && Number(params.context) > 0) args.push("-C", String(Math.floor(Number(params.context))));
	if (params.glob) args.push("--glob", String(params.glob));

	const quotedArgs = args.map(shQuote).join(" ");
	const cmd = `bash -lc ${shQuote(`
set -o pipefail
if ! command -v rg >/dev/null 2>&1; then
  echo 'rg is required on the remote host for the grep tool' >&2
  exit 127
fi
search=${shQuote(searchPath)}
if [ ! -e "$search" ]; then
  echo "Path not found: $search" >&2
  exit 2
fi
if [ -d "$search" ]; then
  cd "$search"
  rg ${quotedArgs} -- ${shQuote(pattern)} . | sed 's#^\\./##' | head -n ${limit}
else
  rg ${quotedArgs} -- ${shQuote(pattern)} "$search" | head -n ${limit}
fi
status=\${PIPESTATUS[0]}
[ "$status" -eq 0 ] || [ "$status" -eq 1 ] || [ "$status" -eq 141 ]
`)}`;

	const out = (await sshExec(remote, cmd)).toString("utf8").trimEnd();
	return {
		content: [{ type: "text", text: out || "No matches found" }],
		details: out.split("\n").filter(Boolean).length >= limit ? { matchLimitReached: limit } : undefined,
	};
}

function createRemoteBashOps(remote: string, remoteCwd: string, localCwd: string): BashOperations {
	const toRemote = (p: string) => toRemotePath(p, remoteCwd, localCwd);
	return {
		exec: (command, cwd, { onData, signal, timeout }) =>
			new Promise((resolve, reject) => {
				const cmd = `cd ${shQuote(toRemote(cwd))} && ${command}`;
				const child = spawn("ssh", [remote, cmd], { stdio: ["ignore", "pipe", "pipe"] });
				let timedOut = false;
				const timer = timeout
					? setTimeout(() => {
							timedOut = true;
							child.kill();
						}, timeout * 1000)
					: undefined;
				child.stdout.on("data", onData);
				child.stderr.on("data", onData);
				child.on("error", (e) => {
					if (timer) clearTimeout(timer);
					reject(e);
				});
				const onAbort = () => child.kill();
				signal?.addEventListener("abort", onAbort, { once: true });
				child.on("close", (code) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					if (signal?.aborted) reject(new Error("aborted"));
					else if (timedOut) reject(new Error(`timeout:${timeout}`));
					else resolve({ exitCode: code });
				});
			}),
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("ssh", { description: "SSH remote: user@host or user@host:/path", type: "string" });

	const localCwd = process.cwd();
	const localRead = createReadTool(localCwd);
	const localWrite = createWriteTool(localCwd);
	const localEdit = createEditTool(localCwd);
	const localBash = createBashTool(localCwd);
	const localGrep = createGrepTool(localCwd);
	const localFind = createFindTool(localCwd);
	const localLs = createLsTool(localCwd);

	// Resolved lazily on session_start (CLI flags not available during factory)
	let resolvedSsh: { remote: string; remoteCwd: string } | null = null;

	const getSsh = () => resolvedSsh;

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createReadTool(localCwd, {
					operations: createRemoteReadOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localRead.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createWriteTool(localCwd, {
					operations: createRemoteWriteOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localWrite.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createEditTool(localCwd, {
					operations: createRemoteEditOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localEdit.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createBashTool(localCwd, {
					operations: createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localGrep,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) return executeRemoteGrep(ssh.remote, ssh.remoteCwd, localCwd, params);
			return localGrep.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localFind,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createFindTool(localCwd, {
					operations: createRemoteFindOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localFind.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localLs,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createLsTool(localCwd, {
					operations: createRemoteLsOps(ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localLs.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		// Resolve SSH config now that CLI flags are available
		const arg = pi.getFlag("ssh") as string | undefined;
		if (arg) {
			if (arg.includes(":")) {
				const [remote, p] = arg.split(":");
				resolvedSsh = { remote, remoteCwd: p };
			} else {
				// No path given, evaluate pwd on remote
				const remote = arg;
				const pwd = (await sshExec(remote, "pwd")).toString().trim();
				resolvedSsh = { remote, remoteCwd: pwd };
			}
			setSshConfig(resolvedSsh); // Share with other extensions
			ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`));
			ctx.ui.notify(`SSH mode: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`, "info");
		} else {
			setSshConfig(null);
		}
	});

	// Handle user ! commands via SSH
	pi.on("user_bash", (_event) => {
		const ssh = getSsh();
		if (!ssh) return; // No SSH, use local execution
		return { operations: createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd) };
	});

	// Replace local cwd with remote cwd in system prompt
	pi.on("before_agent_start", async (event) => {
		const ssh = getSsh();
		if (ssh) {
			const modified = event.systemPrompt.replace(
				`Current working directory: ${localCwd}`,
				`Current working directory: ${ssh.remoteCwd} (via SSH: ${ssh.remote})`,
			);
			return { systemPrompt: modified };
		}
	});
}
