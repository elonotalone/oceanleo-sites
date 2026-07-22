import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";

import { canonicalSha256, isRecord } from "./canonical";
import {
  RETIREMENT_MUTATION_RECEIPT_SCHEMA_VERSION,
  type RetirementMutationAction,
  type RetirementMutationReceipt,
  type RetirementProvider,
} from "./provider";

const DEFAULT_HELPER = "/root/.cursor/bin/vercel-ops";
const DEFAULT_TEAM = "team_Jk2R4jQ9GDtSbG2oOXqTRum9";
const PROJECTS_ROOT = "/root/projects";

export class RetirementProviderError extends Error {
  override name = "RetirementProviderError";

  constructor(
    readonly operation: string,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`Retirement provider ${operation} failed (${code}).`);
  }
}

export interface VercelRetirementProviderOptions {
  readonly protectedHosts: readonly string[];
  readonly helperPath?: string;
  readonly teamId?: string;
  /** Injected for tests; defaults to `rm -rf` after path verification. */
  readonly removeDirectory?: (absolutePath: string) => Promise<void>;
  readonly pathExists?: (absolutePath: string) => Promise<boolean>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return stringOrNull(value.error.code) ?? "provider-error";
}

function isNotFound(code: string | null): boolean {
  return (
    code === "not_found" ||
    code === "project_not_found" ||
    code === "domain_not_found" ||
    code === "not_found_error"
  );
}

