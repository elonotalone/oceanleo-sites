import { readFile } from "node:fs/promises";

import {
  DEFAULT_ENVIRONMENT_MAPPING_DIGEST_PATH,
  DEFAULT_ENVIRONMENT_MAPPING_PATH,
  loadEnvironmentMapping,
} from "../deploy/environment";
import {
  DEFAULT_MANIFEST_DIGEST_PATH,
  DEFAULT_MANIFEST_PATH,
  loadCutoverManifest,
} from "../deploy/manifest";
import type { AppProfile, LoadedManifest } from "../deploy/types";
import {
  assertSha256,
  assertSourceSha,
  assertUnique,
  deepFreeze,
  invariant,
  isRecord,
  isoMilliseconds,
  sha256,
} from "./canonical";
import {
  RETIREMENT_SCHEMA_VERSION,
  type LoadedRetirementManifest,
  type ProtectedDomain,
  type RetirementManifest,
  type RetirementPolicy,
} from "./types";

const PROFILES = [
  "standard",
  "website-privileged",
] as const satisfies readonly AppProfile[];

const EXACT_POLICY: RetirementPolicy = Object.freeze({
  soakDays: 30,
  probeIntervalMinutes: 15,
  minimumCompleteRunsPerUtcDay: 95,
  minimumAvailability: 0.999,
  maximumConsecutiveTransportFailures: 1,
  quietPeriodHours: 72,
  softRetireAfterDays: 30,
  providerDeleteAfterDays: 60,
});

const EXACT_PRESERVATION = [
  "canonical-domains",
  "compatibility-aliases",
  "manifests",
  "receipts",
  "ledgers",
  "audit-logs",
  "archived-git-history",
] as const;

function sameStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function expectedProtectedDomains(
  manifest: RetirementManifest,
  cutover: LoadedManifest,
): readonly ProtectedDomain[] {
  return cutover.manifest.waves.flatMap((wave) =>
    wave.tenants.flatMap((tenant) =>
      tenant.domains.map((domain) => ({
        host: domain.host,
        siteKey: tenant.siteKey,
        kind:
          domain.kind === "canonical"
            ? ("canonical" as const)
            : ("compatibility-alias" as const),
        ownerProjectId:
          manifest.replacementProjects[tenant.profile].projectId,
      })),
    ),
  );
}

function validateReplacementProjects(
  manifest: RetirementManifest,
  cutover: LoadedManifest,
): void {
  const legacyIds = new Set(
    cutover.manifest.legacyProjects.map((project) => project.projectId),
  );
  for (const profile of PROFILES) {
    const replacement = manifest.replacementProjects?.[profile];
    const target = cutover.manifest.targets[profile];
    invariant(replacement?.profile === profile, `${profile} profile drifted`);
    invariant(
      replacement.projectName === target.projectName,
      `${profile} replacement project name drifted`,
    );
    invariant(
      /^prj_[A-Za-z0-9_-]+$/u.test(replacement.projectId),
      `${profile} replacement project ID is invalid`,
    );
    invariant(
      !legacyIds.has(replacement.projectId),
      `${profile} replacement project is a legacy project`,
    );
  }
  assertUnique(
    PROFILES.map(
      (profile) => manifest.replacementProjects[profile].projectId,
    ),
    "replacement project IDs",
  );
}

function validateProtectedDomains(
  manifest: RetirementManifest,
  cutover: LoadedManifest,
): void {
  const expected = expectedProtectedDomains(manifest, cutover);
  invariant(
    manifest.protectedDomains.length === 37,
    "protected domain inventory must contain 37 hosts",
  );
  invariant(
    manifest.protectedDomains.filter(
      (domain) => domain.kind === "compatibility-alias",
    ).length === 6,
    "protected inventory must contain six compatibility aliases",
  );
  for (const [index, wanted] of expected.entries()) {
    const actual = manifest.protectedDomains[index];
    invariant(
      actual?.host === wanted.host &&
        actual.siteKey === wanted.siteKey &&
        actual.kind === wanted.kind &&
        actual.ownerProjectId === wanted.ownerProjectId,
      `protected domain ${wanted.host} does not match the cutover manifest`,
    );
  }
  assertUnique(
    manifest.protectedDomains.map((domain) => domain.host),
    "protected domain hosts",
  );
}

