import {
  synchronizeEnvironment,
  type LoadedEnvironmentMapping,
} from "./environment";
import type {
  InventoryInspector,
  SourceInspector,
  SourceState,
} from "./local-state";
import {
  assertLedgerCompatible,
  createInitialLedger,
  type CutoverLedger,
  type DomainLedgerRecord,
  type LedgerStore,
} from "./ledger";
import type {
  AppProfile,
  CutoverDomain,
  CutoverProvider,
  DeploymentInfo,
  LoadedManifest,
  ProjectDomainInfo,
  ProjectInfo,
  TargetProjectManifest,
  WaveId,
} from "./types";

const PROFILES: readonly AppProfile[] = [
  "standard",
  "website-privileged",
];
const WAVES: readonly WaveId[] = [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
];
const TERMINAL_DEPLOYMENT_FAILURES = new Set([
  "BLOCKED",
  "CANCELED",
  "DELETED",
  "ERROR",
]);

export class CutoverGateError extends Error {
  override name = "CutoverGateError";

  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`Cutover gate failed: ${code}.`);
  }
}

export class CutoverWaveError extends Error {
  override name = "CutoverWaveError";

  constructor(
    readonly wave: WaveId,
    readonly failureCode: string,
    readonly rollbackSucceeded: boolean,
  ) {
    super(
      `${wave} failed (${failureCode}); rollback ${
        rollbackSucceeded ? "completed" : "did not complete"
      }.`,
    );
  }
}

export interface ControllerClock {
  now(): string;
  sleep(milliseconds: number): Promise<void>;
}

const SYSTEM_CLOCK: ControllerClock = Object.freeze({
  now: () => new Date().toISOString(),
  sleep: (milliseconds: number): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
});

export interface CutoverControllerDependencies {
  readonly loaded: LoadedManifest;
  readonly provider: CutoverProvider;
  readonly ledgerStore: LedgerStore;
  readonly sourceInspector: SourceInspector;
  readonly inventoryInspector: InventoryInspector;
  readonly clock?: ControllerClock;
  readonly deploymentPollMilliseconds?: number;
  readonly deploymentTimeoutMilliseconds?: number;
}

interface TargetState {
  readonly projects: Readonly<Record<AppProfile, ProjectInfo>>;
  readonly deployments?: Readonly<Record<AppProfile, DeploymentInfo>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failureCode(error: unknown): string {
  if (error instanceof CutoverGateError) return error.code;
  if (error instanceof Error) return error.name || "error";
  return "unknown-error";
}

function assertFullSha(sourceSha: string): void {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new CutoverGateError("source-sha-invalid");
  }
}

function targetMismatchNames(
  project: ProjectInfo,
  target: TargetProjectManifest,
): readonly string[] {
  const mismatches: string[] = [];
  const expected: readonly [string, unknown, unknown][] = [
    ["name", project.name, target.projectName],
    ["teamId", project.accountId, target.teamId],
    ["framework", project.framework, target.framework],
    ["nodeVersion", project.nodeVersion, target.nodeVersion],
    ["rootDirectory", project.rootDirectory, target.rootDirectory],
    ["installCommand", project.installCommand, target.installCommand],
    ["buildCommand", project.buildCommand, target.buildCommand],
    ["git.type", project.link?.type, target.gitRepository.type],
    ["git.owner", project.link?.org, target.gitRepository.owner],
    ["git.repo", project.link?.repo, target.gitRepository.repo],
    [
      "git.productionBranch",
      project.link?.productionBranch,
      target.productionBranch,
    ],
  ];
  for (const [name, actual, wanted] of expected) {
    if (actual !== wanted) mismatches.push(name);
  }
  return Object.freeze(mismatches);
}

function expectedCanonicalHost(
  domains: readonly CutoverDomain[],
  siteKey: string,
): string {
  const canonical = domains.find(
    (domain) => domain.siteKey === siteKey && domain.kind === "canonical",
  );
  if (!canonical) throw new Error(`${siteKey} has no canonical cutover domain.`);
  return canonical.host;
}

export class CutoverController {
  private readonly loaded: LoadedManifest;
  private readonly provider: CutoverProvider;
  private readonly ledgerStore: LedgerStore;
  private readonly sourceInspector: SourceInspector;
  private readonly inventoryInspector: InventoryInspector;
  private readonly clock: ControllerClock;
  private readonly deploymentPollMilliseconds: number;
  private readonly deploymentTimeoutMilliseconds: number;

  constructor(dependencies: CutoverControllerDependencies) {
    this.loaded = dependencies.loaded;
    this.provider = dependencies.provider;
    this.ledgerStore = dependencies.ledgerStore;
    this.sourceInspector = dependencies.sourceInspector;
    this.inventoryInspector = dependencies.inventoryInspector;
    this.clock = dependencies.clock ?? SYSTEM_CLOCK;
    this.deploymentPollMilliseconds =
      dependencies.deploymentPollMilliseconds ?? 10_000;
    this.deploymentTimeoutMilliseconds =
      dependencies.deploymentTimeoutMilliseconds ?? 30 * 60_000;
  }

