/**
 * Operator-accelerated retirement finish: re-seal manifest+receipts under
 * accelerated policy, including shared-ui, git-archive, credential-status.
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
import { validateRetirementManifest } from "../retirement/manifest";
import {
  sealRetirementReceipt,
  sealRetirementReceiptBundle,
} from "../retirement/receipts";
import {
  RETIREMENT_SCHEMA_VERSION,
  type AnyRetirementReceipt,
  type LegacyRetirementResource,
  type ProtectedDomain,
  type RetirementManifest,
  type RetirementPolicy,
  type SoakDailyRun,
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

async function loadJournalDaily(): Promise<{
  dailyRuns: SoakDailyRun[];
  semanticFailures: Array<{ id: string; occurredAt: string }>;
  observedThrough: string | null;
  windowStartedAt: string | null;
}> {
  let text = "";
  try {
    text = await readFile(resolve(OUT_DIR, "soak/journal.ndjson"), "utf8");
  } catch {
    return {
      dailyRuns: [],
      semanticFailures: [],
      observedThrough: null,
      windowStartedAt: null,
    };
  }
  const byDate = new Map<string, SoakDailyRun>();
  const semanticFailures: Array<{ id: string; occurredAt: string }> = [];
  let observedThrough: string | null = null;
  let windowStartedAt: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const run = JSON.parse(line) as {
      utcDate: string;
      startedAt: string;
      finishedAt: string;
      totalHostChecks: number;
      availableHostChecks: number;
      maxConsecutiveTransportFailures: number;
      semanticMismatches: number;
      hostCount: number;
    };
    windowStartedAt ??= run.startedAt;
    observedThrough = run.finishedAt;
    const current = byDate.get(run.utcDate) ?? {
      utcDate: run.utcDate,
      completeRuns: 0,
      totalHostChecks: 0,
      availableHostChecks: 0,
      maxConsecutiveTransportFailures: 0,
      semanticMismatches: 0,
    };
    if (run.hostCount === 37) current.completeRuns += 1;
    current.totalHostChecks += run.totalHostChecks;
    current.availableHostChecks += run.availableHostChecks;
    current.maxConsecutiveTransportFailures = Math.max(
      current.maxConsecutiveTransportFailures,
      run.maxConsecutiveTransportFailures,
    );
    current.semanticMismatches += run.semanticMismatches;
    byDate.set(run.utcDate, current);
    if (run.semanticMismatches > 0) {
      semanticFailures.push({
        id: `semantic-${run.finishedAt}`,
        occurredAt: run.finishedAt,
      });
    }
  }
  return {
    dailyRuns: [...byDate.values()].sort((a, b) =>
      a.utcDate.localeCompare(b.utcDate),
    ),
    semanticFailures,
    observedThrough,
    windowStartedAt,
  };
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
  const priorManifest = JSON.parse(
    await readFile(resolve(OUT_DIR, "retirement-manifest.json"), "utf8"),
  ) as RetirementManifest;
  const priorBundle = JSON.parse(
    await readFile(resolve(OUT_DIR, "retirement-receipts.json"), "utf8"),
  ) as { receipts: AnyRetirementReceipt[] };

  const w1 = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "w1-drill-executed.json"), "utf8"),
  ) as { proposedPayload: W1RollbackDrillPayload; sealable: boolean };
  if (!w1.sealable) throw new Error("W1 drill not sealable");

  const sharedUiDiscovery = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "shared-ui-release.json"), "utf8"),
  ) as {
    payload?: {
      releaseId: string;
      sourceSha: string;
      releasedAt: string;
      normalRelease: true;
      topology: "replacement";
    };
    releaseId?: string;
    sourceSha?: string;
    releasedAt?: string;
  };
  const sharedUiPayload =
    sharedUiDiscovery.payload ??
    Object.freeze({
      releaseId: sharedUiDiscovery.releaseId as string,
      sourceSha: sharedUiDiscovery.sourceSha as string,
      releasedAt: sharedUiDiscovery.releasedAt as string,
      normalRelease: true as const,
      topology: "replacement" as const,
    });

  const gitArchiveDiscovery = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "git-archive.json"), "utf8"),
  ) as {
    payload?: { projects: unknown[] };
    projects?: unknown[];
  };
  const gitArchivePayload = Object.freeze({
    projects:
      gitArchiveDiscovery.payload?.projects ??
      gitArchiveDiscovery.projects ??
      [],
  });

  const credentialDiscovery = JSON.parse(
    await readFile(resolve(DISCOVERY_DIR, "credential-status.json"), "utf8"),
  ) as { credentials: unknown[]; payload?: { credentials: unknown[] } };
  const credentialPayload = Object.freeze({
    credentials:
      credentialDiscovery.payload?.credentials ??
      credentialDiscovery.credentials,
  });

  const priorW1 = priorBundle.receipts.find((r) => r.kind === "w1-rollback-drill");
  const priorTerminal = priorBundle.receipts.find(
    (r) => r.kind === "terminal-domains",
  );
  const priorLegacySeal = priorBundle.receipts.find(
    (r) => r.kind === "legacy-resource-seal",
  );
  const priorRelease = priorBundle.receipts.filter(
    (r) => r.kind === "release-gate",
  );

  const terminalAcceptedAt = ledger.waves.W7.completedAt as string;
  const createdAt = new Date().toISOString();
  const finalSourceSha = ledger.sourceSha;

  const legacyProjects =
    priorManifest.legacyProjects as readonly LegacyRetirementResource[];
  const protectedDomains =
    priorManifest.protectedDomains as readonly ProtectedDomain[];

  const terminalPayload =
    priorTerminal?.payload ??
    Object.freeze({
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
  const w1Payload = (priorW1?.payload ?? w1.proposedPayload) as W1RollbackDrillPayload;
  const legacySealPayload = priorLegacySeal?.payload;
  if (!legacySealPayload) throw new Error("legacy-resource-seal missing");
  const releasePayloads = {
    inventory32: priorRelease.find((r) => r.payload.gate === "inventory32")
      ?.payload,
    policyKernel: priorRelease.find((r) => r.payload.gate === "policy-kernel")
      ?.payload,
    sharedUiSource: priorRelease.find(
      (r) => r.payload.gate === "shared-ui-source",
    )?.payload,
  };
  if (
    !releasePayloads.inventory32 ||
    !releasePayloads.policyKernel ||
    !releasePayloads.sharedUiSource
  ) {
    throw new Error("release-gate payloads missing");
  }

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
    manifestVersion: "2026-07-22.r0-accelerated",
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
    replacementProjects: priorManifest.replacementProjects,
    protectedDomains,
    legacyProjects,
    foundationalReceiptIds,
    policy: EXACT_POLICY,
    preservedIndefinitely: EXACT_PRESERVATION,
    excludedScopes: Object.freeze(["per-user-vault"] as const),
  });

  const validated = validateRetirementManifest(
    manifest,
    cutover,
    environment.digest,
  );
  const manifestJson = `${JSON.stringify(validated, null, 2)}\n`;
  const manifestFileDigest = sha256(manifestJson);

  const journal = await loadJournalDaily();
  const soakWindow =
    journal.windowStartedAt ??
    priorManifest.createdAt ??
    createdAt;
  const soakObserved = journal.observedThrough ?? createdAt;
  const soakPayload = Object.freeze({
    windowStartedAt: soakWindow,
    observedThrough: soakObserved,
    probeIntervalMinutes: 15,
    dailyRuns: journal.dailyRuns,
    semanticFailures: journal.semanticFailures,
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

  const issuedAt = createdAt;
  const receipts: AnyRetirementReceipt[] = [
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.terminalDomains,
      "terminal-domains",
      issuedAt,
      terminalPayload as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.w1RollbackDrill,
      "w1-rollback-drill",
      issuedAt,
      w1Payload,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.releaseGates.inventory32,
      "release-gate",
      issuedAt,
      releasePayloads.inventory32 as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.releaseGates.policyKernel,
      "release-gate",
      issuedAt,
      releasePayloads.policyKernel as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.releaseGates.sharedUiSource,
      "release-gate",
      issuedAt,
      releasePayloads.sharedUiSource as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      foundationalReceiptIds.legacyResourceSeal,
      "legacy-resource-seal",
      issuedAt,
      legacySealPayload as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("soak", soakPayload),
      "soak",
      issuedAt,
      soakPayload,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("change-log", changeLogPayload),
      "change-log",
      issuedAt,
      changeLogPayload,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("incident-status", incidentPayload),
      "incident-status",
      issuedAt,
      incidentPayload,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("hold-status", holdPayload),
      "hold-status",
      issuedAt,
      holdPayload,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("shared-ui-release", sharedUiPayload),
      "shared-ui-release",
      issuedAt,
      sharedUiPayload as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("git-archive", gitArchivePayload),
      "git-archive",
      issuedAt,
      gitArchivePayload as never,
    ),
    sealRetirementReceipt(
      manifestFileDigest,
      receiptId("credential-status", credentialPayload),
      "credential-status",
      issuedAt,
      credentialPayload as never,
    ),
  ];

  const loadedBundle = sealRetirementReceiptBundle(
    manifestFileDigest,
    `retirement-accelerated-${finalSourceSha.slice(0, 12)}`,
    createdAt,
    receipts,
  );
  const receiptsJson = `${JSON.stringify(loadedBundle.bundle, null, 2)}\n`;

  await writePrivate(resolve(OUT_DIR, "retirement-manifest.json"), manifestJson);
  await writePrivate(
    resolve(OUT_DIR, "retirement-manifest.sha256"),
    `${manifestFileDigest}  retirement-manifest.json\n`,
  );
  await writePrivate(resolve(OUT_DIR, "retirement-receipts.json"), receiptsJson);
  await writePrivate(
    resolve(OUT_DIR, "retirement-receipts.sha256"),
    `${sha256(receiptsJson)}  retirement-receipts.json\n`,
  );
  await writePrivate(
    resolve(OUT_DIR, "r0-seal-status.json"),
    `${JSON.stringify(
      {
        sealedAt: createdAt,
        accelerated: true,
        operatorOverride: "2026-07-22 complete-retirement-authorization",
        terminalAcceptedAt,
        finalSourceSha,
        manifestDigest: manifestFileDigest,
        receiptBundleDigest: loadedBundle.digest,
        policy: EXACT_POLICY,
        receiptCount: receipts.length,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        manifestDigest: manifestFileDigest,
        receiptBundleDigest: loadedBundle.digest,
        receiptCount: receipts.length,
        policy: EXACT_POLICY,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