function validateLegacyProjects(
  manifest: RetirementManifest,
  cutover: LoadedManifest,
): void {
  invariant(
    manifest.legacyProjects.length === 31,
    "legacy retirement inventory must contain 31 projects",
  );
  const protectedHosts = new Set(
    manifest.protectedDomains.map((domain) => domain.host),
  );
  const aliasIds: string[] = [];
  const aliasHosts: string[] = [];
  const credentialIds: string[] = [];
  const clonePaths: string[] = [];
  const deploymentIds: string[] = [];
  for (const [index, expected] of cutover.manifest.legacyProjects.entries()) {
    const actual = manifest.legacyProjects[index];
    invariant(
      actual?.siteKey === expected.siteKey &&
        actual.projectName === expected.projectName &&
        actual.projectId === expected.projectId &&
        actual.repository === expected.repository,
      `${expected.siteKey} legacy identity drifted`,
    );
    invariant(
      actual.githubRepository === `elonotalone/${expected.repository}`,
      `${expected.siteKey} GitHub archive source drifted`,
    );
    invariant(
      actual.localClonePath === `/root/projects/${expected.repository}`,
      `${expected.siteKey} local clone path is not exact`,
    );
    invariant(
      /^dpl_[A-Za-z0-9_-]+$/u.test(actual.retainedDeployment.id),
      `${expected.siteKey} retained deployment ID is invalid`,
    );
    assertSourceSha(
      actual.retainedDeployment.sourceSha,
      `${expected.siteKey} retained deployment source`,
    );
    assertSha256(
      actual.environmentNameSha256,
      `${expected.siteKey} environment-name digest`,
    );
    invariant(
      actual.generatedAliases.length > 0,
      `${expected.siteKey} has no sealed generated aliases`,
    );
    for (const alias of actual.generatedAliases) {
      invariant(alias.id.length > 0, `${expected.siteKey} has an empty alias ID`);
      invariant(
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.vercel\.app$/u.test(alias.host),
        `${expected.siteKey} generated alias is not a .vercel.app host`,
      );
      invariant(
        !protectedHosts.has(alias.host),
        `${expected.siteKey} generated alias overlaps a protected domain`,
      );
      aliasIds.push(alias.id);
      aliasHosts.push(alias.host);
    }
    invariant(
      actual.credentials.length > 0,
      `${expected.siteKey} has no project credential record`,
    );
    for (const credential of actual.credentials) {
      invariant(
        credential.legacyCredentialId.length > 0 &&
          credential.targetCredentialId.length > 0,
        `${expected.siteKey} has an incomplete credential identity`,
      );
      invariant(
        credential.legacyCredentialId !== credential.targetCredentialId,
        `${expected.siteKey} credential identities are not distinct`,
      );
      credentialIds.push(credential.legacyCredentialId);
    }
    deploymentIds.push(actual.retainedDeployment.id);
    clonePaths.push(actual.localClonePath);
  }
  assertUnique(aliasIds, "generated alias IDs");
  assertUnique(aliasHosts, "generated alias hosts");
  assertUnique(credentialIds, "legacy credential IDs");
  assertUnique(clonePaths, "local clone paths");
  assertUnique(deploymentIds, "retained deployment IDs");
}

function validateFoundationIds(manifest: RetirementManifest): void {
  invariant(
    isRecord(manifest.foundationalReceiptIds) &&
      isRecord(manifest.foundationalReceiptIds.releaseGates),
    "foundational receipt IDs are missing",
  );
  const ids = [
    manifest.foundationalReceiptIds.terminalDomains,
    manifest.foundationalReceiptIds.w1RollbackDrill,
    manifest.foundationalReceiptIds.legacyResourceSeal,
    manifest.foundationalReceiptIds.releaseGates.inventory32,
    manifest.foundationalReceiptIds.releaseGates.policyKernel,
    manifest.foundationalReceiptIds.releaseGates.sharedUiSource,
  ];
  invariant(
    ids.every((id) => typeof id === "string" && id.length > 0),
    "foundational receipt IDs are incomplete",
  );
  assertUnique(ids, "foundational receipt IDs");
}

