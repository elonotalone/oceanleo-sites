import assert from "node:assert/strict";
import test from "node:test";

import {
  CutoverController,
  CutoverGateError,
  CutoverWaveError,
  type ControllerClock,
} from "../deploy/controller";
import {
  createInitialLedger,
  type CutoverLedger,
  type LedgerStore,
} from "../deploy/ledger";
import type {
  InventoryInspector,
  InventoryState,
  SourceInspector,
  SourceState,
} from "../deploy/local-state";
import { loadCutoverManifest } from "../deploy/manifest";
import type {
  AppProfile,
  CutoverProvider,
  DeploymentInfo,
  DomainConfiguration,
  DomainMoveReceipt,
  EnvironmentKeyInfo,
  EnvironmentValueInfo,
  EnvironmentWriteInput,
  LoadedManifest,
  ProbeRequest,
  ProbeResponse,
  ProjectDomainInfo,
  ProjectInfo,
  TargetProjectManifest,
} from "../deploy/types";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const FIXED_TIME = "2026-07-21T15:00:00.000Z";
const TARGET_IDS: Readonly<Record<AppProfile, string>> = {
  standard: "prj_target_standard",
  "website-privileged": "prj_target_website_privileged",
};

class MemoryLedgerStore implements LedgerStore {
  ledger: CutoverLedger | null = null;

  async load(): Promise<CutoverLedger | null> {
    return this.ledger ? structuredClone(this.ledger) : null;
  }

  async save(ledger: CutoverLedger): Promise<void> {
    this.ledger = structuredClone(ledger);
  }

  async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class FakeSourceInspector implements SourceInspector {
  state: SourceState = {
    branch: "main",
    headSha: SOURCE_SHA,
    originMainSha: SOURCE_SHA,
    dirtyEntryCount: 0,
  };

  async inspect(): Promise<SourceState> {
    return this.state;
  }
}

class FakeInventoryInspector implements InventoryInspector {
  state: InventoryState = {
    pending: 0,
    partial: 0,
    entries: 233,
    domains: 37,
  };

  async inspect(): Promise<InventoryState> {
    return this.state;
  }
}

interface MoveCall {
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly host: string;
}

class FakeProvider implements CutoverProvider {
  readonly projects = new Map<string, ProjectInfo>();
  readonly owners = new Map<string, string>();
  readonly configurations = new Map<string, DomainConfiguration>();
  readonly environments = new Map<AppProfile, string[]>();
  readonly deployments = new Map<string, DeploymentInfo>();
  readonly moves: MoveCall[] = [];
  readonly creates: AppProfile[] = [];
  failSpecializedHost: string | null = null;

  constructor(readonly loaded: LoadedManifest) {
    for (const profile of [
      "standard",
      "website-privileged",
    ] satisfies readonly AppProfile[]) {
      const target = loaded.manifest.targets[profile];
      const project = this.projectFor(target, TARGET_IDS[profile]);
      this.projects.set(target.projectName, project);
      this.projects.set(project.id, project);
      this.environments.set(profile, [...target.environment.required]);
      const deployment: DeploymentInfo = {
        id: `dpl_${profile}`,
        projectId: project.id,
        url:
          profile === "standard"
            ? "standard-cutover.vercel.app"
            : "website-cutover.vercel.app",
        state: "READY",
        target: "production",
        sourceSha: SOURCE_SHA,
      };
      this.deployments.set(deployment.id, deployment);
    }
    for (const domain of loaded.domains) {
      this.owners.set(domain.host, domain.legacyProjectId);
      this.configurations.set(
        domain.host,
        structuredClone(domain.rollbackConfiguration),
      );
    }
  }

  private projectFor(
    target: TargetProjectManifest,
    id: string,
  ): ProjectInfo {
    return {
      id,
      name: target.projectName,
      accountId: target.teamId,
      framework: target.framework,
      nodeVersion: target.nodeVersion,
      rootDirectory: target.rootDirectory,
      installCommand: target.installCommand,
      buildCommand: target.buildCommand,
      link: {
        type: target.gitRepository.type,
        org: target.gitRepository.owner,
        repo: target.gitRepository.repo,
        productionBranch: target.productionBranch,
      },
    };
  }

  removeTarget(profile: AppProfile): void {
    const target = this.loaded.manifest.targets[profile];
    const project = this.projects.get(target.projectName);
    this.projects.delete(target.projectName);
    if (project) this.projects.delete(project.id);
  }

