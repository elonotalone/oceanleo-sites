import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EnvironmentSyncError,
  loadEnvironmentMapping,
  synchronizeEnvironment,
  type EnvironmentMappingContract,
  type EnvironmentMappingEntry,
  type LoadedEnvironmentMapping,
} from "../deploy/environment";
import { loadCutoverManifest } from "../deploy/manifest";
import { VercelOpsProvider } from "../deploy/provider";
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

const TARGET_IDS: Readonly<Record<AppProfile, string>> = {
  standard: "prj_target_standard",
  "website-privileged": "prj_target_website_privileged",
};
const PROFILES: readonly AppProfile[] = [
  "standard",
  "website-privileged",
];

function targetProject(
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

function completeEnvironmentMapping(
  loaded: LoadedManifest,
): LoadedEnvironmentMapping {
  const standardSource = loaded.manifest.legacyProjects.find(
    (project) => project.siteKey === "agent",
  );
  const websiteSource = loaded.manifest.legacyProjects.find(
    (project) => project.siteKey === "website",
  );
  assert.ok(standardSource);
  assert.ok(websiteSource);
  const mappings: EnvironmentMappingEntry[] = PROFILES.flatMap((profile) =>
    loaded.manifest.targets[profile].environment.required.map((targetKey) => {
      const source = profile === "standard" ? standardSource : websiteSource;
      return {
        id: `${profile}.${targetKey}`,
        status: "mapped",
        targetProfile: profile,
        targetKey,
        targetType: targetKey.startsWith("NEXT_PUBLIC_")
          ? "plain"
          : "encrypted",
        sourcePolicy: "all-sources-equal",
        sources: [
          {
            projectName: source.projectName,
            projectId: source.projectId,
            key: targetKey,
            target: "production",
          },
        ],
        provenance: ["deterministic fake-provider fixture"],
      };
    }),
  );
  const contract: EnvironmentMappingContract = {
    schemaVersion: "oceanleo.environment-mapping.v1",
    contractVersion: "test",
    reviewedAt: "2026-07-21T15:24:00Z",
    teamId: loaded.manifest.discovery.teamId,
    provider: "vercel-ops",
    valueHandling: {
      decryptRequested: true,
      valuesPersisted: false,
      valuesLogged: false,
      comparison: "sha256-in-memory",
      writeTransport: "vercel-ops-stdin",
    },
    mappings,
    excluded: [],
    helperReview: [],
  };
  return {
    contract,
    digest: "a".repeat(64),
  };
}

class FakeEnvironmentProvider implements CutoverProvider {
  readonly values = new Map<string, EnvironmentValueInfo[]>();
  readonly projects = new Map<string, ProjectInfo>();
  readonly upserts: Array<{
    projectId: string;
    input: EnvironmentWriteInput;
  }> = [];
  private nextId = 1;

  constructor(readonly loaded: LoadedManifest) {
    for (const profile of PROFILES) {
      const project = targetProject(
        loaded.manifest.targets[profile],
        TARGET_IDS[profile],
      );
      this.projects.set(project.id, project);
      this.projects.set(project.name, project);
      this.values.set(project.id, []);
    }
  }

  seed(projectId: string, key: string, value: string, type = "encrypted"): void {
    const records = this.values.get(projectId) ?? [];
    records.push({
      id: `env_seed_${this.nextId++}`,
      key,
      value,
      type: type === "plain" ? "plain" : "encrypted",
      targets: ["production"],
    });
    this.values.set(projectId, records);
  }

  seedSources(
    environment: LoadedEnvironmentMapping,
    valueFor: (mapping: EnvironmentMappingEntry) => string,
  ): void {
    for (const mapping of environment.contract.mappings) {
      for (const source of mapping.sources) {
        const existing = (this.values.get(source.projectId) ?? []).some(
          (record) => record.key === source.key,
        );
        if (!existing) {
          this.seed(
            source.projectId,
            source.key,
            valueFor(mapping),
            mapping.targetType,
          );
        }
      }
    }
  }

  async getProject(idOrName: string): Promise<ProjectInfo | null> {
    return this.projects.get(idOrName) ?? null;
  }

  async createProject(target: TargetProjectManifest): Promise<ProjectInfo> {
    return targetProject(target, TARGET_IDS[target.profile]);
  }

  async listProjectDomains(
    _projectId: string,
  ): Promise<readonly ProjectDomainInfo[]> {
    return [];
  }

  async listEnvironmentKeys(
    projectId: string,
  ): Promise<readonly EnvironmentKeyInfo[]> {
    return (this.values.get(projectId) ?? []).map(({ key, targets }) => ({
      key,
      targets,
    }));
  }

  async readEnvironmentValues(
    projectId: string,
  ): Promise<readonly EnvironmentValueInfo[]> {
    return structuredClone(this.values.get(projectId) ?? []);
  }

  async upsertEnvironmentVariable(
    projectId: string,
    input: EnvironmentWriteInput,
  ): Promise<void> {
    this.upserts.push({ projectId, input: structuredClone(input) });
    const records = this.values.get(projectId) ?? [];
    const existingIndex = records.findIndex(
      (record) => record.id === input.existingId,
    );
    const replacement: EnvironmentValueInfo = {
      id: input.existingId ?? `env_written_${this.nextId++}`,
      key: input.key,
      type: input.type,
      value: input.value,
      targets: [...input.targets],
    };
    if (existingIndex >= 0) records[existingIndex] = replacement;
    else records.push(replacement);
    this.values.set(projectId, records);
  }

  async startDeployment(
    _project: ProjectInfo,
    _target: TargetProjectManifest,
    _sourceSha: string,
  ): Promise<DeploymentInfo> {
    throw new Error("not used");
  }

  async getDeployment(_deploymentId: string): Promise<DeploymentInfo | null> {
    throw new Error("not used");
  }

  async findProductionDeployment(
    _projectId: string,
    _sourceSha: string,
  ): Promise<DeploymentInfo | null> {
    throw new Error("not used");
  }

  async moveDomain(
    _sourceProjectId: string,
    _targetProjectId: string,
    _host: string,
    _configuration: DomainConfiguration,
  ): Promise<DomainMoveReceipt> {
    throw new Error("not used");
  }

  async probe(_request: ProbeRequest): Promise<ProbeResponse> {
    throw new Error("not used");
  }
}

function targetProjects(
  provider: FakeEnvironmentProvider,
): Readonly<Record<AppProfile, ProjectInfo>> {
  const standard = provider.projects.get(TARGET_IDS.standard);
  const website = provider.projects.get(TARGET_IDS["website-privileged"]);
  assert.ok(standard);
  assert.ok(website);
  return {
    standard,
    "website-privileged": website,
  };
}

test("reviewed mapping covers exact target names without values", async () => {
  const loaded = await loadCutoverManifest();
  const environment = await loadEnvironmentMapping(loaded);
  const text = JSON.stringify(environment.contract);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY.{0,40}source/);
  assert.equal(environment.contract.mappings.length, 14);
  assert.equal(
    environment.contract.mappings.filter(
      (mapping) =>
        mapping.targetProfile === "website-privileged" &&
        mapping.targetKey.startsWith("WEBSITE_"),
    ).length,
    8,
  );
  assert.deepEqual(
    environment.contract.mappings
      .filter(
        (mapping) =>
          mapping.targetProfile === "website-privileged" &&
          mapping.targetKey.startsWith("WEBSITE_") &&
          mapping.status === "mapped",
      )
      .map((mapping) => mapping.targetKey),
    ["WEBSITE_SERVER_SSH_KEY"],
  );
  assert.deepEqual(
    environment.contract.mappings
      .filter((mapping) => mapping.targetProfile === "standard")
      .map((mapping) => mapping.sources.length),
    [27, 26, 27],
  );
  assert.deepEqual(
    environment.contract.mappings
      .filter(
        (mapping) =>
          mapping.targetProfile === "website-privileged" &&
          mapping.targetKey.startsWith("WEBSITE_") &&
          mapping.status === "blocked",
      )
      .map((mapping) => mapping.targetKey)
      .sort(),
    [
      "WEBSITE_ALIYUN_ACCESS_KEY_ID",
      "WEBSITE_ALIYUN_ACCESS_KEY_SECRET",
      "WEBSITE_CLOUDFLARE_API_TOKEN",
      "WEBSITE_GITHUB_TOKEN",
      "WEBSITE_RAILWAY_TOKEN",
      "WEBSITE_SUPABASE_MANAGEMENT_TOKEN",
      "WEBSITE_VERCEL_TOKEN",
    ],
  );
  const sshMapping = environment.contract.mappings.find(
    (mapping) => mapping.targetKey === "WEBSITE_SERVER_SSH_KEY",
  );
  assert.ok(sshMapping);
  assert.deepEqual(sshMapping.sources, [
    {
      projectName: "website",
      projectId: "prj_pTBArlyTCa46sVq6n9R8enGIdho8",
      key: "OCEANLEO_PLATFORM_SSH_PRIVATE_KEY",
      target: "production",
    },
  ]);
  assert.equal(environment.contract.valueHandling.valuesPersisted, false);
  assert.equal(environment.contract.valueHandling.valuesLogged, false);
});