  private async gateSource(sourceSha: string): Promise<SourceState> {
    assertFullSha(sourceSha);
    const state = await this.sourceInspector.inspect();
    const problems: string[] = [];
    if (state.branch !== "main") problems.push("branch");
    if (state.dirtyEntryCount !== 0) problems.push("working-tree");
    if (state.headSha !== sourceSha) problems.push("head-sha");
    if (state.originMainSha !== sourceSha) problems.push("origin-main-sha");
    if (problems.length > 0) {
      throw new CutoverGateError("source-state", {
        problems,
        dirtyEntryCount: state.dirtyEntryCount,
      });
    }
    return state;
  }

  private async gateInventory(): Promise<void> {
    const inventory = await this.inventoryInspector.inspect();
    if (
      inventory.pending !== 0 ||
      inventory.partial !== 0 ||
      inventory.domains !== 37
    ) {
      throw new CutoverGateError("inventory-parity", {
        pending: inventory.pending,
        partial: inventory.partial,
        domains: inventory.domains,
      });
    }
  }

  private validateProject(
    project: ProjectInfo,
    target: TargetProjectManifest,
  ): void {
    const mismatches = targetMismatchNames(project, target);
    if (mismatches.length > 0) {
      throw new CutoverGateError("target-project-settings", {
        profile: target.profile,
        mismatches,
      });
    }
  }