  async getProject(idOrName: string): Promise<ProjectInfo | null> {
    return this.projects.get(idOrName) ?? null;
  }

  async createProject(target: TargetProjectManifest): Promise<ProjectInfo> {
    this.creates.push(target.profile);
    const project = this.projectFor(target, TARGET_IDS[target.profile]);
    this.projects.set(target.projectName, project);
    this.projects.set(project.id, project);
    return project;
  }

  async listProjectDomains(
    projectId: string,
  ): Promise<readonly ProjectDomainInfo[]> {
    return [...this.owners.entries()]
      .filter(([, owner]) => owner === projectId)
      .map(([host]) => {
        const configuration = this.configurations.get(host);
        assert.ok(configuration);
        return {
          host,
          projectId,
          verified: true,
          ...configuration,
        };
      });
  }

  async listEnvironmentKeys(
    projectId: string,
  ): Promise<readonly EnvironmentKeyInfo[]> {
    const profile =
      projectId === TARGET_IDS.standard
        ? "standard"
        : "website-privileged";
    return (this.environments.get(profile) ?? []).map((key) => ({
      key,
      targets: ["production"],
    }));
  }

  async readEnvironmentValues(
    projectId: string,
  ): Promise<readonly EnvironmentValueInfo[]> {
    return (await this.listEnvironmentKeys(projectId)).map((record, index) => ({
      id: `env_${projectId}_${index}`,
      key: record.key,
      targets: record.targets,
      type: "encrypted",
      value: "test-only-value",
    }));
  }

  async upsertEnvironmentVariable(
    _projectId: string,
    _input: EnvironmentWriteInput,
  ): Promise<void> {
    throw new Error("Environment writes are not used by controller tests.");
  }

  async startDeployment(
    project: ProjectInfo,
    target: TargetProjectManifest,
    sourceSha: string,
  ): Promise<DeploymentInfo> {
    const deployment: DeploymentInfo = {
      id: `dpl_started_${target.profile}`,
      projectId: project.id,
      url: `${target.profile}-started.vercel.app`,
      state: "READY",
      target: "production",
      sourceSha,
    };
    this.deployments.set(deployment.id, deployment);
    return deployment;
  }

  async getDeployment(
    deploymentId: string,
  ): Promise<DeploymentInfo | null> {
    return this.deployments.get(deploymentId) ?? null;
  }

  async findProductionDeployment(
    projectId: string,
    sourceSha: string,
  ): Promise<DeploymentInfo | null> {
    return (
      [...this.deployments.values()].find(
        (deployment) =>
          deployment.projectId === projectId &&
          deployment.sourceSha === sourceSha &&
          deployment.target === "production",
      ) ?? null
    );
  }

  async moveDomain(
    sourceProjectId: string,
    targetProjectId: string,
    host: string,
    configuration: DomainConfiguration,
  ): Promise<DomainMoveReceipt> {
    assert.equal(this.owners.get(host), sourceProjectId);
    this.moves.push({ sourceProjectId, targetProjectId, host });
    this.owners.set(host, targetProjectId);
    this.configurations.set(host, structuredClone(configuration));
    return {
      host,
      projectId: targetProjectId,
      verified: true,
      ...configuration,
      observedAt: FIXED_TIME,
    };
  }

