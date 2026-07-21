import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  authType: "key" | "password";
  privateKey?: string;
  password?: string;
}

export type RootConsoleTarget = SSHCredentials | "local";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function resolvePlatformTarget(): RootConsoleTarget {
  const mode = (process.env.ROOT_CONSOLE_MODE || "").trim().toLowerCase();
  if (
    mode === "local" ||
    envTruthy(process.env.MYCREATOR_LOCAL_SERVER) ||
    process.env.MYCREATOR_EXECUTION_CONTEXT === "server-local"
  ) {
    return "local";
  }

  const host =
    process.env.OCEANLEO_PLATFORM_SSH_HOST || process.env.ALIYUN_SSH_HOST || "";
  const username =
    process.env.OCEANLEO_PLATFORM_SSH_USER ||
    process.env.ALIYUN_SSH_USER ||
    "root";
  const port = Number.parseInt(
    process.env.OCEANLEO_PLATFORM_SSH_PORT ||
      process.env.ALIYUN_SSH_PORT ||
      "22",
    10,
  );
  const privateKey =
    process.env.OCEANLEO_PLATFORM_SSH_PRIVATE_KEY ||
    process.env.ALIYUN_SSH_PRIVATE_KEY ||
    "";

  if (!host || !privateKey) {
    throw new Error(
      "Platform hosting is not configured on this server. Set " +
        "OCEANLEO_PLATFORM_SSH_HOST + OCEANLEO_PLATFORM_SSH_PRIVATE_KEY " +
        "(or the shared ALIYUN_SSH_* pair), or run with MYCREATOR_LOCAL_SERVER=1 " +
        "when deploying on the ECS host itself.",
    );
  }

  return {
    host,
    port: Number.isNaN(port) ? 22 : port,
    username,
    authType: "key",
    privateKey: privateKey.includes("\\n")
      ? privateKey.replace(/\\n/g, "\n")
      : privateKey,
  };
}

function runLocalCommand(
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      finish(() =>
        reject(new Error(`Local command timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() =>
        resolve({ code: code ?? 1, stdout, stderr }),
      );
    });
  });
}

async function runSshCommand(
  creds: SSHCredentials,
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  if (!creds.privateKey) {
    throw new Error("SSH private key is required for platform hosting");
  }
  const keyPath = path.join(
    os.tmpdir(),
    `oceanleo-platform-${process.pid}-${Date.now()}.pem`,
  );
  await fs.writeFile(keyPath, creds.privateKey, { mode: 0o600 });
  try {
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(
        "ssh",
        [
          "-i",
          keyPath,
          "-p",
          String(creds.port),
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-o",
          "BatchMode=yes",
          `${creds.username}@${creds.host}`,
          command,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handler();
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        finish(() =>
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`)),
        );
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code) => {
        finish(() => resolve({ code: code ?? 1, stdout, stderr }));
      });
    });
  } finally {
    await fs.unlink(keyPath).catch(() => undefined);
  }
}

export function runRootConsoleShellCommand(
  target: RootConsoleTarget,
  command: string,
  timeoutMs = 120_000,
): Promise<CommandResult> {
  if (target === "local") return runLocalCommand(command, timeoutMs);
  // Password + key auth for user-owned boxes; key-only for platform hosts.
  return runUserSshCommand(target, command, timeoutMs);
}

export const PLATFORM_DOMAIN = "oceanleo.app";
export const PLATFORM_SITES_ROOT = "/opt/oceanleo-sites";
export const PLATFORM_HOST_PROVIDER = "oceanleo-ecs";

export interface PlatformFile {
  path: string;
  contentBase64: string;
}

export interface PlatformDeployResult {
  slug: string;
  subdomain: string;
  root: string;
  url: string;
  fileCount: number;
}