  private async discoverProjects(): Promise<
    Readonly<Record<AppProfile, ProjectInfo>>
  > {
    const entries: [AppProfile, ProjectInfo][] = [];
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const project = await this.provider.getProject(target.projectName);
      if (!project) {
        throw new CutoverGateError("target-project-missing", { profile });
      }
      this.validateProject(project, target);
      entries.push([profile, project]);
    }
    return Object.freeze(
      Object.fromEntries(entries) as Record<AppProfile, ProjectInfo>,
    );
  }

  private async discoverOptionalProjects(): Promise<
    Readonly<Partial<Record<AppProfile, ProjectInfo>>>
  > {
    const projects: Partial<Record<AppProfile, ProjectInfo>> = {};
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const project = await this.provider.getProject(target.projectName);
      if (!project) continue;
      this.validateProject(project, target);
      projects[profile] = project;
    }
    return Object.freeze(projects);
  }

  private async gateEnvironment(
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
  ): Promise<void> {
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const records = await this.provider.listEnvironmentKeys(
        projects[profile].id,
      );
      const productionNames = new Set(
        records
          .filter(
            (record) =>
              record.targets.length === 0 ||
              record.targets.includes("production"),
          )
          .map((record) => record.key),
      );
      const missing = target.environment.required.filter(
        (name) => !productionNames.has(name),
      );
      const forbidden = target.environment.forbidden.filter((name) =>
        productionNames.has(name),
      );
      if (missing.length > 0 || forbidden.length > 0) {
        throw new CutoverGateError("environment-contract", {
          profile,
          missing,
          forbidden,
        });
      }
    }
  }

  private async gateW0NoCustomDomains(
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
  ): Promise<void> {
    for (const profile of PROFILES) {
      const domains = await this.provider.listProjectDomains(
        projects[profile].id,
      );
      const custom = domains
        .map((domain) => domain.host)
        .filter((host) => host.endsWith(".oceanleo.com"));
      if (custom.length > 0) {
        throw new CutoverGateError("w0-has-custom-domains", {
          profile,
          domains: custom.sort(),
        });
      }
    }
  }

  private deploymentIsExact(
    deployment: DeploymentInfo,
    project: ProjectInfo,
    sourceSha: string,
  ): boolean {
    return (
      deployment.projectId === project.id &&
      deployment.target === "production" &&
      deployment.sourceSha === sourceSha
    );
  }

  private async discoverReadyDeployments(
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
    sourceSha: string,
    ledger: CutoverLedger | null,
  ): Promise<Readonly<Record<AppProfile, DeploymentInfo>>> {
    const entries: [AppProfile, DeploymentInfo][] = [];
    for (const profile of PROFILES) {
      const ledgerId = ledger?.targets[profile].deployment?.id;
      let deployment = ledgerId
        ? await this.provider.getDeployment(ledgerId)
        : null;
      if (
        !deployment ||
        !this.deploymentIsExact(deployment, projects[profile], sourceSha)
      ) {
        deployment = await this.provider.findProductionDeployment(
          projects[profile].id,
          sourceSha,
        );
      }
      if (
        !deployment ||
        !this.deploymentIsExact(deployment, projects[profile], sourceSha) ||
        deployment.state !== "READY"
      ) {
        throw new CutoverGateError("deployment-not-ready-at-source", {
          profile,
          state: deployment?.state ?? "missing",
        });
      }
      entries.push([profile, deployment]);
    }
    return Object.freeze(
      Object.fromEntries(entries) as Record<AppProfile, DeploymentInfo>,
    );
  }

  private async probeW0(
    deployments: Readonly<Record<AppProfile, DeploymentInfo>>,
  ): Promise<void> {
    for (const profile of PROFILES) {
      const deployment = deployments[profile];
      const response = await this.provider.probe({
        url: `https://${deployment.url}/api/health`,
        redirect: "manual",
      });
      const json = isRecord(response.json) ? response.json : {};
      if (
        response.status !== 404 ||
        response.headers["x-oceanleo-app-profile"] !== profile ||
        json.error !== "unknown-host" ||
        json.status !== 404
      ) {
        throw new CutoverGateError("w0-probe", {
          profile,
          status: response.status,
        });
      }
    }
  }

  private async save(ledger: CutoverLedger): Promise<void> {
    ledger.updatedAt = this.clock.now();
    await this.ledgerStore.save(ledger);
  }

  private async loadLedger(
    sourceSha?: string,
    required = true,
  ): Promise<CutoverLedger | null> {
    const ledger = await this.ledgerStore.load();
    if (!ledger) {
      if (required) throw new CutoverGateError("ledger-missing");
      return null;
    }
    try {
      assertLedgerCompatible(ledger, this.loaded, sourceSha);
    } catch {
      throw new CutoverGateError("ledger-incompatible");
    }
    return ledger;
  }

  private async loadOrCreateLedger(sourceSha: string): Promise<CutoverLedger> {
    const existing = await this.loadLedger(sourceSha, false);
    if (existing) return existing;
    const ledger = createInitialLedger(
      this.loaded,
      sourceSha,
      this.clock.now(),
    );
    await this.save(ledger);
    return ledger;
  }

  private async targetStateForMove(
    sourceSha: string,
    ledger: CutoverLedger,
  ): Promise<TargetState> {
    const projects = await this.discoverProjects();
    await this.gateEnvironment(projects);
    const deployments = await this.discoverReadyDeployments(
      projects,
      sourceSha,
      ledger,
    );
    await this.probeW0(deployments);
    for (const profile of PROFILES) {
      const recordedId = ledger.targets[profile].projectId;
      if (recordedId && recordedId !== projects[profile].id) {
        throw new CutoverGateError("ledger-target-project-drift", { profile });
      }
    }
    return { projects, deployments };
  }

  private expectedOwnerIds(
    domain: CutoverDomain,
    record: DomainLedgerRecord,
    targetProjectId: string,
  ): readonly string[] {
    switch (record.state) {
      case "pending":
      case "rolled-back":
        return [domain.legacyProjectId];
      case "move-requested":
      case "rollback-requested":
      case "rollback-failed":
        return [domain.legacyProjectId, targetProjectId];
      case "owner-verified":
      case "smoke-passed":
        return [targetProjectId];
    }
  }

  private async snapshotOwners(
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
  ): Promise<ReadonlyMap<string, ProjectDomainInfo>> {
    const ids = [
      ...new Set([
        ...this.loaded.manifest.legacyProjects.map(
          (project) => project.projectId,
        ),
        ...PROFILES.map((profile) => projects[profile].id),
      ]),
    ];
    const owners = new Map<string, ProjectDomainInfo>();
    const manifestHosts = new Set(
      this.loaded.domains.map((domain) => domain.host),
    );
    const targetIds = new Set(PROFILES.map((profile) => projects[profile].id));
    for (const projectId of ids) {
      const domains = await this.provider.listProjectDomains(projectId);
      for (const domain of domains) {
        if (owners.has(domain.host)) {
          throw new CutoverGateError("duplicate-domain-owner", {
            host: domain.host,
          });
        }
        owners.set(domain.host, domain);
        if (
          targetIds.has(projectId) &&
          domain.host.endsWith(".oceanleo.com") &&
          !manifestHosts.has(domain.host)
        ) {
          throw new CutoverGateError("unmanifested-target-domain", {
            host: domain.host,
          });
        }
      }
    }
    return owners;
  }

  private async gateOwnership(
    ledger: CutoverLedger,
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
  ): Promise<void> {
    const owners = await this.snapshotOwners(projects);
    const drift: string[] = [];
    for (const domain of this.loaded.domains) {
      const owner = owners.get(domain.host);
      const targetId = projects[domain.profile].id;
      const expected = this.expectedOwnerIds(
        domain,
        ledger.domains[domain.host] as DomainLedgerRecord,
        targetId,
      );
      if (!owner || !expected.includes(owner.projectId) || !owner.verified) {
        drift.push(domain.host);
        continue;
      }
      try {
        this.assertDomainConfiguration(
          owner,
          domain,
          owner.projectId === domain.legacyProjectId
            ? "rollback"
            : "forward",
        );
      } catch {
        drift.push(domain.host);
      }
    }
    if (drift.length > 0) {
      throw new CutoverGateError("domain-owner-drift", {
        domains: drift.sort(),
      });
    }
  }

  private assertWaveOrder(ledger: CutoverLedger, wave: WaveId): void {
    const index = WAVES.indexOf(wave);
    if (index < 0) throw new CutoverGateError("wave-invalid");
    for (const earlier of WAVES.slice(0, index)) {
      if (ledger.waves[earlier].state !== "complete") {
        throw new CutoverGateError("earlier-wave-incomplete", {
          wave,
          earlier,
        });
      }
    }
    for (const later of WAVES.slice(index + 1)) {
      if (ledger.waves[later].state !== "pending") {
        throw new CutoverGateError("later-wave-already-touched", {
          wave,
          later,
        });
      }
    }
    if (
      !["pending", "in-progress", "complete", "rolled-back"].includes(
        ledger.waves[wave].state,
      )
    ) {
      throw new CutoverGateError("wave-state-blocked", {
        wave,
        state: ledger.waves[wave].state,
      });
    }
  }

  private async locateDomain(
    domain: CutoverDomain,
    targetProjectId: string,
  ): Promise<ProjectDomainInfo | null> {
    const [legacyDomains, targetDomains] = await Promise.all([
      this.provider.listProjectDomains(domain.legacyProjectId),
      this.provider.listProjectDomains(targetProjectId),
    ]);
    const matches = [...legacyDomains, ...targetDomains].filter(
      (candidate) => candidate.host === domain.host,
    );
    if (matches.length > 1) {
      throw new CutoverGateError("duplicate-domain-owner", {
        host: domain.host,
      });
    }
    return matches[0] ?? null;
  }

  private assertDomainConfiguration(
    observed: ProjectDomainInfo,
    domain: CutoverDomain,
    direction: "forward" | "rollback",
  ): void {
    const expected =
      direction === "forward"
        ? domain.forwardConfiguration
        : domain.rollbackConfiguration;
    if (
      !observed.verified ||
      observed.gitBranch !== expected.gitBranch ||
      observed.redirect !== expected.redirect ||
      observed.redirectStatusCode !== expected.redirectStatusCode
    ) {
      throw new CutoverGateError("domain-configuration", {
        host: domain.host,
        direction,
      });
    }
  }

  private async smokeAlias(domain: CutoverDomain): Promise<void> {
    const probePath = "/__cutover_alias_probe__?cutover=1";
    const response = await this.provider.probe({
      url: `https://${domain.host}${probePath}`,
      redirect: "manual",
    });
    const location = response.headers.location;
    let target: URL | null = null;
    try {
      target = location
        ? new URL(location, `https://${domain.host}${probePath}`)
        : null;
    } catch {
      target = null;
    }
    const canonical = expectedCanonicalHost(
      this.loaded.domains,
      domain.siteKey,
    );
    if (
      response.status !== 308 ||
      target?.protocol !== "https:" ||
      target.host !== canonical ||
      target.pathname !== "/__cutover_alias_probe__"
    ) {
      throw new CutoverGateError("alias-smoke", {
        host: domain.host,
        status: response.status,
      });
    }
  }

  private assertIsolationHeaders(
    response: { readonly headers: Readonly<Record<string, string>> },
    domain: CutoverDomain,
  ): void {
    if (
      response.headers["x-oceanleo-app-profile"] !== domain.profile ||
      response.headers["x-oceanleo-tenant"] !== domain.siteKey
    ) {
      throw new CutoverGateError("tenant-isolation-headers", {
        host: domain.host,
      });
    }
  }

  private async smokeCanonical(domain: CutoverDomain): Promise<void> {
    const health = await this.provider.probe({
      url: `https://${domain.host}/api/health`,
      redirect: "manual",
    });
    const healthJson = isRecord(health.json) ? health.json : {};
    if (
      health.status !== 200 ||
      healthJson.ok !== true ||
      healthJson.appProfile !== domain.profile ||
      healthJson.siteKey !== domain.siteKey ||
      healthJson.canonicalHost !== domain.host ||
      healthJson.matchedHost !== domain.host ||
      healthJson.matchedDomainKind !== "canonical"
    ) {
      throw new CutoverGateError("health-smoke", {
        host: domain.host,
        status: health.status,
      });
    }
    this.assertIsolationHeaders(health, domain);

    const tenant = await this.provider.probe({
      url: `https://${domain.host}/api/tenant`,
      redirect: "manual",
    });
    const tenantJson = isRecord(tenant.json) ? tenant.json : {};
    if (
      tenant.status !== 200 ||
      tenantJson.siteKey !== domain.siteKey ||
      tenantJson.profile !== domain.profile ||
      tenantJson.canonicalHost !== domain.host
    ) {
      throw new CutoverGateError("tenant-smoke", {
        host: domain.host,
        status: tenant.status,
      });
    }
    this.assertIsolationHeaders(tenant, domain);

    const specialized = await this.provider.probe({
      url: `https://${domain.host}${domain.specializedPath}`,
      redirect: "manual",
    });
    if (
      specialized.status < 200 ||
      specialized.status >= 500 ||
      [404, 421, 501].includes(specialized.status)
    ) {
      throw new CutoverGateError("specialized-route-smoke", {
        host: domain.host,
        status: specialized.status,
      });
    }
    this.assertIsolationHeaders(specialized, domain);
  }

  private async smokeDomain(domain: CutoverDomain): Promise<void> {
    if (domain.kind === "alias") {
      await this.smokeAlias(domain);
    } else {
      await this.smokeCanonical(domain);
    }
  }

  private async rollbackWaveLocked(
    ledger: CutoverLedger,
    wave: WaveId,
    projects: Readonly<Record<AppProfile, ProjectInfo>>,
  ): Promise<boolean> {
    const waveRecord = ledger.waves[wave];
    waveRecord.state = "rolling-back";
    await this.save(ledger);
    const domains = this.loaded.domains
      .filter((domain) => domain.wave === wave)
      .slice()
      .reverse();
    let succeeded = true;
    for (const domain of domains) {
      const record = ledger.domains[domain.host] as DomainLedgerRecord;
      const targetProjectId = projects[domain.profile].id;
      try {
        const owner = await this.locateDomain(domain, targetProjectId);
        if (owner?.projectId === domain.legacyProjectId) {
          this.assertDomainConfiguration(owner, domain, "rollback");
        } else if (owner?.projectId === targetProjectId) {
          record.state = "rollback-requested";
          record.rollbackAttempts += 1;
          await this.save(ledger);
          const receipt = await this.provider.moveDomain(
            targetProjectId,
            domain.rollbackOwnerProjectId,
            domain.host,
            domain.rollbackConfiguration,
          );
          record.rollbackReceipt = receipt;
          await this.save(ledger);
          const returned = await this.locateDomain(domain, targetProjectId);
          if (returned?.projectId !== domain.rollbackOwnerProjectId) {
            throw new CutoverGateError("rollback-owner-verification", {
              host: domain.host,
            });
          }
          this.assertDomainConfiguration(returned, domain, "rollback");
        } else {
          throw new CutoverGateError("rollback-owner-drift", {
            host: domain.host,
          });
        }
        if (domain.host === "ppt.oceanleo.com") {
          await this.smokeAlias(domain);
        }
        record.state = "rolled-back";
        record.currentOwnerProjectId = domain.rollbackOwnerProjectId;
        record.rolledBackAt = this.clock.now();
        delete record.failureCode;
        await this.save(ledger);
      } catch (error) {
        succeeded = false;
        record.state = "rollback-failed";
        record.failureCode = failureCode(error);
        await this.save(ledger);
      }
    }
    waveRecord.state = succeeded ? "rolled-back" : "rollback-failed";
    waveRecord.completedAt = this.clock.now();
    await this.save(ledger);
    return succeeded;
  }

  private async gateMove(
    sourceSha: string,
    wave: WaveId,
    ledger: CutoverLedger,
  ): Promise<TargetState> {
    await this.gateSource(sourceSha);
    await this.gateInventory();
    this.assertWaveOrder(ledger, wave);
    const targets = await this.targetStateForMove(sourceSha, ledger);
    await this.gateOwnership(ledger, targets.projects);
    const firstW1Attempt =
      wave === "W1" &&
      ledger.waves.W1.state === "pending" &&
      this.loaded.domains
        .filter((domain) => domain.wave === "W1")
        .every(
          (domain) =>
            ledger.domains[domain.host]?.state === "pending",
        );
    if (firstW1Attempt) {
      await this.gateW0NoCustomDomains(targets.projects);
    }
    return targets;
  }

  plan(sourceSha: string, wave?: WaveId): Readonly<Record<string, unknown>> {
    assertFullSha(sourceSha);
    if (wave && !WAVES.includes(wave)) {
      throw new CutoverGateError("wave-invalid");
    }
    return Object.freeze({
      dryRun: true,
      sourceSha,
      manifestSha256: this.loaded.digest,
      teamId: this.loaded.manifest.discovery.teamId,
      targets: PROFILES.map((profile) => ({
        profile,
        projectName: this.loaded.manifest.targets[profile].projectName,
        rootDirectory: this.loaded.manifest.targets[profile].rootDirectory,
      })),
      waves: this.loaded.manifest.waves.map((entry) => ({
        id: entry.id,
        name: entry.name,
        domains: this.loaded.domains.filter(
          (domain) => domain.wave === entry.id,
        ).length,
      })),
      selectedWave: wave ?? null,
      mutations: false,
    });
  }

  async check(
    sourceSha: string,
    wave?: WaveId,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.gateSource(sourceSha);
    await this.gateInventory();
    const ledger = await this.loadLedger(sourceSha, false);
    const projects = await this.discoverProjects();
    await this.gateEnvironment(projects);
    const deployments = await this.discoverReadyDeployments(
      projects,
      sourceSha,
      ledger,
    );
    await this.probeW0(deployments);
    if (ledger) {
      if (wave) this.assertWaveOrder(ledger, wave);
      await this.gateOwnership(ledger, projects);
    } else {
      const initial = createInitialLedger(
        this.loaded,
        sourceSha,
        this.clock.now(),
      );
      await this.gateOwnership(initial, projects);
      await this.gateW0NoCustomDomains(projects);
    }
    return Object.freeze({
      ok: true,
      sourceSha,
      manifestSha256: this.loaded.digest,
      domains: this.loaded.domains.length,
      selectedWave: wave ?? null,
      mutations: false,
    });
  }

  async createProjects(
    sourceSha: string,
    execute = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.gateSource(sourceSha);
    await this.gateInventory();
    const existing = new Map<AppProfile, ProjectInfo>();
    const missing: AppProfile[] = [];
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const project = await this.provider.getProject(target.projectName);
      if (project) {
        this.validateProject(project, target);
        existing.set(profile, project);
      } else {
        missing.push(profile);
      }
    }
    if (!execute) {
      return Object.freeze({
        dryRun: true,
        existing: [...existing.keys()],
        wouldCreate: missing,
        mutations: false,
      });
    }
    return this.ledgerStore.withExclusiveLock(async () => {
      await this.gateSource(sourceSha);
      await this.gateInventory();
      const ledger = await this.loadOrCreateLedger(sourceSha);
      const created: AppProfile[] = [];
      for (const profile of PROFILES) {
        const target = this.loaded.manifest.targets[profile];
        let project = await this.provider.getProject(target.projectName);
        if (!project) {
          project = await this.provider.createProject(target);
          created.push(profile);
        }
        this.validateProject(project, target);
        const domains = await this.provider.listProjectDomains(project.id);
        if (
          domains.some((domain) => domain.host.endsWith(".oceanleo.com"))
        ) {
          throw new CutoverGateError("new-target-has-custom-domain", {
            profile,
          });
        }
        ledger.targets[profile].projectId = project.id;
        await this.save(ledger);
      }
      return Object.freeze({
        dryRun: false,
        created,
        idempotentExisting: PROFILES.filter(
          (profile) => !created.includes(profile),
        ),
        mutations: created.length > 0,
      });
    });
  }

  async syncEnvironment(
    sourceSha: string,
    environment: LoadedEnvironmentMapping,
    execute = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    const operation = async (): Promise<Readonly<Record<string, unknown>>> => {
      await this.gateSource(sourceSha);
      await this.gateInventory();
      const projects = await this.discoverOptionalProjects();
      return synchronizeEnvironment(
        this.loaded,
        environment,
        this.provider,
        projects,
        execute,
      );
    };
    if (!execute) return operation();
    return this.ledgerStore.withExclusiveLock(operation);
  }

  private async waitForDeployment(
    initial: DeploymentInfo,
    project: ProjectInfo,
    sourceSha: string,
    ledger: CutoverLedger,
    profile: AppProfile,
  ): Promise<DeploymentInfo> {
    let deployment = initial;
    let elapsed = 0;
    while (deployment.state !== "READY") {
      if (TERMINAL_DEPLOYMENT_FAILURES.has(deployment.state)) {
        throw new CutoverGateError("deployment-terminal-failure", {
          profile,
          state: deployment.state,
        });
      }
      if (elapsed >= this.deploymentTimeoutMilliseconds) {
        throw new CutoverGateError("deployment-timeout", { profile });
      }
      await this.clock.sleep(this.deploymentPollMilliseconds);
      elapsed += this.deploymentPollMilliseconds;
      const refreshed = await this.provider.getDeployment(deployment.id);
      if (!refreshed) {
        throw new CutoverGateError("deployment-disappeared", { profile });
      }
      deployment = refreshed;
      ledger.targets[profile].deployment = {
        id: deployment.id,
        url: deployment.url,
        sourceSha: deployment.sourceSha ?? "",
        state: deployment.state,
        observedAt: this.clock.now(),
      };
      await this.save(ledger);
    }
    if (!this.deploymentIsExact(deployment, project, sourceSha)) {
      throw new CutoverGateError("deployment-source-drift", { profile });
    }
    return deployment;
  }

  async deploy(
    sourceSha: string,
    execute = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.gateSource(sourceSha);
    await this.gateInventory();
    const projects = await this.discoverProjects();
    await this.gateEnvironment(projects);
    await this.gateW0NoCustomDomains(projects);
    if (!execute) {
      return Object.freeze({
        dryRun: true,
        wouldDeploy: PROFILES,
        sourceSha,
        mutations: false,
      });
    }
    return this.ledgerStore.withExclusiveLock(async () => {
      await this.gateSource(sourceSha);
      await this.gateInventory();
      const lockedProjects = await this.discoverProjects();
      await this.gateEnvironment(lockedProjects);
      await this.gateW0NoCustomDomains(lockedProjects);
      const ledger = await this.loadOrCreateLedger(sourceSha);
      const readyEntries: [AppProfile, DeploymentInfo][] = [];
      for (const profile of PROFILES) {
        const project = lockedProjects[profile];
        ledger.targets[profile].projectId = project.id;
        let deployment: DeploymentInfo | null = null;
        const recordedId = ledger.targets[profile].deployment?.id;
        if (recordedId) {
          const candidate = await this.provider.getDeployment(recordedId);
          if (
            candidate &&
            this.deploymentIsExact(candidate, project, sourceSha) &&
            !TERMINAL_DEPLOYMENT_FAILURES.has(candidate.state)
          ) {
            deployment = candidate;
          }
        }
        deployment ??= await this.provider.findProductionDeployment(
          project.id,
          sourceSha,
        );
        if (!deployment) {
          deployment = await this.provider.startDeployment(
            project,
            this.loaded.manifest.targets[profile],
            sourceSha,
          );
        }
        if (!this.deploymentIsExact(deployment, project, sourceSha)) {
          deployment =
            (await this.provider.getDeployment(deployment.id)) ??
            deployment;
        }
        if (!this.deploymentIsExact(deployment, project, sourceSha)) {
          throw new CutoverGateError("deployment-source-drift", { profile });
        }
        ledger.targets[profile].deployment = {
          id: deployment.id,
          url: deployment.url,
          sourceSha: deployment.sourceSha ?? "",
          state: deployment.state,
          observedAt: this.clock.now(),
        };
        await this.save(ledger);
        const ready = await this.waitForDeployment(
          deployment,
          project,
          sourceSha,
          ledger,
          profile,
        );
        readyEntries.push([profile, ready]);
      }
      const ready = Object.freeze(
        Object.fromEntries(readyEntries) as Record<AppProfile, DeploymentInfo>,
      );
      await this.probeW0(ready);
      await this.gateW0NoCustomDomains(lockedProjects);
      return Object.freeze({
        dryRun: false,
        sourceSha,
        deployments: Object.fromEntries(
          PROFILES.map((profile) => [
            profile,
            {
              id: ready[profile].id,
              state: ready[profile].state,
              sourceSha: ready[profile].sourceSha,
            },
          ]),
        ),
        mutations: true,
      });
    });
  }

  async move(
    sourceSha: string,
    wave: WaveId,
    execute = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    const ledger = await this.loadLedger(sourceSha);
    if (!ledger) throw new CutoverGateError("ledger-missing");
    const targets = await this.gateMove(sourceSha, wave, ledger);
    const waveDomains = this.loaded.domains.filter(
      (domain) => domain.wave === wave,
    );
    if (!execute) {
      return Object.freeze({
        dryRun: true,
        wave,
        domains: waveDomains.map((domain) => domain.host),
        mutations: false,
      });
    }
    return this.ledgerStore.withExclusiveLock(async () => {
      const lockedLedger = await this.loadLedger(sourceSha);
      if (!lockedLedger) throw new CutoverGateError("ledger-missing");
      const lockedTargets = await this.gateMove(
        sourceSha,
        wave,
        lockedLedger,
      );
      if (lockedLedger.waves[wave].state === "complete") {
        return Object.freeze({
          dryRun: false,
          wave,
          idempotent: true,
          mutations: false,
        });
      }
      lockedLedger.waves[wave].state = "in-progress";
      lockedLedger.waves[wave].startedAt ??= this.clock.now();
      delete lockedLedger.waves[wave].failureCode;
      await this.save(lockedLedger);
      try {
        for (const domain of waveDomains) {
          const record = lockedLedger.domains[
            domain.host
          ] as DomainLedgerRecord;
          const targetProjectId = lockedTargets.projects[domain.profile].id;
          let owner = await this.locateDomain(domain, targetProjectId);
          if (owner?.projectId === targetProjectId) {
            if (
              !["move-requested", "owner-verified", "smoke-passed"].includes(
                record.state,
              )
            ) {
              throw new CutoverGateError("unledgered-target-owner", {
                host: domain.host,
              });
            }
            this.assertDomainConfiguration(owner, domain, "forward");
            record.state = "owner-verified";
            record.currentOwnerProjectId = targetProjectId;
            record.ownerVerifiedAt = this.clock.now();
            await this.save(lockedLedger);
          } else if (owner?.projectId === domain.legacyProjectId) {
            record.state = "move-requested";
            record.moveAttempts += 1;
            delete record.failureCode;
            await this.save(lockedLedger);
            record.moveReceipt = await this.provider.moveDomain(
              domain.legacyProjectId,
              targetProjectId,
              domain.host,
              domain.forwardConfiguration,
            );
            await this.save(lockedLedger);
            owner = await this.locateDomain(domain, targetProjectId);
            if (owner?.projectId !== targetProjectId) {
              throw new CutoverGateError("post-move-owner-verification", {
                host: domain.host,
              });
            }
            this.assertDomainConfiguration(owner, domain, "forward");
            record.state = "owner-verified";
            record.currentOwnerProjectId = targetProjectId;
            record.ownerVerifiedAt = this.clock.now();
            await this.save(lockedLedger);
          } else {
            throw new CutoverGateError("domain-owner-drift", {
              domains: [domain.host],
            });
          }
          await this.smokeDomain(domain);
          record.state = "smoke-passed";
          record.smokeVerifiedAt = this.clock.now();
          await this.save(lockedLedger);
        }
        lockedLedger.waves[wave].state = "complete";
        lockedLedger.waves[wave].completedAt = this.clock.now();
        await this.save(lockedLedger);
        return Object.freeze({
          dryRun: false,
          wave,
          moved: waveDomains.length,
          mutations: true,
        });
      } catch (error) {
        const code = failureCode(error);
        lockedLedger.waves[wave].failureCode = code;
        await this.save(lockedLedger);
        const rollbackSucceeded = await this.rollbackWaveLocked(
          lockedLedger,
          wave,
          lockedTargets.projects,
        );
        throw new CutoverWaveError(wave, code, rollbackSucceeded);
      }
    });
  }

  private currentRollbackWave(ledger: CutoverLedger): WaveId {
    for (const wave of [...WAVES].reverse()) {
      if (
        ["complete", "in-progress", "rolling-back", "rollback-failed"].includes(
          ledger.waves[wave].state,
        )
      ) {
        return wave;
      }
    }
    throw new CutoverGateError("no-current-wave-to-rollback");
  }

  private async discoverRollbackProjects(
    ledger: CutoverLedger,
  ): Promise<Readonly<Record<AppProfile, ProjectInfo>>> {
    const entries: [AppProfile, ProjectInfo][] = [];
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const project = await this.provider.getProject(target.projectName);
      if (
        !project ||
        project.accountId !== target.teamId ||
        (ledger.targets[profile].projectId !== undefined &&
          ledger.targets[profile].projectId !== project.id)
      ) {
        throw new CutoverGateError("rollback-target-identity", { profile });
      }
      entries.push([profile, project]);
    }
    return Object.freeze(
      Object.fromEntries(entries) as Record<AppProfile, ProjectInfo>,
    );
  }

  async rollback(
    requestedWave?: WaveId,
    execute = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    const ledger = await this.loadLedger();
    if (!ledger) throw new CutoverGateError("ledger-missing");
    const wave = this.currentRollbackWave(ledger);
    if (requestedWave && requestedWave !== wave) {
      throw new CutoverGateError("rollback-not-current-wave", {
        requestedWave,
        currentWave: wave,
      });
    }
    await this.discoverRollbackProjects(ledger);
    const domains = this.loaded.domains
      .filter((domain) => domain.wave === wave)
      .slice()
      .reverse();
    if (!execute) {
      return Object.freeze({
        dryRun: true,
        wave,
        domains: domains.map((domain) => domain.host),
        mutations: false,
      });
    }
    return this.ledgerStore.withExclusiveLock(async () => {
      const lockedLedger = await this.loadLedger();
      if (!lockedLedger) throw new CutoverGateError("ledger-missing");
      const lockedWave = this.currentRollbackWave(lockedLedger);
      if (lockedWave !== wave) {
        throw new CutoverGateError("rollback-wave-changed");
      }
      const lockedProjects = await this.discoverRollbackProjects(lockedLedger);
      const succeeded = await this.rollbackWaveLocked(
        lockedLedger,
        wave,
        lockedProjects,
      );
      if (!succeeded) {
        throw new CutoverWaveError(wave, "rollback-failed", false);
      }
      return Object.freeze({
        dryRun: false,
        wave,
        rolledBack: domains.length,
        mutations: true,
      });
    });
  }

  async status(): Promise<Readonly<Record<string, unknown>>> {
    const ledger = await this.loadLedger(undefined, false);
    const targets: Record<string, unknown> = {};
    const targetProjects = new Map<AppProfile, ProjectInfo>();
    for (const profile of PROFILES) {
      const target = this.loaded.manifest.targets[profile];
      const project = await this.provider.getProject(target.projectName);
      if (!project) {
        targets[profile] = { exists: false };
        continue;
      }
      targetProjects.set(profile, project);
      const mismatches = targetMismatchNames(project, target);
      targets[profile] = {
        exists: true,
        projectId: project.id,
        settingsMatch: mismatches.length === 0,
        mismatches,
      };
    }
    let ownership: unknown = null;
    if (targetProjects.size === PROFILES.length) {
      const projects = Object.fromEntries(targetProjects) as Record<
        AppProfile,
        ProjectInfo
      >;
      const owners = await this.snapshotOwners(projects);
      const byProject = new Map<string, number>();
      for (const domain of this.loaded.domains) {
        const ownerId = owners.get(domain.host)?.projectId ?? "missing";
        byProject.set(ownerId, (byProject.get(ownerId) ?? 0) + 1);
      }
      ownership = Object.fromEntries(
        [...byProject.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }
    return Object.freeze({
      manifestVersion: this.loaded.manifest.manifestVersion,
      manifestSha256: this.loaded.digest,
      exactDomains: this.loaded.domains.length,
      targets,
      ledger: ledger
        ? {
            sourceSha: ledger.sourceSha,
            updatedAt: ledger.updatedAt,
            waves: Object.fromEntries(
              WAVES.map((wave) => [wave, ledger.waves[wave].state]),
            ),
          }
        : null,
      ownership,
      mutations: false,
    });
  }
}
