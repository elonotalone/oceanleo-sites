import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AppProfile,
  CutoverProvider,
  EnvironmentValueInfo,
  LoadedManifest,
  ProjectInfo,
} from "./types";

const deployDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ENVIRONMENT_MAPPING_PATH = resolve(
  deployDirectory,
  "environment-mapping.json",
);
export const DEFAULT_ENVIRONMENT_MAPPING_DIGEST_PATH = resolve(
  deployDirectory,
  "environment-mapping.sha256",
);

const PROFILES: readonly AppProfile[] = [
  "standard",
  "website-privileged",
];
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/;

export interface EnvironmentMappingSource {
  readonly projectName: string;
  readonly projectId: string;
  readonly key: string;
  readonly target: "production";
}

export interface EnvironmentMappingEntry {
  readonly id: string;
  readonly status: "mapped" | "blocked";
  readonly targetProfile: AppProfile;
  readonly targetKey: string;
  readonly targetType: "plain" | "encrypted";
  readonly sourcePolicy: "all-sources-equal";
  readonly sources: readonly EnvironmentMappingSource[];
  readonly provenance: readonly string[];
  readonly blocker?: string;
}

export interface EnvironmentMappingContract {
  readonly schemaVersion: "oceanleo.environment-mapping.v1";
  readonly contractVersion: string;
  readonly reviewedAt: string;
  readonly teamId: string;
  readonly provider: "vercel-ops";
  readonly valueHandling: Readonly<{
    decryptRequested: true;
    valuesPersisted: false;
    valuesLogged: false;
    comparison: "sha256-in-memory";
    writeTransport: "vercel-ops-stdin";
  }>;
  readonly mappings: readonly EnvironmentMappingEntry[];
  readonly excluded: readonly Readonly<{
    keys: readonly string[];
    reason: string;
  }>[];
  readonly helperReview: readonly Readonly<{
    helper: string;
    status: string;
    acceptedAsSource: false;
    reason: string;
  }>[];
}

export interface LoadedEnvironmentMapping {
  readonly contract: EnvironmentMappingContract;
  readonly digest: string;
}

export class EnvironmentSyncError extends Error {
  override name = "EnvironmentSyncError";

  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`Environment sync failed: ${code}.`);
  }
}

interface SourceObservation {
  readonly projectName: string;
  readonly projectId: string;
  readonly key: string;
  readonly present: boolean;
  readonly digest: string | null;
}

interface ResolvedMapping {
  readonly mapping: EnvironmentMappingEntry;
  readonly value: string;
  readonly digest: string;
}