export function slugifyHost(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function allocatePlatformSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugifyHost(base) || "site";
  if (!(await isTaken(root))) return root;
  for (let i = 0; i < 12; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${root}-${suffix}`.slice(0, 46);
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 46);
}

function sanitizeRelPath(value: string): string {
  const norm = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = norm.split("/").filter((seg) => seg && seg !== ".");
  if (parts.some((seg) => seg === "..")) {
    throw new Error(`Unsafe path in upload: ${value}`);
  }
  if (
    parts.some((seg) => seg.length > 128 || /[\0-\x1f\x7f]/.test(seg)) ||
    parts.join("/").length > 768
  ) {
    throw new Error(`Path is too long or contains control characters: ${value}`);
  }
  return parts.join("/");
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function deployPlatformFiles(
  target: RootConsoleTarget,
  slug: string,
  files: PlatformFile[],
): Promise<PlatformDeployResult> {
  const safeSlug = slugifyHost(slug);
  if (!safeSlug) throw new Error("Invalid site slug for platform hosting");
  const root = `${PLATFORM_SITES_ROOT}/${safeSlug}`;
  const deployId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const stagingRoot = `${root}.stage-${deployId}`;
  const backupRoot = `${root}.backup-${deployId}`;

  const cleaned = files
    .map((file) => ({
      path: sanitizeRelPath(file.path),
      contentBase64: file.contentBase64,
    }))
    .filter((file) => file.path.length > 0);

  if (cleaned.length === 0) {
    throw new Error("No files to deploy");
  }

  const rootQ = shellSingleQuote(root);
  const stagingQ = shellSingleQuote(stagingRoot);
  const backupQ = shellSingleQuote(backupRoot);
  await runRootConsoleShellCommand(
    target,
    `set -e; rm -rf ${stagingQ} ${backupQ}; mkdir -p ${stagingQ}`,
    60_000,
  );

  const BATCH = 25;
  try {
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH);
      const lines: string[] = ["set -e"];
      for (const file of batch) {
        const fullPath = `${stagingRoot}/${file.path}`;
        const dir =
          fullPath.slice(0, fullPath.lastIndexOf("/")) || stagingRoot;
        const b64 = file.contentBase64.replace(/\s+/g, "");
        lines.push(`mkdir -p ${shellSingleQuote(dir)}`);
        lines.push(
          `printf '%s' ${shellSingleQuote(b64)} | base64 -d > ${shellSingleQuote(fullPath)}`,
        );
      }
      const result = await runRootConsoleShellCommand(
        target,
        lines.join("\n"),
        120_000,
      );
      if (result.code !== 0) {
        throw new Error(
          `Failed writing files to staging tree: ${result.stderr || result.stdout || "unknown error"}`,
        );
      }
    }
  } catch (error) {
    await runRootConsoleShellCommand(
      target,
      `rm -rf ${stagingQ} ${backupQ}`,
      30_000,
    ).catch(() => undefined);
    throw error;
  }

  await runRootConsoleShellCommand(
    target,
    `set -e
cd ${stagingQ}
if [ ! -f index.html ]; then
  sub=$(find . -mindepth 2 -maxdepth 2 -name index.html 2>/dev/null | head -1)
  if [ -n "$sub" ]; then
    d=$(dirname "$sub")
    shopt -s dotglob nullglob 2>/dev/null || true
    mv "$d"/* ${stagingQ}/ 2>/dev/null || true
  fi
fi
true`,
    30_000,
  ).catch(() => undefined);

  const lockQ = shellSingleQuote(`${PLATFORM_SITES_ROOT}/.${safeSlug}.lock`);
  const swapped = await runRootConsoleShellCommand(
    target,
    `set -e
[ -f ${stagingQ}/index.html ]
exec 9>${lockQ}
flock -x 9
rm -rf ${backupQ}
if [ -e ${rootQ} ]; then mv ${rootQ} ${backupQ}; fi
if mv ${stagingQ} ${rootQ}; then
  rm -rf ${backupQ}
else
  if [ -e ${backupQ} ] && [ ! -e ${rootQ} ]; then mv ${backupQ} ${rootQ}; fi
  exit 1
fi`,
    60_000,
  );
  if (swapped.code !== 0) {
    await runRootConsoleShellCommand(
      target,
      `rm -rf ${stagingQ} ${backupQ}`,
      30_000,
    ).catch(() => undefined);
    throw new Error(
      `Failed activating deployment: ${swapped.stderr || swapped.stdout || "unknown error"}`,
    );
  }

  return {
    slug: safeSlug,
    subdomain: `${safeSlug}.${PLATFORM_DOMAIN}`,
    root,
    url: `https://${safeSlug}.${PLATFORM_DOMAIN}`,
    fileCount: cleaned.length,
  };
}

/** Remove a platform-hosted site's files (used by transfer-out / delete). */
export async function teardownPlatformSite(
  target: RootConsoleTarget,
  slug: string,
): Promise<void> {
  const safeSlug = slugifyHost(slug);
  if (!safeSlug) return;
  const root = `${PLATFORM_SITES_ROOT}/${safeSlug}`;
  const lock = `${PLATFORM_SITES_ROOT}/.${safeSlug}.lock`;
  await runRootConsoleShellCommand(
    target,
    `set -e
exec 9>${shellSingleQuote(lock)}
flock -x 9
rm -rf ${shellSingleQuote(root)} ${shellSingleQuote(root)}.stage-* ${shellSingleQuote(root)}.backup-*`,
    30_000,
  );
}

/** Read the current file tree of a platform site (for transfer-out to GitHub). */
export async function readPlatformSiteTree(
  target: RootConsoleTarget,
  slug: string,
): Promise<PlatformFile[]> {
  const safeSlug = slugifyHost(slug);
  if (!safeSlug) throw new Error("Invalid site slug for platform hosting");
  const root = `${PLATFORM_SITES_ROOT}/${safeSlug}`;
  const rootQ = shellSingleQuote(root);
  const lockQ = shellSingleQuote(`${PLATFORM_SITES_ROOT}/.${safeSlug}.lock`);
  const script = `
set -e
exec 9>${lockQ}
flock -s 9
cd ${rootQ} 2>/dev/null || exit 0
find . -type f -size -5M 2>/dev/null | while read -r f; do
  rel="\${f#./}"
  printf '%s\\t' "$rel"
  base64 -w0 "$f"
  printf '\\n'
done`;
  const res = await runRootConsoleShellCommand(target, script, 120_000);
  if (res.code !== 0) {
    throw new Error(res.stderr || "Failed to read site files");
  }
  const out: PlatformFile[] = [];
  for (const line of res.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const relPath = line.slice(0, tab).trim();
    const contentBase64 = line.slice(tab + 1).trim();
    if (relPath && contentBase64) out.push({ path: relPath, contentBase64 });
  }
  return out;
}

export interface PrerequisiteCheck {
  docker: boolean;
  caddy: boolean;
  python3: boolean;
  git: boolean;
  systemctl: boolean;
}

export interface RootConsoleLaunchOptions {
  baseDir: string;
  workdir: string;
  prompt: string;
  model?: string;
  apiKey: string;
}

export interface RootConsoleTaskStatus {
  taskId: string;
  status: "queued" | "running" | "finished" | "error" | "unknown";
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  workdir: string | null;
  model: string | null;
  prompt: string | null;
  summary: string | null;
  lastLines: string[];
  gitSummary: {
    branch: string | null;
    status: string[];
    diffStat: string[];
    latestCommit: string | null;
  };
}

/**
 * Probe a user-owned SSH host (import remote_server). Uses OpenSSH + sshpass
 * so we do not depend on the ssh2 native package.
 */
export async function testUserSshConnection(
  creds: SSHCredentials,
): Promise<{ ok: boolean; error?: string; osInfo?: string }> {
  try {
    const result = await runUserSshCommand(
      creds,
      "cat /etc/os-release | head -3",
      10_000,
    );
    if (result.code !== 0) {
      return { ok: false, error: result.stderr || "Non-zero exit code" };
    }
    return { ok: true, osInfo: result.stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkUserSshPrerequisites(
  creds: SSHCredentials,
): Promise<PrerequisiteCheck> {
  const result = await runUserSshCommand(
    creds,
    [
      'command -v docker >/dev/null 2>&1 && echo "docker:yes" || echo "docker:no"',
      'command -v caddy >/dev/null 2>&1 && echo "caddy:yes" || echo "caddy:no"',
      'command -v python3 >/dev/null 2>&1 && echo "python3:yes" || echo "python3:no"',
      'command -v git >/dev/null 2>&1 && echo "git:yes" || echo "git:no"',
      'command -v systemctl >/dev/null 2>&1 && echo "systemctl:yes" || echo "systemctl:no"',
    ].join(" && "),
    15_000,
  );
  const lines = result.stdout;
  return {
    docker: lines.includes("docker:yes"),
    caddy: lines.includes("caddy:yes"),
    python3: lines.includes("python3:yes"),
    git: lines.includes("git:yes"),
    systemctl: lines.includes("systemctl:yes"),
  };
}

export async function getUserSshServiceStatus(
  creds: SSHCredentials,
  siteSlug: string,
): Promise<{ active: boolean; uptime: string; memory: string; logs: string }> {
  const serviceName = `${siteSlug}-backend`;
  const result = await runUserSshCommand(
    creds,
    `systemctl is-active ${serviceName} 2>/dev/null || echo "inactive"; ` +
      `systemctl show ${serviceName} --property=ActiveEnterTimestamp --no-pager 2>/dev/null || true; ` +
      `ps aux | grep "${serviceName}\\|uvicorn.*${siteSlug}" | grep -v grep | awk '{print $6}' | head -1; ` +
      `journalctl -u ${serviceName} --no-pager -n 30 2>/dev/null || true`,
    15_000,
  );
  const lines = result.stdout.split("\n");
  const active = lines[0]?.trim() === "active";
  const uptimeLine =
    lines.find((line) => line.startsWith("ActiveEnterTimestamp=")) || "";
  const memKb = lines.find((line) => /^\d+$/.test(line.trim())) || "0";
  return {
    active,
    uptime: uptimeLine.replace("ActiveEnterTimestamp=", "").trim(),
    memory: `${Math.round(Number.parseInt(memKb || "0", 10) / 1024)}MB`,
    logs: lines.slice(3).join("\n").trim(),
  };
}

export async function restartUserSshService(
  creds: SSHCredentials,
  siteSlug: string,
): Promise<CommandResult> {
  return runUserSshCommand(
    creds,
    `systemctl restart ${siteSlug}-backend`,
    30_000,
  );
}

function toShellAssignment(name: string, value: string): string {
  return `${name}=${shellSingleQuote(value)}`;
}

function parseTaskStatusPayload(
  raw: string,
  taskId: string,
): RootConsoleTaskStatus {
  const empty: RootConsoleTaskStatus = {
    taskId,
    status: "unknown",
    pid: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    workdir: null,
    model: null,
    prompt: null,
    summary: null,
    lastLines: [],
    gitSummary: {
      branch: null,
      status: [],
      diffStat: [],
      latestCommit: null,
    },
  };
  if (!raw.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as RootConsoleTaskStatus;
    return {
      ...empty,
      ...parsed,
      gitSummary: {
        ...empty.gitSummary,
        ...(parsed.gitSummary || {}),
      },
    };
  } catch {
    return {
      ...empty,
      summary: raw.trim(),
      lastLines: raw.trim().split("\n").slice(-20),
    };
  }
}

/**
 * Launch a detached Cursor `agent` CLI task on a platform or user SSH host.
 * Mirrors website:front/lib/deploy/server-ssh.ts launchRootConsoleTask over
 * OpenSSH (no ssh2).
 */
export async function launchRootConsoleTask(
  target: RootConsoleTarget,
  options: RootConsoleLaunchOptions,
): Promise<{ taskId: string; status: RootConsoleTaskStatus }> {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const command = `
set -e
${toShellAssignment("BASE_DIR", options.baseDir)}
${toShellAssignment("TASK_ID", taskId)}
${toShellAssignment("WORKDIR", options.workdir)}
${toShellAssignment("PROMPT_TEXT", options.prompt)}
${toShellAssignment("MODEL_NAME", options.model || "")}
${toShellAssignment("CURSOR_API_KEY_VALUE", options.apiKey)}
export BASE_DIR TASK_ID WORKDIR PROMPT_TEXT MODEL_NAME CURSOR_API_KEY_VALUE

TASK_DIR="$BASE_DIR/tasks/$TASK_ID"
export TASK_DIR
mkdir -p "$TASK_DIR"
mkdir -p "$WORKDIR"

printf '%s' "$PROMPT_TEXT" > "$TASK_DIR/prompt.txt"

python3 - <<'PY'
import json
import os
from pathlib import Path

task_dir = Path(os.environ["TASK_DIR"])
payload = {
    "taskId": os.environ["TASK_ID"],
    "status": "queued",
    "pid": None,
    "startedAt": None,
    "finishedAt": None,
    "exitCode": None,
    "workdir": os.environ["WORKDIR"],
    "model": os.environ["MODEL_NAME"] or None,
    "prompt": os.environ["PROMPT_TEXT"],
    "summary": None,
    "lastLines": [],
    "gitSummary": {
        "branch": None,
        "status": [],
        "diffStat": [],
        "latestCommit": None,
    },
}
(task_dir / "status.json").write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY

cat > "$TASK_DIR/run-task.sh" <<'SCRIPT_EOF'
#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKDIR_FILE="$TASK_DIR/workdir.txt"
WORKDIR="$(cat "$WORKDIR_FILE")"
PROMPT_FILE="$TASK_DIR/prompt.txt"
LOG_FILE="$TASK_DIR/output.log"
STATUS_FILE="$TASK_DIR/status.json"
MODEL_FILE="$TASK_DIR/model.txt"
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
export CURSOR_API_KEY="$CURSOR_API_KEY_VALUE"
export MYCREATOR_LOCAL_SERVER=1
export MYCREATOR_EXECUTION_CONTEXT=server-local

python3 - "$STATUS_FILE" "$WORKDIR" "$PROMPT_FILE" "$MODEL_FILE" <<'PY'
import json
import pathlib
import sys
import time

status_path = pathlib.Path(sys.argv[1])
workdir = sys.argv[2]
prompt_path = pathlib.Path(sys.argv[3])
model_path = pathlib.Path(sys.argv[4])
payload = json.loads(status_path.read_text(encoding="utf-8"))
payload["status"] = "running"
payload["pid"] = None
payload["startedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
payload["workdir"] = workdir
payload["prompt"] = prompt_path.read_text(encoding="utf-8").strip()
payload["model"] = model_path.read_text(encoding="utf-8").strip() or None
status_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY

if ! command -v agent >/dev/null 2>&1; then
  echo "[root-console] agent CLI not found in PATH" >> "$LOG_FILE"
  python3 - "$STATUS_FILE" <<'PY'
import json
import pathlib
import sys
import time

status_path = pathlib.Path(sys.argv[1])
payload = json.loads(status_path.read_text(encoding="utf-8"))
payload["status"] = "error"
payload["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
payload["exitCode"] = 127
payload["summary"] = "Cursor CLI agent was not found on the server host."
status_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY
  exit 127
fi

cd "$WORKDIR"

MODEL_NAME="$(cat "$MODEL_FILE")"
set +e
if [ -n "$MODEL_NAME" ]; then
  agent --model "$MODEL_NAME" -p --force --trust --output-format text "$(cat "$PROMPT_FILE")" >> "$LOG_FILE" 2>&1
else
  agent -p --force --trust --output-format text "$(cat "$PROMPT_FILE")" >> "$LOG_FILE" 2>&1
fi
EXIT_CODE=$?
set -e

python3 - "$STATUS_FILE" "$WORKDIR" "$LOG_FILE" "$EXIT_CODE" <<'PY'
import json
import pathlib
import subprocess
import sys
import time

status_path = pathlib.Path(sys.argv[1])
workdir = pathlib.Path(sys.argv[2])
log_path = pathlib.Path(sys.argv[3])
exit_code = int(sys.argv[4])

payload = json.loads(status_path.read_text(encoding="utf-8"))
payload["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
payload["exitCode"] = exit_code
payload["status"] = "finished" if exit_code == 0 else "error"

if log_path.exists():
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    payload["lastLines"] = lines[-40:]
    payload["summary"] = "\\n".join(lines[-20:]).strip() or payload.get("summary")

def run_git(args):
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            return []
        return [line for line in result.stdout.splitlines() if line.strip()]
    except Exception:
        return []

if (workdir / ".git").exists():
    branch = run_git(["branch", "--show-current"])
    payload["gitSummary"] = {
        "branch": branch[0] if branch else None,
        "status": run_git(["status", "--short"])[:50],
        "diffStat": run_git(["diff", "--stat"])[:50],
        "latestCommit": (run_git(["log", "-1", "--oneline"]) or [None])[0],
    }

status_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY

exit "$EXIT_CODE"
SCRIPT_EOF

printf '%s' "$WORKDIR" > "$TASK_DIR/workdir.txt"
printf '%s' "$MODEL_NAME" > "$TASK_DIR/model.txt"
chmod +x "$TASK_DIR/run-task.sh"

nohup bash "$TASK_DIR/run-task.sh" > /dev/null 2>&1 &
PID=$!

python3 - "$TASK_DIR/status.json" "$PID" <<'PY'
import json
import pathlib
import sys

status_path = pathlib.Path(sys.argv[1])
pid = int(sys.argv[2])
payload = json.loads(status_path.read_text(encoding="utf-8"))
payload["pid"] = pid
status_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY

python3 - "$TASK_DIR/status.json" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
PY
`;

  const result = await runRootConsoleShellCommand(target, command, 30_000);
  if (result.code !== 0) {
    throw new Error(
      result.stderr || result.stdout || "Failed to launch root console task.",
    );
  }
  return {
    taskId,
    status: parseTaskStatusPayload(result.stdout, taskId),
  };
}

export async function getRootConsoleTaskStatus(
  target: RootConsoleTarget,
  baseDir: string,
  taskId: string,
): Promise<RootConsoleTaskStatus> {
  const command = `
set -e
${toShellAssignment("BASE_DIR", baseDir)}
${toShellAssignment("TASK_ID", taskId)}
TASK_DIR="$BASE_DIR/tasks/$TASK_ID"
STATUS_FILE="$TASK_DIR/status.json"
LOG_FILE="$TASK_DIR/output.log"
if [ ! -f "$STATUS_FILE" ]; then
  echo ""
  exit 0
fi
python3 - "$STATUS_FILE" "$LOG_FILE" <<'PY'
import json
import pathlib
import sys

status_path = pathlib.Path(sys.argv[1])
log_path = pathlib.Path(sys.argv[2])
payload = json.loads(status_path.read_text(encoding="utf-8"))
if log_path.exists():
    payload["lastLines"] = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]
print(json.dumps(payload, ensure_ascii=True))
PY
`;
  const result = await runRootConsoleShellCommand(target, command, 15_000);
  return parseTaskStatusPayload(result.stdout, taskId);
}

export async function runUserSshCommand(
  creds: SSHCredentials,
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  if (creds.authType === "key") {
    if (!creds.privateKey) {
      throw new Error("SSH private key is required for key auth");
    }
    return runSshCommand(
      {
        ...creds,
        privateKey: creds.privateKey,
      },
      command,
      timeoutMs,
    );
  }

  if (!creds.password) {
    throw new Error("SSH password is required for password auth");
  }

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(
      "sshpass",
      [
        "-p",
        creds.password!,
        "ssh",
        "-p",
        String(creds.port),
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        `${creds.username}@${creds.host}`,
        command,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      finish(() =>
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() => resolve({ code: code ?? 1, stdout, stderr }));
    });
  });
}