test("dry-run redacts every value and performs no provider mutation", async () => {
  const loaded = await loadCutoverManifest();
  const environment = completeEnvironmentMapping(loaded);
  const provider = new FakeEnvironmentProvider(loaded);
  const sentinel = "never-print-this-secret-value";
  provider.seedSources(environment, () => sentinel);

  const result = await synchronizeEnvironment(
    loaded,
    environment,
    provider,
    targetProjects(provider),
    false,
  );

  assert.equal(provider.upserts.length, 0);
  assert.equal(result.mutations, false);
  assert.equal((result.wouldUpsert as readonly unknown[]).length, 14);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
});

test("source equality disagreement fails before writes and redacts values", async () => {
  const loaded = await loadCutoverManifest();
  const base = completeEnvironmentMapping(loaded);
  const provider = new FakeEnvironmentProvider(loaded);
  const secondSource = loaded.manifest.legacyProjects.find(
    (project) => project.siteKey === "video",
  );
  assert.ok(secondSource);
  const first = base.contract.mappings[0];
  assert.ok(first);
  const changedFirst: EnvironmentMappingEntry = {
    ...first,
    sources: [
      ...first.sources,
      {
        projectName: secondSource.projectName,
        projectId: secondSource.projectId,
        key: first.targetKey,
        target: "production",
      },
    ],
  };
  const environment: LoadedEnvironmentMapping = {
    ...base,
    contract: {
      ...base.contract,
      mappings: [changedFirst, ...base.contract.mappings.slice(1)],
    },
  };
  const left = "left-secret-disagreement";
  const right = "right-secret-disagreement";
  provider.seedSources(environment, () => left);
  provider.values.set(secondSource.projectId, []);
  provider.seed(secondSource.projectId, first.targetKey, right, first.targetType);

  await assert.rejects(
    synchronizeEnvironment(
      loaded,
      environment,
      provider,
      targetProjects(provider),
      true,
    ),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentSyncError);
      assert.equal(error.code, "preflight-blocked");
      const safe = JSON.stringify(error.details);
      assert.match(safe, /source-equality-disagreement/);
      assert.doesNotMatch(safe, new RegExp(left));
      assert.doesNotMatch(safe, new RegExp(right));
      return true;
    },
  );
  assert.equal(provider.upserts.length, 0);
});

