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
  return runSshCommand(target, command, timeoutMs);
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