export function validateRetirementManifest(
  raw: unknown,
  cutover: LoadedManifest,
  environmentManifestSha256: string,
): RetirementManifest {
  invariant(isRecord(raw), "manifest root must be an object");
  invariant(
    raw.schemaVersion === RETIREMENT_SCHEMA_VERSION,
    "manifest schemaVersion mismatch",
  );
  const manifest = raw as unknown as RetirementManifest;
  invariant(manifest.manifestVersion.length > 0, "manifestVersion is empty");
  const createdAt = isoMilliseconds(manifest.createdAt, "createdAt");
  const terminalAcceptedAt = isoMilliseconds(
    manifest.terminalAcceptedAt,
    "terminalAcceptedAt",
  );
  invariant(
    createdAt >= terminalAcceptedAt,
    "manifest predates terminal acceptance",
  );
  invariant(
    manifest.source.repository === "elonotalone/oceanleo-sites" &&
      manifest.source.branch === "main",
    "source repository contract drifted",
  );
  assertSha256(
    manifest.source.cutoverManifestSha256,
    "cutover manifest digest",
  );
  assertSha256(
    manifest.source.environmentManifestSha256,
    "environment manifest digest",
  );
  assertSourceSha(manifest.source.finalSourceSha, "final source SHA");
  assertSha256(
    manifest.source.finalCutoverLedgerSha256,
    "final cutover ledger digest",
  );
  invariant(
    manifest.source.cutoverManifestSha256 === cutover.digest,
    "cutover manifest digest does not match immutable input",
  );
  invariant(
    manifest.source.environmentManifestSha256 === environmentManifestSha256,
    "environment manifest digest does not match immutable input",
  );
  validateReplacementProjects(manifest, cutover);
  validateProtectedDomains(manifest, cutover);
  validateLegacyProjects(manifest, cutover);
  validateFoundationIds(manifest);
  invariant(
    JSON.stringify(manifest.policy) === JSON.stringify(EXACT_POLICY),
    "retirement timing or availability policy drifted",
  );
  invariant(
    sameStrings(manifest.preservedIndefinitely, EXACT_PRESERVATION),
    "indefinite retention set drifted",
  );
  invariant(
    sameStrings(manifest.excludedScopes, ["per-user-vault"]),
    "per-user vault exclusion is missing",
  );
  return deepFreeze(manifest);
}

export interface RetirementManifestLoadOptions {
  readonly manifestPath: string;
  readonly digestPath: string;
  readonly cutoverManifestPath?: string;
  readonly cutoverDigestPath?: string;
  readonly environmentManifestPath?: string;
  readonly environmentDigestPath?: string;
}

export async function loadRetirementManifest(
  options: RetirementManifestLoadOptions,
): Promise<LoadedRetirementManifest> {
  const cutover = await loadCutoverManifest(
    options.cutoverManifestPath ?? DEFAULT_MANIFEST_PATH,
    options.cutoverDigestPath ?? DEFAULT_MANIFEST_DIGEST_PATH,
  );
  const environment = await loadEnvironmentMapping(
    cutover,
    options.environmentManifestPath ?? DEFAULT_ENVIRONMENT_MAPPING_PATH,
    options.environmentDigestPath ?? DEFAULT_ENVIRONMENT_MAPPING_DIGEST_PATH,
  );
  const [bytes, digestFile] = await Promise.all([
    readFile(options.manifestPath),
    readFile(options.digestPath, "utf8"),
  ]);
  const digest = sha256(bytes);
  const expected = digestFile.trim().split(/\s+/u)[0] ?? "";
  assertSha256(expected, "retirement manifest sidecar digest");
  invariant(digest === expected, "retirement manifest digest mismatch");
  const manifest = validateRetirementManifest(
    JSON.parse(bytes.toString("utf8")) as unknown,
    cutover,
    environment.digest,
  );
  return deepFreeze({ manifest, digest, cutover });
}