interface PendingWrite {
  readonly profile: AppProfile;
  readonly projectId: string;
  readonly key: string;
  readonly type: "plain" | "encrypted";
  readonly value: string;
  readonly digest: string;
  readonly existingId: string | null;
  readonly operation: "create" | "update";
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid environment mapping contract: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function valueDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function productionRecords(
  records: readonly EnvironmentValueInfo[],
  key: string,
): readonly EnvironmentValueInfo[] {
  return records.filter(
    (record) =>
      record.key === key &&
      (record.targets.length === 0 || record.targets.includes("production")),
  );
}

function validateContract(
  raw: unknown,
  loaded: LoadedManifest,
): EnvironmentMappingContract {
  invariant(isRecord(raw), "root must be an object");
  invariant(
    raw.schemaVersion === "oceanleo.environment-mapping.v1",
    "schemaVersion mismatch",
  );
  const contract = raw as unknown as EnvironmentMappingContract;
  invariant(
    contract.teamId === loaded.manifest.discovery.teamId,
    "team mismatch",
  );
  invariant(contract.provider === "vercel-ops", "provider must be vercel-ops");
  invariant(
    contract.valueHandling?.decryptRequested === true &&
      contract.valueHandling.valuesPersisted === false &&
      contract.valueHandling.valuesLogged === false &&
      contract.valueHandling.comparison === "sha256-in-memory" &&
      contract.valueHandling.writeTransport === "vercel-ops-stdin",
    "value handling is not fail-closed",
  );
  invariant(Array.isArray(contract.mappings), "mappings must be an array");
  invariant(
    new Set(contract.mappings.map((mapping) => mapping.id)).size ===
      contract.mappings.length,
    "mapping IDs must be unique",
  );

  const legacyById = new Map(
    loaded.manifest.legacyProjects.map((project) => [
      project.projectId,
      project,
    ]),
  );
  const targetPairs = new Set<string>();
  for (const mapping of contract.mappings) {
    invariant(
      PROFILES.includes(mapping.targetProfile),
      `${mapping.id} has an invalid target profile`,
    );
    invariant(
      ENVIRONMENT_NAME.test(mapping.targetKey),
      `${mapping.id} has an invalid target key`,
    );
    invariant(
      mapping.targetType === "plain" || mapping.targetType === "encrypted",
      `${mapping.id} has an invalid target type`,
    );
    invariant(
      mapping.sourcePolicy === "all-sources-equal",
      `${mapping.id} has an unsafe source policy`,
    );
    invariant(
      Array.isArray(mapping.provenance) &&
        mapping.provenance.length > 0 &&
        mapping.provenance.every(
          (locator: unknown) =>
            typeof locator === "string" && locator.length > 0,
        ),
      `${mapping.id} has no provenance`,
    );
    const target =
      loaded.manifest.targets[mapping.targetProfile as AppProfile];
    invariant(
      target.environment.required.includes(mapping.targetKey),
      `${mapping.id} does not map a required target key`,
    );
    invariant(
      !target.environment.forbidden.includes(mapping.targetKey),
      `${mapping.id} maps a forbidden target key`,
    );
    const pair = `${mapping.targetProfile}:${mapping.targetKey}`;
    invariant(!targetPairs.has(pair), `${pair} is mapped more than once`);
    targetPairs.add(pair);

    if (mapping.status === "mapped") {
      invariant(mapping.sources.length > 0, `${mapping.id} has no sources`);
      invariant(!mapping.blocker, `${mapping.id} is mapped but blocked`);
    } else {
      invariant(mapping.status === "blocked", `${mapping.id} has invalid status`);
      invariant(mapping.sources.length === 0, `${mapping.id} has blocked sources`);
      invariant(
        typeof mapping.blocker === "string" && mapping.blocker.length > 0,
        `${mapping.id} has no blocker evidence`,
      );
    }

    const sourcePairs = new Set<string>();
    for (const source of mapping.sources) {
      const legacy = legacyById.get(source.projectId);
      invariant(legacy, `${mapping.id} has an unknown source project`);
      invariant(
        legacy.projectName === source.projectName,
        `${mapping.id} source project identity drift`,
      );
      invariant(
        ENVIRONMENT_NAME.test(source.key) && source.target === "production",
        `${mapping.id} has an invalid source key or target`,
      );
      const sourcePair = `${source.projectId}:${source.key}:${source.target}`;
      invariant(
        !sourcePairs.has(sourcePair),
        `${mapping.id} repeats a source`,
      );
      sourcePairs.add(sourcePair);
    }
  }

  const requiredPairs = PROFILES.flatMap((profile) =>
    loaded.manifest.targets[profile].environment.required.map(
      (key) => `${profile}:${key}`,
    ),
  );
  invariant(
    requiredPairs.length === targetPairs.size &&
      requiredPairs.every((pair) => targetPairs.has(pair)),
    "mapping coverage does not exactly match required target keys",
  );
  return deepFreeze(contract);
}

export async function loadEnvironmentMapping(
  loaded: LoadedManifest,
  mappingPath = DEFAULT_ENVIRONMENT_MAPPING_PATH,
  digestPath = DEFAULT_ENVIRONMENT_MAPPING_DIGEST_PATH,
): Promise<LoadedEnvironmentMapping> {
  const [bytes, digestFile] = await Promise.all([
    readFile(mappingPath),
    readFile(digestPath, "utf8"),
  ]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expectedDigest = digestFile.trim().split(/\s+/u)[0];
  invariant(
    /^[a-f0-9]{64}$/.test(expectedDigest ?? "") && digest === expectedDigest,
    "digest mismatch",
  );
  const contract = validateContract(
    JSON.parse(bytes.toString("utf8")) as unknown,
    loaded,
  );
  return deepFreeze({ contract, digest });
}

export async function synchronizeEnvironment(
  loaded: LoadedManifest,
  environment: LoadedEnvironmentMapping,
  provider: CutoverProvider,
  projects: Readonly<Partial<Record<AppProfile, ProjectInfo>>>,
  execute = false,
): Promise<Readonly<Record<string, unknown>>> {
  const sourceCache = new Map<
    string,
    Promise<readonly EnvironmentValueInfo[]>
  >();
  const readSource = (
    projectId: string,
  ): Promise<readonly EnvironmentValueInfo[]> => {
    const existing = sourceCache.get(projectId);
    if (existing) return existing;
    const pending = provider.readEnvironmentValues(projectId);
    sourceCache.set(projectId, pending);
    return pending;
  };

  const blockers: Array<Readonly<Record<string, unknown>>> = [];
  const equality: Array<Readonly<Record<string, unknown>>> = [];
  const operatorHolds: Array<Readonly<Record<string, unknown>>> = [];
  const resolved = new Map<string, ResolvedMapping>();

  for (const mapping of environment.contract.mappings) {
    const pair = `${mapping.targetProfile}:${mapping.targetKey}`;
    if (mapping.status === "blocked") {
      // Documented operator-only secrets must not block sync of mapped keys
      // (standard shared config and any website keys that do resolve).
      operatorHolds.push(
        Object.freeze({
          code: "mapping-unresolved",
          profile: mapping.targetProfile,
          key: mapping.targetKey,
          reason: mapping.blocker,
        }),
      );
      equality.push(
        Object.freeze({
          profile: mapping.targetProfile,
          key: mapping.targetKey,
          sourceCount: 0,
          uniqueDigests: [],
          equal: false,
          operatorHold: true,
        }),
      );
      continue;
    }

    const observations: SourceObservation[] = [];
    const values: string[] = [];
    for (const source of mapping.sources) {
      const records = productionRecords(
        await readSource(source.projectId),
        source.key,
      );
      if (records.length !== 1) {
        observations.push(
          Object.freeze({
            projectName: source.projectName,
            projectId: source.projectId,
            key: source.key,
            present: false,
            digest: null,
          }),
        );
        blockers.push(
          Object.freeze({
            code:
              records.length === 0
                ? "source-missing"
                : "source-ambiguous",
            profile: mapping.targetProfile,
            key: mapping.targetKey,
            sourceProject: source.projectName,
            sourceKey: source.key,
          }),
        );
        continue;
      }
      const value = records[0]?.value;
      if (!value) {
        observations.push(
          Object.freeze({
            projectName: source.projectName,
            projectId: source.projectId,
            key: source.key,
            present: false,
            digest: null,
          }),
        );
        blockers.push(
          Object.freeze({
            code: "source-value-unavailable",
            profile: mapping.targetProfile,
            key: mapping.targetKey,
            sourceProject: source.projectName,
            sourceKey: source.key,
          }),
        );
        continue;
      }
      const digest = valueDigest(value);
      values.push(value);
      observations.push(
        Object.freeze({
          projectName: source.projectName,
          projectId: source.projectId,
          key: source.key,
          present: true,
          digest,
        }),
      );
    }
    const uniqueDigests = Object.freeze([
      ...new Set(observations.flatMap((item) => (item.digest ? [item.digest] : []))),
    ].sort());
    equality.push(
      Object.freeze({
        profile: mapping.targetProfile,
        key: mapping.targetKey,
        sourceCount: mapping.sources.length,
        uniqueDigests,
        equal:
          observations.length === mapping.sources.length &&
          observations.every((item) => item.present) &&
          uniqueDigests.length === 1,
        sources: Object.freeze(observations),
      }),
    );
    if (
      observations.length !== mapping.sources.length ||
      observations.some((item) => !item.present)
    ) {
      continue;
    }
    if (uniqueDigests.length !== 1) {
      blockers.push(
        Object.freeze({
          code: "source-equality-disagreement",
          profile: mapping.targetProfile,
          key: mapping.targetKey,
          sources: Object.freeze(observations),
        }),
      );
      continue;
    }
    const value = values[0];
    if (!value) {
      blockers.push(
        Object.freeze({
          code: "source-value-unavailable",
          profile: mapping.targetProfile,
          key: mapping.targetKey,
        }),
      );
      continue;
    }
    resolved.set(
      pair,
      Object.freeze({
        mapping,
        value,
        digest: uniqueDigests[0] as string,
      }),
    );
  }

  const writes: PendingWrite[] = [];
  const unchanged: Array<Readonly<Record<string, unknown>>> = [];
  for (const profile of PROFILES) {
    const target = loaded.manifest.targets[profile];
    const project = projects[profile];
    if (!project) {
      blockers.push(
        Object.freeze({
          code: "target-project-missing",
          profile,
          projectName: target.projectName,
        }),
      );
      continue;
    }
    const targetRecords = await provider.readEnvironmentValues(project.id);
    const forbidden = target.environment.forbidden.filter(
      (key) => productionRecords(targetRecords, key).length > 0,
    );
    if (forbidden.length > 0) {
      blockers.push(
        Object.freeze({
          code: "target-forbidden-keys",
          profile,
          keys: Object.freeze(forbidden),
        }),
      );
    }
    for (const key of target.environment.required) {
      const mapping = resolved.get(`${profile}:${key}`);
      if (!mapping) continue;
      const existing = productionRecords(targetRecords, key);
      if (existing.length > 1) {
        blockers.push(
          Object.freeze({
            code: "target-key-ambiguous",
            profile,
            key,
          }),
        );
        continue;
      }
      const current = existing[0];
      if (current && current.value === null) {
        blockers.push(
          Object.freeze({
            code: "target-value-unavailable",
            profile,
            key,
          }),
        );
        continue;
      }
      if (
        current &&
        valueDigest(current.value as string) === mapping.digest &&
        current.type === mapping.mapping.targetType
      ) {
        unchanged.push(
          Object.freeze({
            profile,
            key,
            digest: mapping.digest,
          }),
        );
        continue;
      }
      writes.push(
        Object.freeze({
          profile,
          projectId: project.id,
          key,
          type: mapping.mapping.targetType,
          value: mapping.value,
          digest: mapping.digest,
          existingId: current?.id ?? null,
          operation: current ? "update" : "create",
        }),
      );
    }
  }

  if (blockers.length > 0) {
    throw new EnvironmentSyncError("preflight-blocked", {
      mappingSha256: environment.digest,
      blockers: Object.freeze(blockers),
      operatorHolds: Object.freeze(operatorHolds),
      equality: Object.freeze(equality),
      mutations: false,
    });
  }

  const sanitizedWrites = Object.freeze(
    writes.map((write) =>
      Object.freeze({
        profile: write.profile,
        key: write.key,
        operation: write.operation,
        digest: write.digest,
      }),
    ),
  );
  if (!execute) {
    return Object.freeze({
      dryRun: true,
      mappingSha256: environment.digest,
      equality: Object.freeze(equality),
      operatorHolds: Object.freeze(operatorHolds),
      wouldUpsert: sanitizedWrites,
      unchanged: Object.freeze(unchanged),
      mutations: false,
    });
  }

  for (const write of writes) {
    await provider.upsertEnvironmentVariable(write.projectId, {
      existingId: write.existingId,
      key: write.key,
      type: write.type,
      value: write.value,
      targets: ["production"],
    });
  }

  for (const profile of PROFILES) {
    const project = projects[profile];
    invariant(project, `${profile} target disappeared after preflight`);
    const records = await provider.readEnvironmentValues(project.id);
    const target = loaded.manifest.targets[profile];
    for (const key of target.environment.required) {
      const mapping = resolved.get(`${profile}:${key}`);
      if (!mapping) {
        // Required keys with blocked mappings stay on operator hold.
        continue;
      }
      const matches = productionRecords(records, key);
      if (
        matches.length !== 1 ||
        matches[0]?.type !== mapping.mapping.targetType
      ) {
        throw new EnvironmentSyncError("post-write-verification", {
          profile,
          key,
          expectedDigest: mapping.digest,
          mutations: writes.length > 0,
        });
      }
      // Encrypted Vercel values may not round-trip byte-identical under
      // decrypt=true; require digest match only for plain target keys.
      if (
        mapping.mapping.targetType === "plain" &&
        (matches[0]?.value === null ||
          valueDigest(matches[0].value) !== mapping.digest)
      ) {
        throw new EnvironmentSyncError("post-write-verification", {
          profile,
          key,
          expectedDigest: mapping.digest,
          mutations: writes.length > 0,
        });
      }
    }
    const forbidden = target.environment.forbidden.filter(
      (key) => productionRecords(records, key).length > 0,
    );
    if (forbidden.length > 0) {
      throw new EnvironmentSyncError("post-write-forbidden-key", {
        profile,
        keys: Object.freeze(forbidden),
        mutations: writes.length > 0,
      });
    }
  }

  return Object.freeze({
    dryRun: false,
    mappingSha256: environment.digest,
    equality: Object.freeze(equality),
    operatorHolds: Object.freeze(operatorHolds),
    upserted: sanitizedWrites,
    unchanged: Object.freeze(unchanged),
    mutations: writes.length > 0,
  });
}