  async probe(request: ProbeRequest): Promise<ProbeResponse> {
    const url = new URL(request.url);
    if (url.host.endsWith(".vercel.app")) {
      const profile = url.host.includes("website-privileged")
        ? "website-privileged"
        : "standard";
      return {
        status: 404,
        headers: {
          "x-oceanleo-app-profile": profile,
        },
        json: { error: "unknown-host", status: 404 },
      };
    }
    const domain = this.loaded.domains.find(
      (candidate) => candidate.host === url.host,
    );
    assert.ok(domain);
    if (domain.kind === "alias") {
      const canonical = this.loaded.domains.find(
        (candidate) =>
          candidate.siteKey === domain.siteKey &&
          candidate.kind === "canonical",
      );
      assert.ok(canonical);
      return {
        status: 308,
        headers: {
          location: `https://${canonical.host}${url.pathname}${url.search}`,
        },
        json: null,
      };
    }
    const headers = {
      "x-oceanleo-app-profile": domain.profile,
      "x-oceanleo-tenant": domain.siteKey,
    };
    if (url.pathname === "/api/health") {
      return {
        status: 200,
        headers,
        json: {
          ok: true,
          appProfile: domain.profile,
          siteKey: domain.siteKey,
          canonicalHost: domain.host,
          matchedHost: domain.host,
          matchedDomainKind: "canonical",
        },
      };
    }
    if (url.pathname === "/api/tenant") {
      return {
        status: 200,
        headers,
        json: {
          siteKey: domain.siteKey,
          profile: domain.profile,
          canonicalHost: domain.host,
        },
      };
    }
    return {
      status:
        this.failSpecializedHost === domain.host ? 500 : 200,
      headers,
      json: null,
    };
  }
}

const clock: ControllerClock = {
  now: () => FIXED_TIME,
  sleep: async () => undefined,
};

interface Harness {
  readonly loaded: LoadedManifest;
  readonly provider: FakeProvider;
  readonly ledgerStore: MemoryLedgerStore;
  readonly source: FakeSourceInspector;
  readonly inventory: FakeInventoryInspector;
  readonly controller: CutoverController;
}

async function harness(): Promise<Harness> {
  const loaded = await loadCutoverManifest();
  const provider = new FakeProvider(loaded);
  const ledgerStore = new MemoryLedgerStore();
  const source = new FakeSourceInspector();
  const inventory = new FakeInventoryInspector();
  const ledger = createInitialLedger(loaded, SOURCE_SHA, FIXED_TIME);
  for (const profile of [
    "standard",
    "website-privileged",
  ] satisfies readonly AppProfile[]) {
    const deployment = [...provider.deployments.values()].find(
      (candidate) => candidate.projectId === TARGET_IDS[profile],
    );
    assert.ok(deployment);
    ledger.targets[profile] = {
      projectId: TARGET_IDS[profile],
      deployment: {
        id: deployment.id,
        url: deployment.url,
        sourceSha: SOURCE_SHA,
        state: "READY",
        observedAt: FIXED_TIME,
      },
    };
  }
  await ledgerStore.save(ledger);
  const controller = new CutoverController({
    loaded,
    provider,
    ledgerStore,
    sourceInspector: source,
    inventoryInspector: inventory,
    clock,
    deploymentPollMilliseconds: 1,
    deploymentTimeoutMilliseconds: 10,
  });
  return {
    loaded,
    provider,
    ledgerStore,
    source,
    inventory,
    controller,
  };
}

function gateCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof CutoverGateError && error.code === code;
}

test("asset canary smoke failure rolls W1 back and touches no later wave", async () => {
  const state = await harness();
  state.provider.failSpecializedHost = "asset.oceanleo.com";
  await assert.rejects(
    state.controller.move(SOURCE_SHA, "W1", true),
    (error) =>
      error instanceof CutoverWaveError &&
      error.wave === "W1" &&
      error.rollbackSucceeded,
  );
  const asset = state.loaded.domains.find(
    (domain) => domain.host === "asset.oceanleo.com",
  );
  assert.ok(asset);
  assert.deepEqual(
    state.provider.moves.map((move) => ({
      source: move.sourceProjectId,
      target: move.targetProjectId,
      host: move.host,
    })),
    [
      {
        source: asset.legacyProjectId,
        target: TARGET_IDS.standard,
        host: asset.host,
      },
      {
        source: TARGET_IDS.standard,
        target: asset.legacyProjectId,
        host: asset.host,
      },
    ],
  );
  assert.equal(state.provider.owners.get(asset.host), asset.legacyProjectId);
  assert.ok(
    state.loaded.domains
      .filter((domain) => domain.wave !== "W1")
      .every(
        (domain) =>
          state.provider.owners.get(domain.host) ===
          domain.legacyProjectId,
      ),
  );
  assert.equal(state.ledgerStore.ledger?.waves.W1.state, "rolled-back");
  assert.ok(
    ["W2", "W3", "W4", "W5", "W6", "W7"].every(
      (wave) =>
        state.ledgerStore.ledger?.waves[
          wave as keyof CutoverLedger["waves"]
        ].state === "pending",
    ),
  );
});

