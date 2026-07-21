export type AppProfile = "standard" | "website-privileged";
export type WaveId = "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7";
export type DomainKind = "canonical" | "alias";

export interface EnvironmentContract {
  readonly required: readonly string[];
  readonly forbidden: readonly string[];
  /** Present on target but not gated for deploy; may have blocked mappings. */
  readonly optional?: readonly string[];
}

export interface TargetProjectManifest {
  readonly profile: AppProfile;
  readonly projectName: string;
  readonly teamId: string;
  readonly rootDirectory: string;
  readonly framework: "nextjs";
  readonly nodeVersion: "24.x";
  readonly productionBranch: "main";
  readonly gitRepository: Readonly<{
    type: "github";
    owner: string;
    repo: string;
  }>;
  readonly installCommand: string;
  readonly buildCommand: string;
  readonly environment: EnvironmentContract;
}

export interface LegacyProjectManifest {
  readonly siteKey: string;
  readonly projectName: string;
  readonly projectId: string;
  readonly repository: string;
}

export interface DomainConfiguration {
  readonly gitBranch: string | null;
  readonly redirect: string | null;
  readonly redirectStatusCode: 301 | 302 | 307 | 308 | null;
}

export interface TenantDomainManifest {
  readonly host: string;
  readonly kind: DomainKind;
  readonly configuration?: DomainConfiguration;
}

export interface WaveTenantManifest {
  readonly siteKey: string;
  readonly profile: AppProfile;
  readonly specializedPath: `/${string}`;
  readonly domains: readonly TenantDomainManifest[];
}

export interface WaveManifest {
  readonly id: WaveId;
  readonly name: string;
  readonly tenants: readonly WaveTenantManifest[];
}

export interface CutoverManifest {
  readonly schemaVersion: "oceanleo.two-project-cutover.v1";
  readonly manifestVersion: string;
  readonly discovery: Readonly<{
    sitesTsv: string;
    provider: "vercel-ops";
    reviewedAt: string;
    teamId: string;
    customDomainCount: 37;
    legacyProjectCount: 31;
  }>;
  readonly source: Readonly<{
    repositoryRoot: string;
    githubRepository: string;
    branch: "main";
  }>;
  readonly targets: Readonly<Record<AppProfile, TargetProjectManifest>>;
  readonly legacyProjects: readonly LegacyProjectManifest[];
  readonly waves: readonly WaveManifest[];
}

export interface CutoverDomain {
  readonly sequence: number;
  readonly wave: WaveId;
  readonly siteKey: string;
  readonly profile: AppProfile;
  readonly specializedPath: `/${string}`;
  readonly host: string;
  readonly kind: DomainKind;
  readonly targetProjectName: string;
  readonly legacyProjectName: string;
  readonly legacyProjectId: string;
  readonly legacyRepository: string;
  readonly forwardConfiguration: DomainConfiguration;
  readonly rollbackOwnerProjectId: string;
  readonly rollbackConfiguration: DomainConfiguration;
}

export interface LoadedManifest {
  readonly manifest: CutoverManifest;
  readonly digest: string;
  readonly domains: readonly CutoverDomain[];
}

export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly framework: string | null;
  readonly nodeVersion: string | null;
  readonly rootDirectory: string | null;
  readonly installCommand: string | null;
  readonly buildCommand: string | null;
  readonly link: Readonly<{
    type: string | null;
    org: string | null;
    repo: string | null;
    productionBranch: string | null;
  }> | null;
}

export interface ProjectDomainInfo extends DomainConfiguration {
  readonly host: string;
  readonly verified: boolean;
  readonly projectId: string;
}

export interface EnvironmentKeyInfo {
  readonly key: string;
  readonly targets: readonly string[];
}

export type EnvironmentVariableType =
  | "plain"
  | "encrypted"
  | "sensitive"
  | "secret"
  | "system";

export interface EnvironmentValueInfo extends EnvironmentKeyInfo {
  readonly id: string;
  readonly type: EnvironmentVariableType;
  readonly value: string | null;
}

export interface EnvironmentWriteInput {
  readonly existingId: string | null;
  readonly key: string;
  readonly type: "plain" | "encrypted";
  readonly value: string;
  readonly targets: readonly ["production"];
}

export type DeploymentState =
  | "BLOCKED"
  | "BUILDING"
  | "CANCELED"
  | "DELETED"
  | "ERROR"
  | "INITIALIZING"
  | "QUEUED"
  | "READY";

export interface DeploymentInfo {
  readonly id: string;
  readonly projectId: string;
  readonly url: string;
  readonly state: DeploymentState;
  readonly target: string | null;
  readonly sourceSha: string | null;
}

export interface DomainMoveReceipt extends DomainConfiguration {
  readonly host: string;
  readonly projectId: string;
  readonly verified: boolean;
  readonly observedAt: string;
}

export interface ProbeRequest {
  readonly url: string;
  readonly redirect: "manual";
}

export interface ProbeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: unknown;
}

export interface CutoverProvider {
  getProject(idOrName: string): Promise<ProjectInfo | null>;
  createProject(target: TargetProjectManifest): Promise<ProjectInfo>;
  listProjectDomains(projectId: string): Promise<readonly ProjectDomainInfo[]>;
  listEnvironmentKeys(projectId: string): Promise<readonly EnvironmentKeyInfo[]>;
  readEnvironmentValues(
    projectId: string,
  ): Promise<readonly EnvironmentValueInfo[]>;
  upsertEnvironmentVariable(
    projectId: string,
    input: EnvironmentWriteInput,
  ): Promise<void>;
  startDeployment(
    project: ProjectInfo,
    target: TargetProjectManifest,
    sourceSha: string,
  ): Promise<DeploymentInfo>;
  getDeployment(deploymentId: string): Promise<DeploymentInfo | null>;
  findProductionDeployment(
    projectId: string,
    sourceSha: string,
  ): Promise<DeploymentInfo | null>;
  moveDomain(
    sourceProjectId: string,
    targetProjectId: string,
    host: string,
    configuration: DomainConfiguration,
  ): Promise<DomainMoveReceipt>;
  probe(request: ProbeRequest): Promise<ProbeResponse>;
}