function executeHelper(
  helperPath: string,
  args: readonly string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      helperPath,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 90_000,
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout : "";
        const err = typeof stderr === "string" ? stderr : "";
        if (!error) {
          resolve({ stdout: out, stderr: err, exitCode: 0 });
          return;
        }
        const status =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof (error as { status?: unknown }).status === "number"
            ? (error as { status: number }).status
            : null;
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : null;
        resolve({
          stdout: out,
          stderr: err,
          exitCode: status ?? code ?? 1,
        });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

async function defaultPathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function defaultRemoveDirectory(absolutePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("rm", ["-rf", "--", absolutePath], (error) => {
      if (error) {
        reject(
          new RetirementProviderError(
            "delete-verified-local-clone",
            "rm-failed",
            { path: absolutePath },
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Validates that `path` is exactly `/root/projects/<repo>` (single segment,
 * no traversal). Returns the resolved absolute path.
 */
export function assertSafeLocalClonePath(path: string): string {
  const prefix = `${PROJECTS_ROOT}/`;
  if (
    path.includes("\0") ||
    path.includes("..") ||
    !path.startsWith(prefix) ||
    path === PROJECTS_ROOT
  ) {
    throw new RetirementProviderError(
      "delete-verified-local-clone",
      path.startsWith(prefix) ? "path-refused" : "path-outside-projects-root",
      { path },
    );
  }
  const repo = path.slice(prefix.length);
  if (!repo || repo.includes("/") || repo === "." || repo === "..") {
    throw new RetirementProviderError(
      "delete-verified-local-clone",
      "path-not-single-repo",
      { path },
    );
  }
  const expected = `${PROJECTS_ROOT}/${repo}`;
  const resolved = resolvePath(path);
  if (path !== expected || resolved !== expected || basename(resolved) !== repo) {
    throw new RetirementProviderError(
      "delete-verified-local-clone",
      "path-mismatch",
      { path, expected, resolved },
    );
  }
  return expected;
}
export class VercelRetirementProvider implements RetirementProvider {
  private readonly protectedHosts: ReadonlySet<string>;
  private readonly helperPath: string;
  private readonly teamId: string;
  private readonly removeDirectory: (absolutePath: string) => Promise<void>;
  private readonly pathExists: (absolutePath: string) => Promise<boolean>;

  constructor(options: VercelRetirementProviderOptions) {
    this.protectedHosts = new Set(options.protectedHosts);
    this.helperPath = options.helperPath ?? DEFAULT_HELPER;
    this.teamId = options.teamId ?? DEFAULT_TEAM;
    this.removeDirectory = options.removeDirectory ?? defaultRemoveDirectory;
    this.pathExists = options.pathExists ?? defaultPathExists;
  }

  private teamPath(path: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}teamId=${encodeURIComponent(this.teamId)}`;
  }

  private async rawApi(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const args = ["api", method, path];
    const stdin = body === undefined ? undefined : JSON.stringify(body);
    if (stdin !== undefined) args.push("@-");
    const result = await executeHelper(this.helperPath, args, stdin);
    if (result.exitCode !== 0) {
      throw new RetirementProviderError(`${method} ${path}`, "helper-exit", {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 512),
      });
    }
    const text = result.stdout.trim();
    if (!text) return Object.freeze({});
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RetirementProviderError(`${method} ${path}`, "invalid-json");
    }
  }

  private receipt(
    action: RetirementMutationAction,
    resourceId: string,
    providerReceiptId: string,
  ): RetirementMutationReceipt {
    return Object.freeze({
      schemaVersion: RETIREMENT_MUTATION_RECEIPT_SCHEMA_VERSION,
      actionId: action.actionId,
      actionKind: action.kind,
      resourceId,
      providerReceiptId,
      completedAt: new Date().toISOString(),
    });
  }

  private idempotentReceipt(
    action: RetirementMutationAction,
    resourceId: string,
    outcome: string,
  ): RetirementMutationReceipt {
    return this.receipt(
      action,
      resourceId,
      canonicalSha256({
        actionId: action.actionId,
        actionKind: action.kind,
        resourceId,
        outcome,
      }),
    );
  }

  private async listProjectDomainHosts(
    projectId: string,
  ): Promise<readonly string[] | null> {
    const response = await this.rawApi(
      "GET",
      this.teamPath(
        `/v9/projects/${encodeURIComponent(projectId)}/domains?limit=100`,
      ),
    );
    const errorCode = providerErrorCode(response);
    if (isNotFound(errorCode)) return null;
    if (errorCode) {
      throw new RetirementProviderError("list-project-domains", errorCode);
    }
    if (!isRecord(response) || !Array.isArray(response.domains)) {
      throw new RetirementProviderError(
        "list-project-domains",
        "invalid-response",
      );
    }
    const hosts: string[] = [];
    for (const item of response.domains) {
      if (!isRecord(item)) continue;
      const name = stringOrNull(item.name);
      if (name) hosts.push(name);
    }
    return Object.freeze(hosts);
  }

  private async removeGeneratedAlias(
    action: Extract<
      RetirementMutationAction,
      { kind: "remove-generated-alias" }
    >,
  ): Promise<RetirementMutationReceipt> {
    const hosts = await this.listProjectDomainHosts(action.projectId);
    if (hosts === null) {
      return this.idempotentReceipt(action, action.aliasId, "project-absent");
    }
    if (!hosts.includes(action.host)) {
      return this.idempotentReceipt(action, action.aliasId, "alias-absent");
    }

    const result = await executeHelper(this.helperPath, [
      "domains",
      "rm",
      action.projectId,
      action.host,
    ]);
    if (result.exitCode !== 0) {
      // Helper exits non-zero when the project lookup fails; treat as gone.
      if (/unknown project/i.test(result.stderr)) {
        return this.idempotentReceipt(action, action.aliasId, "project-absent");
      }
      throw new RetirementProviderError("remove-generated-alias", "helper-exit", {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 512),
      });
    }

    let parsed: unknown = null;
    const text = result.stdout.trim();
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    const errorCode = providerErrorCode(parsed);
    if (isNotFound(errorCode)) {
      return this.idempotentReceipt(action, action.aliasId, "alias-absent");
    }
    if (errorCode) {
      throw new RetirementProviderError("remove-generated-alias", errorCode);
    }

    const apiId =
      (isRecord(parsed) ? stringOrNull(parsed.uid) : null) ??
      (isRecord(parsed) ? stringOrNull(parsed.id) : null);
    return this.receipt(
      action,
      action.aliasId,
      apiId ??
        canonicalSha256({
          actionId: action.actionId,
          projectId: action.projectId,
          host: action.host,
          response: parsed ?? text,
        }),
    );
  }

  private async deleteLegacyProject(
    action: Extract<
      RetirementMutationAction,
      { kind: "delete-legacy-project" }
    >,
  ): Promise<RetirementMutationReceipt> {
    const projectResponse = await this.rawApi(
      "GET",
      this.teamPath(`/v9/projects/${encodeURIComponent(action.projectId)}`),
    );
    const getError = providerErrorCode(projectResponse);
    if (isNotFound(getError)) {
      return this.idempotentReceipt(
        action,
        action.projectId,
        "project-absent",
      );
    }
    if (getError) {
      throw new RetirementProviderError("get-project", getError);
    }

    const hosts = await this.listProjectDomainHosts(action.projectId);
    if (hosts === null) {
      return this.idempotentReceipt(
        action,
        action.projectId,
        "project-absent",
      );
    }
    const overlap = hosts.filter((host) => this.protectedHosts.has(host));
    if (overlap.length > 0) {
      throw new RetirementProviderError(
        "delete-legacy-project",
        "protected-domain-overlap",
        {
          projectId: action.projectId,
          hosts: overlap,
        },
      );
    }

    // vercel-ops has no first-class `project delete`; use the raw API escape hatch.
    // Vercel documents DELETE /v9/projects/{idOrName}; /v1/projects/{id} also works.
    const deleted = await this.rawApi(
      "DELETE",
      this.teamPath(`/v9/projects/${encodeURIComponent(action.projectId)}`),
    );
    const deleteError = providerErrorCode(deleted);
    if (isNotFound(deleteError)) {
      return this.idempotentReceipt(
        action,
        action.projectId,
        "project-absent",
      );
    }
    if (deleteError) {
      throw new RetirementProviderError("delete-legacy-project", deleteError);
    }

    const apiId =
      (isRecord(deleted) ? stringOrNull(deleted.id) : null) ??
      (isRecord(deleted) ? stringOrNull(deleted.uid) : null);
    return this.receipt(
      action,
      action.projectId,
      apiId ??
        canonicalSha256({
          actionId: action.actionId,
          projectId: action.projectId,
          response: deleted,
        }),
    );
  }

  private async deleteVerifiedLocalClone(
    action: Extract<
      RetirementMutationAction,
      { kind: "delete-verified-local-clone" }
    >,
  ): Promise<RetirementMutationReceipt> {
    const safePath = assertSafeLocalClonePath(action.path);
    if (!(await this.pathExists(safePath))) {
      return this.idempotentReceipt(action, action.path, "clone-absent");
    }
    await this.removeDirectory(safePath);
    return this.receipt(
      action,
      action.path,
      canonicalSha256({
        actionId: action.actionId,
        path: action.path,
        outcome: "removed",
      }),
    );
  }

  async apply(
    action: RetirementMutationAction,
  ): Promise<RetirementMutationReceipt> {
    switch (action.kind) {
      case "remove-generated-alias":
        return this.removeGeneratedAlias(action);
      case "delete-legacy-project":
        return this.deleteLegacyProject(action);
      case "delete-verified-local-clone":
        return this.deleteVerifiedLocalClone(action);
    }
  }
}