test("resume observes a completed provider move without moving twice", async () => {
  const state = await harness();
  const asset = state.loaded.domains.find(
    (domain) => domain.host === "asset.oceanleo.com",
  );
  assert.ok(asset);
  state.provider.owners.set(asset.host, TARGET_IDS.standard);
  const ledger = state.ledgerStore.ledger;
  assert.ok(ledger);
  ledger.waves.W1.state = "in-progress";
  ledger.domains[asset.host]!.state = "move-requested";
  ledger.domains[asset.host]!.moveAttempts = 1;
  await state.ledgerStore.save(ledger);

  const result = await state.controller.move(SOURCE_SHA, "W1", true);
  assert.equal(result.moved, 1);
  assert.deepEqual(state.provider.moves, []);
  assert.equal(state.ledgerStore.ledger?.waves.W1.state, "complete");
  assert.equal(
    state.ledgerStore.ledger?.domains[asset.host]?.state,
    "smoke-passed",
  );
});

test("legacy owner drift is rejected before any provider mutation", async () => {
  const state = await harness();
  state.provider.owners.set("asset.oceanleo.com", "prj_unexpected_owner");
  await assert.rejects(
    state.controller.move(SOURCE_SHA, "W1", true),
    gateCode("domain-owner-drift"),
  );
  assert.deepEqual(state.provider.moves, []);
});

test("source SHA, inventory, environment, and deployment gates fail closed", async (t) => {
  await t.test("source SHA", async () => {
    const state = await harness();
    state.source.state = {
      ...state.source.state,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    await assert.rejects(
      state.controller.move(SOURCE_SHA, "W1"),
      gateCode("source-state"),
    );
  });

  await t.test("inventory", async () => {
    const state = await harness();
    state.inventory.state = {
      ...state.inventory.state,
      pending: 1,
    };
    await assert.rejects(
      state.controller.move(SOURCE_SHA, "W1"),
      gateCode("inventory-parity"),
    );
  });

  await t.test("missing environment name", async () => {
    const state = await harness();
    state.provider.environments.set("standard", []);
    await assert.rejects(
      state.controller.move(SOURCE_SHA, "W1"),
      gateCode("environment-contract"),
    );
  });

  await t.test("forbidden cross-profile environment name", async () => {
    const state = await harness();
    state.provider.environments.get("standard")?.push(
      "WEBSITE_VERCEL_TOKEN",
    );
    await assert.rejects(
      state.controller.move(SOURCE_SHA, "W1"),
      gateCode("environment-contract"),
    );
  });

  await t.test("same-SHA READY deployment", async () => {
    const state = await harness();
    const deployment = state.provider.deployments.get("dpl_standard");
    assert.ok(deployment);
    state.provider.deployments.set("dpl_standard", {
      ...deployment,
      sourceSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    await assert.rejects(
      state.controller.move(SOURCE_SHA, "W1"),
      gateCode("deployment-not-ready-at-source"),
    );
  });
});

test("dry-run project creation never mutates and execute is idempotent", async () => {
  const state = await harness();
  state.provider.removeTarget("standard");
  state.provider.removeTarget("website-privileged");
  const dryRun = await state.controller.createProjects(SOURCE_SHA);
  assert.deepEqual(dryRun.wouldCreate, [
    "standard",
    "website-privileged",
  ]);
  assert.deepEqual(state.provider.creates, []);

  await state.controller.createProjects(SOURCE_SHA, true);
  assert.deepEqual(state.provider.creates, [
    "standard",
    "website-privileged",
  ]);
  await state.controller.createProjects(SOURCE_SHA, true);
  assert.deepEqual(state.provider.creates, [
    "standard",
    "website-privileged",
  ]);
});

test("pre-wave ledger rematerializes for a new source SHA", async () => {
  const state = await harness();
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const prior = createInitialLedger(state.loaded, priorSha, FIXED_TIME);
  prior.targets.standard.projectId = TARGET_IDS.standard;
  prior.targets["website-privileged"].projectId =
    TARGET_IDS["website-privileged"];
  prior.targets.standard.deployment = {
    id: "dpl_old",
    url: "https://old.example",
    sourceSha: priorSha,
    state: "READY",
    observedAt: FIXED_TIME,
  };
  state.ledgerStore.ledger = prior;

  const result = await state.controller.deploy(SOURCE_SHA, true);
  assert.equal(result.mutations, true);
  const next = state.ledgerStore.ledger;
  assert.ok(next);
  assert.equal(next.sourceSha, SOURCE_SHA);
  assert.equal(next.manifestSha256, state.loaded.digest);
  assert.equal(next.targets.standard.projectId, TARGET_IDS.standard);
  assert.equal(
    next.targets["website-privileged"].projectId,
    TARGET_IDS["website-privileged"],
  );
  assert.notEqual(next.targets.standard.deployment?.id, "dpl_old");
});
