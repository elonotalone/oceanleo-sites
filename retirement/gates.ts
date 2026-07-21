import {
  assertSha256,
  assertSourceSha,
  deepFreeze,
  isoMilliseconds,
} from "./canonical";
import { receiptsOfKind } from "./receipts";
import type {
  LoadedRetirementManifest,
  LoadedRetirementReceiptBundle,
  ReceiptPayloadByKind,
  RetirementReceipt,
  RetirementReceiptKind,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export interface RetirementGateBlocker {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface RetirementGateEvaluation {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly blockers: readonly RetirementGateBlocker[];
  readonly terminalAcceptedAt: string;
  readonly effectiveSoakStartedAt: string | null;
  readonly softRetireEligibleAt: string | null;
  readonly quietPeriodStartedAt: string | null;
  readonly quietPeriodEligibleAt: string | null;
  readonly observedAvailability: number | null;
}

function addBlocker(
  blockers: RetirementGateBlocker[],
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  blockers.push(deepFreeze({ code, details }));
}

function timestamp(
  value: string,
  label: string,
  blockers: RetirementGateBlocker[],
): number | null {
  try {
    return isoMilliseconds(value, label);
  } catch {
    addBlocker(blockers, "timestamp-invalid", { label, value });
    return null;
  }
}

function oneReceipt<K extends RetirementReceiptKind>(
  evidence: LoadedRetirementReceiptBundle,
  kind: K,
  blockers: RetirementGateBlocker[],
): RetirementReceipt<K> | null {
  const receipts = receiptsOfKind(evidence.bundle, kind);
  if (receipts.length !== 1) {
    addBlocker(blockers, "receipt-cardinality", {
      kind,
      expected: 1,
      actual: receipts.length,
    });
    return null;
  }
  return receipts[0] as RetirementReceipt<K>;
}

function validateTerminalDomains(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipt = oneReceipt(evidence, "terminal-domains", blockers);
  if (!receipt) return;
  const manifest = loaded.manifest;
  const payload = receipt.payload;
  if (receipt.receiptId !== manifest.foundationalReceiptIds.terminalDomains) {
    addBlocker(blockers, "terminal-domain-receipt-id", {
      actual: receipt.receiptId,
    });
  }
  const sourceMatches =
    payload.cutoverManifestSha256 ===
      manifest.source.cutoverManifestSha256 &&
    payload.environmentManifestSha256 ===
      manifest.source.environmentManifestSha256 &&
    payload.finalSourceSha === manifest.source.finalSourceSha &&
    payload.finalCutoverLedgerSha256 ===
      manifest.source.finalCutoverLedgerSha256;
  if (!sourceMatches) addBlocker(blockers, "terminal-source-evidence-mismatch");

  const observations = new Map(
    payload.domains.map((domain) => [domain.host, domain]),
  );
  if (
    payload.domains.length !== 37 ||
    observations.size !== 37 ||
    manifest.protectedDomains.some((expected) => {
      const actual = observations.get(expected.host);
      return (
        !actual ||
        actual.ownerProjectId !== expected.ownerProjectId ||
        actual.state !== "smoke-passed"
      );
    })
  ) {
    addBlocker(blockers, "terminal-domain-coverage", {
      expected: 37,
      actual: observations.size,
    });
  }
}

function validateW1Drill(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipt = oneReceipt(evidence, "w1-rollback-drill", blockers);
  if (!receipt) return;
  const manifest = loaded.manifest;
  const payload = receipt.payload;
  const asset = manifest.legacyProjects.find(
    (project) => project.siteKey === "asset",
  );
  const expectedKinds = [
    "move-to-replacement",
    "return-to-legacy",
    "legacy-smoke",
    "re-move-to-replacement",
  ] as const;
  const expectedProjects = [
    manifest.replacementProjects.standard.projectId,
    asset?.projectId,
    asset?.projectId,
    manifest.replacementProjects.standard.projectId,
  ];
  let previous = Number.NEGATIVE_INFINITY;
  const ordered = payload.steps.every((step, index) => {
    const completed = Date.parse(step.completedAt);
    const valid =
      step.kind === expectedKinds[index] &&
      step.projectId === expectedProjects[index] &&
      Number.isFinite(completed) &&
      completed >= previous &&
      ("providerReceiptId" in step
        ? step.providerReceiptId.length > 0
        : step.passed === true && step.smokeReceiptId.length > 0);
    previous = completed;
    return valid;
  });
  if (
    receipt.receiptId !==
      manifest.foundationalReceiptIds.w1RollbackDrill ||
    !asset ||
    payload.siteKey !== "asset" ||
    payload.host !== "asset.oceanleo.com" ||
    payload.legacyProjectId !== asset.projectId ||
    payload.replacementProjectId !==
      manifest.replacementProjects.standard.projectId ||
    payload.steps.length !== 4 ||
    !ordered
  ) {
    addBlocker(blockers, "w1-rollback-drill");
  }
}

function validateReleaseGates(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipts = receiptsOfKind(evidence.bundle, "release-gate");
  const required = loaded.manifest.foundationalReceiptIds.releaseGates;
  const gates = [
    ["inventory32", required.inventory32],
    ["policy-kernel", required.policyKernel],
    ["shared-ui-source", required.sharedUiSource],
  ] as const;
  if (receipts.length !== 3) {
    addBlocker(blockers, "release-gate-cardinality", {
      expected: 3,
      actual: receipts.length,
    });
  }
  for (const [gate, receiptId] of gates) {
    const receipt = receipts.find((candidate) => candidate.receiptId === receiptId);
    if (
      !receipt ||
      receipt.payload.gate !== gate ||
      receipt.payload.status !== "verified" ||
      receipt.payload.sourceSha !== loaded.manifest.source.finalSourceSha
    ) {
      addBlocker(blockers, "release-gate-missing", { gate, receiptId });
    }
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateLegacySeal(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipt = oneReceipt(evidence, "legacy-resource-seal", blockers);
  if (!receipt) return;
  const expected = loaded.manifest.legacyProjects;
  const byProject = new Map(
    receipt.payload.projects.map((project) => [project.projectId, project]),
  );
  const mismatch =
    receipt.receiptId !==
      loaded.manifest.foundationalReceiptIds.legacyResourceSeal ||
    receipt.payload.projects.length !== 31 ||
    byProject.size !== 31 ||
    expected.some((project) => {
      const sealed = byProject.get(project.projectId);
      return (
        !sealed ||
        sealed.retainedDeploymentId !== project.retainedDeployment.id ||
        sealed.retainedDeploymentSourceSha !==
          project.retainedDeployment.sourceSha ||
        sealed.environmentNameSha256 !== project.environmentNameSha256 ||
        !sameStrings(
          sealed.generatedAliasIds,
          project.generatedAliases.map((alias) => alias.id),
        )
      );
    });
  if (mismatch) addBlocker(blockers, "legacy-resource-seal");
}

interface SoakResult {
  readonly windowStartedAt: number | null;
  readonly softEligibleAt: number | null;
  readonly availability: number | null;
}

function validateSoak(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  now: number,
  blockers: RetirementGateBlocker[],
): SoakResult {
  const receipt = oneReceipt(evidence, "soak", blockers);
  if (!receipt) {
    return {
      windowStartedAt: null,
      softEligibleAt: null,
      availability: null,
    };
  }
  const payload = receipt.payload;
  const policy = loaded.manifest.policy;
  const terminal = Date.parse(loaded.manifest.terminalAcceptedAt);
  const windowStart = timestamp(
    payload.windowStartedAt,
    "soak windowStartedAt",
    blockers,
  );
  const observedThrough = timestamp(
    payload.observedThrough,
    "soak observedThrough",
    blockers,
  );
  const semanticTimes = payload.semanticFailures
    .map((failure) =>
      timestamp(failure.occurredAt, `semantic failure ${failure.id}`, blockers),
    )
    .filter((value): value is number => value !== null);
  const requiredRestart = Math.max(terminal, ...semanticTimes);
  if (windowStart !== null && windowStart < requiredRestart) {
    addBlocker(blockers, "semantic-soak-restart-required", {
      windowStartedAt: payload.windowStartedAt,
      requiredStartAt: new Date(requiredRestart).toISOString(),
    });
  }
  if (payload.probeIntervalMinutes !== policy.probeIntervalMinutes) {
    addBlocker(blockers, "soak-probe-interval", {
      expected: policy.probeIntervalMinutes,
      actual: payload.probeIntervalMinutes,
    });
  }
  const dates = new Set<string>();
  let totalChecks = 0;
  let availableChecks = 0;
  for (const day of payload.dailyRuns) {
    const dateValid = /^\d{4}-\d{2}-\d{2}$/u.test(day.utcDate);
    if (!dateValid || dates.has(day.utcDate)) {
      addBlocker(blockers, "soak-daily-date", { utcDate: day.utcDate });
    }
    dates.add(day.utcDate);
    if (
      !Number.isInteger(day.completeRuns) ||
      day.completeRuns < policy.minimumCompleteRunsPerUtcDay
    ) {
      addBlocker(blockers, "soak-daily-runs", {
        utcDate: day.utcDate,
        completeRuns: day.completeRuns,
      });
    }
    if (
      !Number.isInteger(day.totalHostChecks) ||
      !Number.isInteger(day.availableHostChecks) ||
      day.totalHostChecks < day.completeRuns * 37 ||
      day.availableHostChecks < 0 ||
      day.availableHostChecks > day.totalHostChecks
    ) {
      addBlocker(blockers, "soak-host-check-count", {
        utcDate: day.utcDate,
      });
    }
    if (
      day.maxConsecutiveTransportFailures >
      policy.maximumConsecutiveTransportFailures
    ) {
      addBlocker(blockers, "soak-consecutive-transport-failures", {
        utcDate: day.utcDate,
        actual: day.maxConsecutiveTransportFailures,
      });
    }
    if (day.semanticMismatches !== 0) {
      addBlocker(blockers, "soak-semantic-mismatch", {
        utcDate: day.utcDate,
        actual: day.semanticMismatches,
      });
    }
    totalChecks += day.totalHostChecks;
    availableChecks += day.availableHostChecks;
  }
  if (dates.size < policy.soakDays) {
    addBlocker(blockers, "soak-complete-utc-days", {
      expectedAtLeast: policy.soakDays,
      actual: dates.size,
    });
  }
  const availability =
    totalChecks > 0 ? availableChecks / totalChecks : null;
  if (
    availability === null ||
    availability < policy.minimumAvailability
  ) {
    addBlocker(blockers, "soak-availability", {
      expectedAtLeast: policy.minimumAvailability,
      actual: availability,
    });
  }
  const softEligibleAt =
    windowStart === null
      ? null
      : windowStart + policy.softRetireAfterDays * DAY_MS;
  if (
    windowStart !== null &&
    observedThrough !== null &&
    observedThrough - windowStart < policy.soakDays * DAY_MS
  ) {
    addBlocker(blockers, "soak-duration");
  }
  if (
    observedThrough !== null &&
    softEligibleAt !== null &&
    observedThrough < softEligibleAt
  ) {
    addBlocker(blockers, "soak-evidence-through-boundary");
  }
  if (softEligibleAt !== null && now < softEligibleAt) {
    addBlocker(blockers, "soft-retirement-premature", {
      eligibleAt: new Date(softEligibleAt).toISOString(),
    });
  }
  if (observedThrough !== null && observedThrough > now) {
    addBlocker(blockers, "soak-evidence-from-future");
  }
  return { windowStartedAt: windowStart, softEligibleAt, availability };
}

function validateSharedRelease(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): number | null {
  const receipt = oneReceipt(evidence, "shared-ui-release", blockers);
  if (!receipt) return null;
  const payload = receipt.payload;
  const releasedAt = timestamp(
    payload.releasedAt,
    "shared UI releasedAt",
    blockers,
  );
  if (
    payload.normalRelease !== true ||
    payload.topology !== "replacement" ||
    releasedAt === null ||
    releasedAt <= Date.parse(loaded.manifest.terminalAcceptedAt)
  ) {
    addBlocker(blockers, "post-cutover-shared-ui-release");
  }
  return releasedAt;
}

function validateQuietPeriod(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  now: number,
  soakStartedAt: number | null,
  sharedReleaseAt: number | null,
  blockers: RetirementGateBlocker[],
): Readonly<{ startedAt: number | null; eligibleAt: number | null }> {
  const receipt = oneReceipt(evidence, "change-log", blockers);
  if (!receipt || soakStartedAt === null) {
    return { startedAt: null, eligibleAt: null };
  }
  const observedThrough = timestamp(
    receipt.payload.observedThrough,
    "change log observedThrough",
    blockers,
  );
  if (observedThrough !== null && observedThrough < now) {
    addBlocker(blockers, "change-log-stale", {
      observedThrough: receipt.payload.observedThrough,
    });
  }
  const changes = receipt.payload.acceptedChanges
    .map((change) =>
      timestamp(change.acceptedAt, `accepted change ${change.id}`, blockers),
    )
    .filter((value): value is number => value !== null);
  const startedAt = Math.max(
    soakStartedAt,
    sharedReleaseAt ?? Number.NEGATIVE_INFINITY,
    ...changes,
  );
  const eligibleAt =
    startedAt + loaded.manifest.policy.quietPeriodHours * HOUR_MS;
  if (now < eligibleAt) {
    addBlocker(blockers, "quiet-period-incomplete", {
      startedAt: new Date(startedAt).toISOString(),
      eligibleAt: new Date(eligibleAt).toISOString(),
    });
  }
  return { startedAt, eligibleAt };
}

function validateIncidentsAndHolds(
  evidence: LoadedRetirementReceiptBundle,
  now: number,
  blockers: RetirementGateBlocker[],
): void {
  const incidents = oneReceipt(evidence, "incident-status", blockers);
  if (incidents) {
    const observed = timestamp(
      incidents.payload.observedThrough,
      "incident status observedThrough",
      blockers,
    );
    if (observed !== null && observed < now) {
      addBlocker(blockers, "incident-status-stale");
    }
    const unresolved = incidents.payload.incidents.filter(
      (incident) => incident.severity <= 2 && incident.resolvedAt === null,
    );
    if (unresolved.length > 0) {
      addBlocker(blockers, "unresolved-severity-1-or-2", {
        incidentIds: unresolved.map((incident) => incident.id),
      });
    }
  }
  const holds = oneReceipt(evidence, "hold-status", blockers);
  if (holds) {
    const observed = timestamp(
      holds.payload.observedThrough,
      "hold status observedThrough",
      blockers,
    );
    if (observed !== null && observed < now) {
      addBlocker(blockers, "hold-status-stale");
    }
    const active = holds.payload.holds.filter(
      (hold) => hold.releasedAt === null,
    );
    if (active.length > 0) {
      addBlocker(blockers, "active-retirement-hold", {
        holds: active.map((hold) => ({ id: hold.id, kind: hold.kind })),
      });
    }
  }
}

function validateGitArchives(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipt = oneReceipt(evidence, "git-archive", blockers);
  if (!receipt) return;
  const records = new Map(
    receipt.payload.projects.map((project) => [project.projectId, project]),
  );
  const mismatch =
    receipt.payload.projects.length !== 31 ||
    records.size !== 31 ||
    loaded.manifest.legacyProjects.some((project) => {
      const record = records.get(project.projectId);
      if (!record) return true;
      try {
        assertSha256(record.bundleSha256, `${project.siteKey} bundle digest`);
      } catch {
        return true;
      }
      return (
        record.githubRepository !== project.githubRepository ||
        record.repositoryArchiveReceiptId.length === 0 ||
        record.archivedReadOnly !== true ||
        record.bundleReceiptId.length === 0 ||
        record.localClonePath !== project.localClonePath ||
        record.localCloneVerified !== true
      );
    });
  if (mismatch) addBlocker(blockers, "git-archive-coverage");
}

function validateCredentials(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  blockers: RetirementGateBlocker[],
): void {
  const receipt = oneReceipt(evidence, "credential-status", blockers);
  if (!receipt) return;
  const expected = loaded.manifest.legacyProjects.flatMap((project) =>
    project.credentials.map((credential) => ({
      projectId: project.projectId,
      ...credential,
    })),
  );
  const key = (record: {
    readonly projectId: string;
    readonly legacyCredentialId: string;
  }): string => `${record.projectId}:${record.legacyCredentialId}`;
  const records = new Map(
    receipt.payload.credentials.map((credential) => [
      key(credential),
      credential,
    ]),
  );
  let mismatch =
    receipt.payload.credentials.length !== expected.length ||
    records.size !== expected.length;
  for (const credential of expected) {
    const record = records.get(key(credential));
    if (!record) {
      mismatch = true;
      continue;
    }
    try {
      assertSha256(
        record.legacyFingerprintSha256,
        `${record.legacyCredentialId} legacy fingerprint`,
      );
      assertSha256(
        record.targetFingerprintSha256,
        `${record.legacyCredentialId} target fingerprint`,
      );
    } catch {
      mismatch = true;
      continue;
    }
    if (
      record.targetCredentialId !== credential.targetCredentialId ||
      record.distinct !== true ||
      record.legacyFingerprintSha256 === record.targetFingerprintSha256 ||
      record.issuerRevocationReceiptId.length === 0 ||
      record.issuerRevocationProven !== true
    ) {
      mismatch = true;
    }
  }
  if (mismatch) addBlocker(blockers, "credential-distinctness-or-revocation");
}

export function evaluateRetirementGates(
  loaded: LoadedRetirementManifest,
  evidence: LoadedRetirementReceiptBundle,
  nowIso: string,
): RetirementGateEvaluation {
  const blockers: RetirementGateBlocker[] = [];
  const now = timestamp(nowIso, "controller clock", blockers) ?? 0;
  if (
    evidence.bundle.retirementManifestSha256 !== loaded.digest
  ) {
    addBlocker(blockers, "receipt-bundle-manifest-mismatch");
  }
  validateTerminalDomains(loaded, evidence, blockers);
  validateW1Drill(loaded, evidence, blockers);
  validateReleaseGates(loaded, evidence, blockers);
  validateLegacySeal(loaded, evidence, blockers);
  const soak = validateSoak(loaded, evidence, now, blockers);
  const sharedReleaseAt = validateSharedRelease(loaded, evidence, blockers);
  const quiet = validateQuietPeriod(
    loaded,
    evidence,
    now,
    soak.windowStartedAt,
    sharedReleaseAt,
    blockers,
  );
  validateIncidentsAndHolds(evidence, now, blockers);
  validateGitArchives(loaded, evidence, blockers);
  validateCredentials(loaded, evidence, blockers);
  return deepFreeze({
    ok: blockers.length === 0,
    checkedAt: nowIso,
    blockers,
    terminalAcceptedAt: loaded.manifest.terminalAcceptedAt,
    effectiveSoakStartedAt:
      soak.windowStartedAt === null
        ? null
        : new Date(soak.windowStartedAt).toISOString(),
    softRetireEligibleAt:
      soak.softEligibleAt === null
        ? null
        : new Date(soak.softEligibleAt).toISOString(),
    quietPeriodStartedAt:
      quiet.startedAt === null
        ? null
        : new Date(quiet.startedAt).toISOString(),
    quietPeriodEligibleAt:
      quiet.eligibleAt === null
        ? null
        : new Date(quiet.eligibleAt).toISOString(),
    observedAvailability: soak.availability,
  });
}

export function assertRetirementGatesPassed(
  evaluation: RetirementGateEvaluation,
): void {
  if (!evaluation.ok) {
    throw new RetirementGateError("retirement-evidence-blocked", {
      blockers: evaluation.blockers,
    });
  }
}

export class RetirementGateError extends Error {
  override name = "RetirementGateError";

  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`Retirement gate failed: ${code}.`);
  }
}
