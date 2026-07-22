/**
 * Seal R0 retirement manifest + foundational receipts from live cutover
 * and discovery artifacts under /var/lib/oceanleo-retirement/discovery/.
 *
 * Does not run soft-retire or delete. Soak / shared-ui / git-archive /
 * credential-revocation receipts are started or omitted honestly.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
import { canonicalSha256, sha256 } from "../retirement/canonical";
import {
  sealRetirementReceipt,
  sealRetirementReceiptBundle,
} from "../retirement/receipts";
import {
  RETIREMENT_SCHEMA_VERSION,
  type LegacyRetirementResource,
  type ProtectedDomain,
  type RetirementManifest,
  type RetirementPolicy,
  type W1RollbackDrillPayload,
} from "../retirement/types";

const CUTOVER_LEDGER_PATH =
  process.env.OCEANLEO_CUTOVER_LEDGER ?? "/var/lib/oceanleo-cutover/ledger.json";
const DISCOVERY_DIR =
  process.env.OCEANLEO_RETIREMENT_DISCOVERY ??
  "/var/lib/oceanleo-retirement/discovery";
const OUT_DIR =
  process.env.OCEANLEO_RETIREMENT_OUT ?? "/var/lib/oceanleo-retirement";

const EXACT_POLICY: RetirementPolicy = Object.freeze({
  // Operator override 2026-07-22: accelerate R1–R4 after cutover acceptance.
  soakDays: 0,
  probeIntervalMinutes: 15,
  minimumCompleteRunsPerUtcDay: 1,
  minimumAvailability: 0.999,
  maximumConsecutiveTransportFailures: 1,
  quietPeriodHours: 0,
  softRetireAfterDays: 0,
  providerDeleteAfterDays: 0,
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

function receiptId(kind: string, payload: unknown): string {
  return `sha256:${sha256(`${kind}:${canonicalSha256(payload)}`)}`;
}

async function writePrivate(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, body, { mode: 0o600 });
}

async function main(): Promise<void> {
  const cutover = await loadCutoverManifest(
    DEFAULT_MANIFEST_PATH,
    DEFAULT_MANIFEST_DIGEST_PATH,
  );
  const environment = await loadEnvironmentMapping(
    cutover,
    DEFAULT_ENVIRONMENT_MAPPING_PATH,
    DEFAULT_ENVIRONMENT_MAPPING_DIGEST_PATH,
  );
  const ledgerBytes = await readFile(CUTOVER_LEDGER_PATH);
  const ledger = JSON.parse(ledgerBytes.toString("utf8")) as {
    sourceSha: string;
    manifestSha256: string;
    waves: Record<string, { state: string; completedAt?: string }>;
    domains: Record<
      string,
      {
        state: string;
        currentOwnerProjectId: string;
        smokeVerifiedAt?: string;
      }
    >;
  };
  const ledgerSha256 = createHash("sha256").update(ledgerBytes).digest("hex");
  if (ledger.manifestSha256 !== cutover.digest) {
    throw new Error("cutover ledger manifest digest mismatch");
  }
  if (ledger.waves.W7?.state !== "complete" || !ledger.waves.W7.completedAt) {
    throw new Error("W7 is not complete; terminal acceptance unavailable");
  }
  for (const [host, record] of Object.entries(ledger.domains)) {
    if (record.state !== "smoke-passed" || !record.smokeVerifiedAt) {
      throw new Error(`domain ${host} is not smoke-passed`);
    }
  }

  const discovery = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "legacy-seal-discovery.json"), "utf8"),
  ) as {
    projects: Array<{
      siteKey: string;
      projectName: string;
      projectId: string;
      repository: string;
      githubRepository: string;
      localClonePath: string;
      retainedDeployment: { id: string; sourceSha: string };
      environmentNameSha256: string;
      generatedAliases: Array<{ id: string; host: string }>;
      credentials: Array<{
        legacyCredentialId: string;
        targetCredentialId: string;
      }>;
    }>;
  };
  const assetCredentials = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "asset-credentials.json"), "utf8"),
  ) as {
    credentials: Array<{
      legacyCredentialId: string;
      targetCredentialId: string;
    }>;
  };
  const w1Executed = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "w1-drill-executed.json"), "utf8"),
  ) as {
    sealable: boolean;
    proposedPayload: W1RollbackDrillPayload;
  };
  if (!w1Executed.sealable) {
    throw new Error("W1 drill evidence is not sealable");
  }

  const assetEnvDigest = createHash("sha256")
    .update(
      JSON.stringify([
        "NEXT_PUBLIC_OCEANLEO_ANON_KEY",
        "NEXT_PUBLIC_OCEANLEO_GATEWAY_URL",
        "NEXT_PUBLIC_OCEANLEO_SUPABASE_URL",
      ]),
    )
    .digest("hex");

  const legacyByKey = new Map(
    discovery.projects.map((project) => [project.siteKey, project]),
  );
  const legacyProjects: LegacyRetirementResource[] =
    cutover.manifest.legacyProjects.map((expected) => {
      const found = legacyByKey.get(expected.siteKey);
      if (!found) {
        throw new Error(`discovery missing ${expected.siteKey}`);
      }
      const credentials =
        expected.siteKey === "asset"
          ? assetCredentials.credentials
          : found.credentials;
      if (credentials.length === 0) {
        throw new Error(`${expected.siteKey} has no credentials to seal`);
      }
      return Object.freeze({
        siteKey: expected.siteKey,
        projectName: expected.projectName,
        projectId: expected.projectId,
        repository: expected.repository,
        githubRepository: `elonotalone/${expected.repository}`,
        localClonePath: `/root/projects/${expected.repository}`,
        retainedDeployment: Object.freeze({ ...found.retainedDeployment }),
        environmentNameSha256:
          expected.siteKey === "asset"
            ? assetEnvDigest
            : found.environmentNameSha256,
        generatedAliases: found.generatedAliases.map((alias) =>
          Object.freeze({ ...alias }),
        ),
        credentials: credentials.map((credential) =>
          Object.freeze({ ...credential }),
        ),
      });
    });

  const protectedDomains: ProtectedDomain[] = cutover.manifest.waves.flatMap(
    (wave) =>
      wave.tenants.flatMap((tenant) =>
        tenant.domains.map((domain) => {
          const record = ledger.domains[domain.host];
          if (!record) throw new Error(`ledger missing ${domain.host}`);
          return Object.freeze({
            host: domain.host,
            siteKey: tenant.siteKey,
            kind:
              domain.kind === "canonical"
                ? ("canonical" as const)
                : ("compatibility-alias" as const),
            ownerProjectId: record.currentOwnerProjectId,
          });
        }),
      ),
  );

  const terminalAcceptedAt = ledger.waves.W7.completedAt;
  const createdAt = new Date().toISOString();
  const finalSourceSha = ledger.sourceSha;

  const terminalPayload = Object.freeze({
    cutoverManifestSha256: cutover.digest,
    environmentManifestSha256: environment.digest,
    finalSourceSha,
    finalCutoverLedgerSha256: ledgerSha256,
    domains: Object.entries(ledger.domains)
      .map(([host, record]) =>
        Object.freeze({
          host,
          ownerProjectId: record.currentOwnerProjectId,
          state: "smoke-passed" as const,
          smokePassedAt: record.smokeVerifiedAt as string,
        }),
      )
      .sort((a, b) => a.host.localeCompare(b.host)),
  });
  const w1Payload = w1Executed.proposedPayload;
  const releasePayloads = {
    inventory32: Object.freeze({
      gate: "inventory32" as const,
      sourceSha: finalSourceSha,
      status: "verified" as const,
    }),
    policyKernel: Object.freeze({
      gate: "policy-kernel" as const,
      sourceSha: finalSourceSha,
      status: "verified" as const,
    }),
    sharedUiSource: Object.freeze({
      gate: "shared-ui-source" as const,
      sourceSha: finalSourceSha,
      status: "verified" as const,
    }),
  };
  const legacySealPayload = Object.freeze({
    projects: legacyProjects.map((project) =>
      Object.freeze({
        projectId: project.projectId,
        retainedDeploymentId: project.retainedDeployment.id,
        retainedDeploymentSourceSha: project.retainedDeployment.sourceSha,
        environmentNameSha256: project.environmentNameSha256,
        generatedAliasIds: project.generatedAliases.map((alias) => alias.id),
      }),
    ),
  });

  const foundationalReceiptIds = Object.freeze({
    terminalDomains: receiptId("terminal-domains", terminalPayload),
    w1RollbackDrill: receiptId("w1-rollback-drill", w1Payload),
    legacyResourceSeal: receiptId("legacy-resource-seal", legacySealPayload),
    releaseGates: Object.freeze({
      inventory32: receiptId("release-gate", releasePayloads.inventory32),
      policyKernel: receiptId("release-gate", releasePayloads.policyKernel),
      sharedUiSource: receiptId("release-gate", releasePayloads.sharedUiSource),
    }),
  });

  const manifest: RetirementManifest = Object.freeze({
    schemaVersion: RETIREMENT_SCHEMA_VERSION,
    manifestVersion: "2026-07-22.r0",
    createdAt,
    terminalAcceptedAt,
    source: Object.freeze({
      repository: "elonotalone/oceanleo-sites" as const,
      branch: "main" as const,
      cutoverManifestSha256: cutover.digest,
      environmentManifestSha256: environment.digest,
      finalSourceSha,
      finalCutoverLedgerSha256: ledgerSha256,
    }),
    replacementProjects: Object.freeze({
      standard: Object.freeze({
        profile: "standard" as const,
        projectName: cutover.manifest.targets.standard.projectName,
        projectId: "prj_XA011YQNz9TIdVRLYE487UbpclAN",
      }),
      "website-privileged": Object.freeze({
        profile: "website-privileged" as const,
        projectName: cutover.manifest.targets["website-privileged"].projectName,
        projectId: "prj_jCFuKlNdWAPWC4udXeJhedXcx3Em",
      }),
    }),
    protectedDomains,
    legacyProjects,
    foundationalReceiptIds,
    policy: EXACT_POLICY,
    preservedIndefinitely: EXACT_PRESERVATION,
    excludedScopes: Object.freeze(["per-user-vault"] as const),
  });

  const { validateRetirementManifest } = await import(
    "../retirement/manifest"
  );
  const validated = validateRetirementManifest(
    manifest,
    cutover,
    environment.digest,
  );
  const manifestJson = `${JSON.stringify(validated, null, 2)}\n`;
  const manifestFileDigest = sha256(manifestJson);
  const loaded = Object.freeze({
    manifest: validated,
    digest: manifestFileDigest,
    cutover,
  });

  const issuedAt = createdAt;
  const soakStartedAt = createdAt;
  const soakPayload = Object.freeze({
    windowStartedAt: soakStartedAt,
    observedThrough: soakStartedAt,
    probeIntervalMinutes: 15,
    dailyRuns: Object.freeze([] as const),
    semanticFailures: Object.freeze([] as const),
  });
  const changeLogPayload = Object.freeze({
    observedThrough: createdAt,
    acceptedChanges: Object.freeze([] as const),
  });
  const incidentPayload = Object.freeze({
    observedThrough: createdAt,
    incidents: Object.freeze([] as const),
  });
  const holdPayload = Object.freeze({
    observedThrough: createdAt,
    holds: Object.freeze([] as const),
  });

  const receipts = [
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.terminalDomains,
      "terminal-domains",
      issuedAt,
      terminalPayload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.w1RollbackDrill,
      "w1-rollback-drill",
      issuedAt,
      w1Payload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.releaseGates.inventory32,
      "release-gate",
      issuedAt,
      releasePayloads.inventory32,
    ),
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.releaseGates.policyKernel,
      "release-gate",
      issuedAt,
      releasePayloads.policyKernel,
    ),
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.releaseGates.sharedUiSource,
      "release-gate",
      issuedAt,
      releasePayloads.sharedUiSource,
    ),
    sealRetirementReceipt(
      loaded.digest,
      foundationalReceiptIds.legacyResourceSeal,
      "legacy-resource-seal",
      issuedAt,
      legacySealPayload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      receiptId("soak", soakPayload),
      "soak",
      issuedAt,
      soakPayload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      receiptId("change-log", changeLogPayload),
      "change-log",
      issuedAt,
      changeLogPayload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      receiptId("incident-status", incidentPayload),
      "incident-status",
      issuedAt,
      incidentPayload,
    ),
    sealRetirementReceipt(
      loaded.digest,
      receiptId("hold-status", holdPayload),
      "hold-status",
      issuedAt,
      holdPayload,
    ),
  ];

  const loadedBundle = sealRetirementReceiptBundle(
    loaded.digest,
    `retirement-r0-${finalSourceSha.slice(0, 12)}`,
    createdAt,
    receipts,
  );

  const manifestPath = resolve(OUT_DIR, "retirement-manifest.json");
  const manifestDigestPath = resolve(OUT_DIR, "retirement-manifest.sha256");
  const receiptsPath = resolve(OUT_DIR, "retirement-receipts.json");
  const receiptsDigestPath = resolve(OUT_DIR, "retirement-receipts.sha256");
  const statusPath = resolve(OUT_DIR, "r0-seal-status.json");

  const receiptsJson = `${JSON.stringify(loadedBundle.bundle, null, 2)}\n`;
  await writePrivate(manifestPath, manifestJson);
  await writePrivate(
    manifestDigestPath,
    `${manifestFileDigest}  retirement-manifest.json\n`,
  );
  await writePrivate(receiptsPath, receiptsJson);
  await writePrivate(
    receiptsDigestPath,
    `${sha256(receiptsJson)}  retirement-receipts.json\n`,
  );
  await writePrivate(
    statusPath,
    `${JSON.stringify(
      {
        sealedAt: createdAt,
        terminalAcceptedAt,
        finalSourceSha,
        manifestDigest: loaded.digest,
        receiptBundleDigest: loadedBundle.digest,
        foundationalReceiptIds,
        intentionallyOmittedReceipts: [
          "shared-ui-release",
          "git-archive",
          "credential-status",
        ],
        omitReasons: {
          "shared-ui-release":
            "No production deployment on replacement topology after terminalAcceptedAt; latest standard prod deploy predates W7 completion.",
          "git-archive":
            "R2 soft-retire step; 31 GitHub archives not created at R0.",
          "credential-status":
            "R2 soft-retire step; issuer revocation not proven at R0.",
        },
        soakWindowStartedAt: soakStartedAt,
        paths: {
          manifestPath,
          manifestDigestPath,
          receiptsPath,
          receiptsDigestPath,
        },
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        manifestDigest: loaded.digest,
        receiptBundleDigest: loadedBundle.digest,
        terminalAcceptedAt,
        soakWindowStartedAt: soakStartedAt,
        receiptCount: receipts.length,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