test("missing mapped source fails closed before writes", async () => {
  const loaded = await loadCutoverManifest();
  const environment = completeEnvironmentMapping(loaded);
  const provider = new FakeEnvironmentProvider(loaded);
  provider.seedSources(environment, (mapping) => `fixture:${mapping.targetKey}`);
  const source = environment.contract.mappings[0]?.sources[0];
  assert.ok(source);
  provider.values.set(
    source.projectId,
    (provider.values.get(source.projectId) ?? []).filter(
      (record) => record.key !== source.key,
    ),
  );

  await assert.rejects(
    synchronizeEnvironment(
      loaded,
      environment,
      provider,
      targetProjects(provider),
      true,
    ),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentSyncError);
      assert.match(JSON.stringify(error.details), /source-missing/);
      return true;
    },
  );
  assert.equal(provider.upserts.length, 0);
});

test("forbidden target key blocks the whole sync", async () => {
  const loaded = await loadCutoverManifest();
  const environment = completeEnvironmentMapping(loaded);
  const provider = new FakeEnvironmentProvider(loaded);
  provider.seedSources(environment, (mapping) => `fixture:${mapping.targetKey}`);
  const forbidden =
    loaded.manifest.targets.standard.environment.forbidden[0];
  assert.ok(forbidden);
  provider.seed(TARGET_IDS.standard, forbidden, "forbidden-secret");

  await assert.rejects(
    synchronizeEnvironment(
      loaded,
      environment,
      provider,
      targetProjects(provider),
      true,
    ),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentSyncError);
      assert.match(JSON.stringify(error.details), /target-forbidden-keys/);
      assert.doesNotMatch(
        JSON.stringify(error.details),
        /forbidden-secret/,
      );
      return true;
    },
  );
  assert.equal(provider.upserts.length, 0);
});

test("execute upserts once and an exact resume is idempotent", async () => {
  const loaded = await loadCutoverManifest();
  const environment = completeEnvironmentMapping(loaded);
  const provider = new FakeEnvironmentProvider(loaded);
  provider.seedSources(environment, (mapping) => `fixture:${mapping.targetKey}`);

  const first = await synchronizeEnvironment(
    loaded,
    environment,
    provider,
    targetProjects(provider),
    true,
  );
  assert.equal(provider.upserts.length, 14);
  assert.equal(first.mutations, true);

  const second = await synchronizeEnvironment(
    loaded,
    environment,
    provider,
    targetProjects(provider),
    true,
  );
  assert.equal(provider.upserts.length, 14);
  assert.equal(second.mutations, false);
  assert.deepEqual(second.upserted, []);
});

test("vercel helper receives environment values on stdin, never argv", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cutover-helper-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const helper = join(directory, "vercel-ops");
  const argsPath = join(directory, "args");
  const bodyPath = join(directory, "body");
  await writeFile(
    helper,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsPath}"\nbody=$(cat)\nprintf '%s' "$body" > "${bodyPath}"\nprintf '{}\\n'\n`,
    { mode: 0o700 },
  );
  await chmod(helper, 0o700);
  const provider = new VercelOpsProvider(helper, "team_test");
  const sentinel = "stdin-only-secret-sentinel";

  await provider.upsertEnvironmentVariable("prj_test", {
    existingId: null,
    key: "WEBSITE_VERCEL_TOKEN",
    type: "encrypted",
    value: sentinel,
    targets: ["production"],
  });

  const args = await readFile(argsPath, "utf8");
  const body = await readFile(bodyPath, "utf8");
  assert.match(args, /^api\nPOST\n/u);
  assert.match(args, /\n@-\n?$/u);
  assert.doesNotMatch(args, new RegExp(sentinel));
  assert.match(body, new RegExp(sentinel));
});
