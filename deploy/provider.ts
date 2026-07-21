import { execFile } from "node:child_process";

import type {
  CutoverProvider,
  DeploymentInfo,
  DeploymentState,
  DomainConfiguration,
  DomainMoveReceipt,
  EnvironmentKeyInfo,
  EnvironmentValueInfo,
  EnvironmentVariableType,
  EnvironmentWriteInput,
  ProbeRequest,
  ProbeResponse,
  ProjectDomainInfo,
  ProjectInfo,
  TargetProjectManifest,
} from "./types";

const DEFAULT_HELPER = "/root/.cursor/bin/vercel-ops";
const DEFAULT_TEAM = "team_Jk2R4jQ9GDtSbG2oOXqTRum9";
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "x-oceanleo-app-profile",
  "x-oceanleo-tenant",
] as const;

export class ProviderOperationError extends Error {
  override name = "ProviderOperationError";

  constructor(
    readonly operation: string,
    readonly code: string,
  ) {
    super(`Vercel operation ${operation} failed (${code}).`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return stringOrNull(value.error.code) ?? "provider-error";
}

function executeHelper(
  helperPath: string,
  args: readonly string[],
  stdin?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      helperPath,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 90_000,
      },
      (error, stdout) => {
        if (error) {
          reject(new ProviderOperationError(args[0] ?? "unknown", "helper-exit"));
          return;
        }
        resolve(stdout);
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

function parseProject(value: unknown): ProjectInfo {
  if (!isRecord(value)) {
    throw new ProviderOperationError("project-read", "invalid-response");
  }
  const link = isRecord(value.link) ? value.link : null;
  const id = stringOrNull(value.id);
  const name = stringOrNull(value.name);
  const accountId = stringOrNull(value.accountId);
  if (!id || !name || !accountId) {
    throw new ProviderOperationError("project-read", "incomplete-response");
  }
  return Object.freeze({
    id,
    name,
    accountId,
    framework: stringOrNull(value.framework),
    nodeVersion: stringOrNull(value.nodeVersion),
    rootDirectory: stringOrNull(value.rootDirectory),
    installCommand: stringOrNull(value.installCommand),
    buildCommand: stringOrNull(value.buildCommand),
    link: link
      ? Object.freeze({
          type: stringOrNull(link.type),
          org: stringOrNull(link.org),
          repo: stringOrNull(link.repo),
          productionBranch: stringOrNull(link.productionBranch),
        })
      : null,
  });
}

function deploymentState(value: unknown): DeploymentState {
  const state = stringOrNull(value);
  const states: readonly DeploymentState[] = [
    "BLOCKED",
    "BUILDING",
    "CANCELED",
    "DELETED",
    "ERROR",
    "INITIALIZING",
    "QUEUED",
    "READY",
  ];
  if (!state || !states.includes(state as DeploymentState)) {
    throw new ProviderOperationError("deployment-read", "invalid-state");
  }
  return state as DeploymentState;
}

function environmentVariableType(value: unknown): EnvironmentVariableType {
  const types: readonly EnvironmentVariableType[] = [
    "plain",
    "encrypted",
    "sensitive",
    "secret",
    "system",
  ];
  if (typeof value !== "string" || !types.includes(value as EnvironmentVariableType)) {
    throw new ProviderOperationError("environment-read", "invalid-type");
  }
  return value as EnvironmentVariableType;
}

function parseDeployment(value: unknown): DeploymentInfo {
  if (!isRecord(value)) {
    throw new ProviderOperationError("deployment-read", "invalid-response");
  }
  const meta = isRecord(value.meta) ? value.meta : {};
  const gitSource = isRecord(value.gitSource) ? value.gitSource : {};
  const id = stringOrNull(value.uid) ?? stringOrNull(value.id);
  const projectId = stringOrNull(value.projectId);
  const url = stringOrNull(value.url);
  if (!id || !projectId || !url) {
    throw new ProviderOperationError("deployment-read", "incomplete-response");
  }
  return Object.freeze({
    id,
    projectId,
    url,
    state: deploymentState(value.readyState ?? value.state),
    target: stringOrNull(value.target),
    sourceSha:
      stringOrNull(gitSource.sha) ??
      stringOrNull(meta.githubCommitSha) ??
      stringOrNull(meta.gitCommitSha),
  });
}

export class VercelOpsProvider implements CutoverProvider {
  constructor(
    private readonly helperPath = DEFAULT_HELPER,
    private readonly teamId = DEFAULT_TEAM,
  ) {}

  private async rawApi(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const args = ["api", method, path];
    const stdin = body === undefined ? undefined : JSON.stringify(body);
    if (stdin !== undefined) args.push("@-");
    const stdout = await executeHelper(this.helperPath, args, stdin);
    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      throw new ProviderOperationError(`${method} ${path}`, "invalid-json");
    }
  }

  private teamPath(path: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}teamId=${encodeURIComponent(this.teamId)}`;
  }

  async getProject(idOrName: string): Promise<ProjectInfo | null> {
    const path = this.teamPath(
      `/v9/projects/${encodeURIComponent(idOrName)}`,
    );
    const response = await this.rawApi("GET", path);
    const errorCode = providerErrorCode(response);
    if (errorCode === "not_found" || errorCode === "project_not_found") {
      return null;
    }
    if (errorCode) {
      throw new ProviderOperationError("get-project", errorCode);
    }
    return parseProject(response);
  }

  async createProject(target: TargetProjectManifest): Promise<ProjectInfo> {
    const response = await this.rawApi(
      "POST",
      this.teamPath("/v11/projects"),
      {
        name: target.projectName,
        framework: target.framework,
        rootDirectory: target.rootDirectory,
        installCommand: target.installCommand,
        buildCommand: target.buildCommand,
        gitRepository: {
          type: target.gitRepository.type,
          repo: `${target.gitRepository.owner}/${target.gitRepository.repo}`,
        },
      },
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("create-project", errorCode);
    }
    const created = parseProject(response);
    const configuredResponse = await this.rawApi(
      "PATCH",
      this.teamPath(`/v9/projects/${encodeURIComponent(created.id)}`),
      {
        framework: target.framework,
        nodeVersion: target.nodeVersion,
        rootDirectory: target.rootDirectory,
        installCommand: target.installCommand,
        buildCommand: target.buildCommand,
      },
    );
    const configureError = providerErrorCode(configuredResponse);
    if (configureError) {
      throw new ProviderOperationError(
        "configure-project",
        configureError,
      );
    }
    return parseProject(configuredResponse);
  }

  async listProjectDomains(
    projectId: string,
  ): Promise<readonly ProjectDomainInfo[]> {
    const collected: ProjectDomainInfo[] = [];
    let until: number | undefined;
    for (;;) {
      const query = new URLSearchParams({ limit: "100" });
      if (until !== undefined) query.set("until", String(until));
      const response = await this.rawApi(
        "GET",
        this.teamPath(
          `/v9/projects/${encodeURIComponent(projectId)}/domains?${query.toString()}`,
        ),
      );
      const errorCode = providerErrorCode(response);
      if (errorCode) {
        throw new ProviderOperationError("list-project-domains", errorCode);
      }
      if (!isRecord(response) || !Array.isArray(response.domains)) {
        throw new ProviderOperationError(
          "list-project-domains",
          "invalid-response",
        );
      }
      for (const item of response.domains) {
        if (!isRecord(item) || !stringOrNull(item.name)) {
          throw new ProviderOperationError(
            "list-project-domains",
            "invalid-domain",
          );
        }
        const status = item.redirectStatusCode;
        collected.push(
          Object.freeze({
            host: item.name as string,
            verified: item.verified === true,
            projectId,
            gitBranch: stringOrNull(item.gitBranch),
            redirect: stringOrNull(item.redirect),
            redirectStatusCode:
              status === 301 ||
              status === 302 ||
              status === 307 ||
              status === 308
                ? status
                : null,
          }),
        );
      }
      const pagination = isRecord(response.pagination)
        ? response.pagination
        : null;
      const next =
        pagination && typeof pagination.next === "number"
          ? pagination.next
          : null;
      if (next === null) break;
      until = next;
    }
    return Object.freeze(collected);
  }

  async listEnvironmentKeys(
    projectId: string,
  ): Promise<readonly EnvironmentKeyInfo[]> {
    const response = await this.rawApi(
      "GET",
      this.teamPath(
        `/v10/projects/${encodeURIComponent(projectId)}/env?target=production&decrypt=false`,
      ),
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("list-environment-keys", errorCode);
    }
    if (!isRecord(response) || !Array.isArray(response.envs)) {
      throw new ProviderOperationError(
        "list-environment-keys",
        "invalid-response",
      );
    }
    const keys = response.envs.flatMap((item): EnvironmentKeyInfo[] => {
      if (!isRecord(item) || !stringOrNull(item.key)) return [];
      const rawTargets = Array.isArray(item.target)
        ? item.target
        : item.target
          ? [item.target]
          : [];
      return [
        Object.freeze({
          key: item.key as string,
          targets: Object.freeze(
            rawTargets.filter(
              (target): target is string => typeof target === "string",
            ),
          ),
        }),
      ];
    });
    return Object.freeze(keys);
  }

  async readEnvironmentValues(
    projectId: string,
  ): Promise<readonly EnvironmentValueInfo[]> {
    const response = await this.rawApi(
      "GET",
      this.teamPath(
        `/v10/projects/${encodeURIComponent(projectId)}/env?target=production&decrypt=true`,
      ),
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("read-environment-values", errorCode);
    }
    if (!isRecord(response) || !Array.isArray(response.envs)) {
      throw new ProviderOperationError(
        "read-environment-values",
        "invalid-response",
      );
    }
    return Object.freeze(
      response.envs.flatMap((item): EnvironmentValueInfo[] => {
        if (
          !isRecord(item) ||
          !stringOrNull(item.id) ||
          !stringOrNull(item.key)
        ) {
          return [];
        }
        const rawTargets = Array.isArray(item.target)
          ? item.target
          : item.target
            ? [item.target]
            : [];
        return [
          Object.freeze({
            id: item.id as string,
            key: item.key as string,
            type: environmentVariableType(item.type),
            value: typeof item.value === "string" ? item.value : null,
            targets: Object.freeze(
              rawTargets.filter(
                (target): target is string => typeof target === "string",
              ),
            ),
          }),
        ];
      }),
    );
  }

  async upsertEnvironmentVariable(
    projectId: string,
    input: EnvironmentWriteInput,
  ): Promise<void> {
    const projectPath = `/v10/projects/${encodeURIComponent(projectId)}/env`;
    const path = input.existingId
      ? `${projectPath}/${encodeURIComponent(input.existingId)}`
      : projectPath;
    const response = await this.rawApi(
      input.existingId ? "PATCH" : "POST",
      this.teamPath(path),
      {
        key: input.key,
        value: input.value,
        type: input.type,
        target: input.targets,
      },
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("upsert-environment-value", errorCode);
    }
  }

  async startDeployment(
    project: ProjectInfo,
    target: TargetProjectManifest,
    sourceSha: string,
  ): Promise<DeploymentInfo> {
    const response = await this.rawApi(
      "POST",
      this.teamPath("/v13/deployments"),
      {
        name: target.projectName,
        project: project.id,
        target: "production",
        gitSource: {
          type: "github",
          org: target.gitRepository.owner,
          repo: target.gitRepository.repo,
          ref: target.productionBranch,
          sha: sourceSha,
        },
      },
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("start-deployment", errorCode);
    }
    return parseDeployment(response);
  }

  async getDeployment(deploymentId: string): Promise<DeploymentInfo | null> {
    const response = await this.rawApi(
      "GET",
      this.teamPath(
        `/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true`,
      ),
    );
    const errorCode = providerErrorCode(response);
    if (errorCode === "not_found" || errorCode === "deployment_not_found") {
      return null;
    }
    if (errorCode) {
      throw new ProviderOperationError("get-deployment", errorCode);
    }
    return parseDeployment(response);
  }

  async findProductionDeployment(
    projectId: string,
    sourceSha: string,
  ): Promise<DeploymentInfo | null> {
    const query = new URLSearchParams({
      projectId,
      target: "production",
      sha: sourceSha,
      limit: "20",
      teamId: this.teamId,
    });
    const response = await this.rawApi(
      "GET",
      `/v7/deployments?${query.toString()}`,
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("find-deployment", errorCode);
    }
    if (!isRecord(response) || !Array.isArray(response.deployments)) {
      throw new ProviderOperationError("find-deployment", "invalid-response");
    }
    for (const candidate of response.deployments) {
      if (!isRecord(candidate)) continue;
      const id = stringOrNull(candidate.uid) ?? stringOrNull(candidate.id);
      if (!id) continue;
      const deployment = await this.getDeployment(id);
      if (
        deployment?.projectId === projectId &&
        deployment.target === "production" &&
        deployment.sourceSha === sourceSha
      ) {
        return deployment;
      }
    }
    return null;
  }

  async moveDomain(
    sourceProjectId: string,
    targetProjectId: string,
    host: string,
    configuration: DomainConfiguration,
  ): Promise<DomainMoveReceipt> {
    const response = await this.rawApi(
      "POST",
      this.teamPath(
        `/v1/projects/${encodeURIComponent(sourceProjectId)}/domains/${encodeURIComponent(host)}/move`,
      ),
      {
        projectId: targetProjectId,
        gitBranch: configuration.gitBranch,
        redirect: configuration.redirect,
        redirectStatusCode: configuration.redirectStatusCode,
      },
    );
    const errorCode = providerErrorCode(response);
    if (errorCode) {
      throw new ProviderOperationError("move-domain", errorCode);
    }
    if (!isRecord(response)) {
      throw new ProviderOperationError("move-domain", "invalid-response");
    }
    const status = response.redirectStatusCode;
    return Object.freeze({
      host: stringOrNull(response.name) ?? host,
      projectId: targetProjectId,
      verified: response.verified === true,
      gitBranch: stringOrNull(response.gitBranch),
      redirect: stringOrNull(response.redirect),
      redirectStatusCode:
        status === 301 || status === 302 || status === 307 || status === 308
          ? status
          : configuration.redirectStatusCode,
      observedAt: new Date().toISOString(),
    });
  }

  async probe(request: ProbeRequest): Promise<ProbeResponse> {
    let response: Response;
    try {
      response = await fetch(request.url, {
        redirect: request.redirect,
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "oceanleo-cutover-controller/1",
        },
      });
    } catch {
      throw new ProviderOperationError("http-probe", "network-failure");
    }
    const headers: Record<string, string> = {};
    for (const name of SAFE_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    let json: unknown = null;
    if (response.headers.get("content-type")?.includes("application/json")) {
      const text = await response.text();
      if (text.length > 65_536) {
        throw new ProviderOperationError("http-probe", "response-too-large");
      }
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new ProviderOperationError("http-probe", "invalid-json");
      }
    } else {
      await response.body?.cancel();
    }
    return Object.freeze({
      status: response.status,
      headers: Object.freeze(headers),
      json,
    });
  }
}
