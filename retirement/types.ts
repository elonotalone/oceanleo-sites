import type { AppProfile, LoadedManifest } from "../deploy/types";

export const RETIREMENT_SCHEMA_VERSION = "oceanleo.retirement/v1" as const;
export const RETIREMENT_RECEIPT_SCHEMA_VERSION =
  "oceanleo.retirement-receipt/v1" as const;
export const RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION =
  "oceanleo.retirement-receipt-bundle/v1" as const;

export type ProtectedDomainKind = "canonical" | "compatibility-alias";
export type HoldKind = "incident" | "legal" | "unmigrated" | "credential";
export type AcceptedChangeKind =
  | "source"
  | "project-setting"
  | "environment"
  | "deployment"
  | "routing";

export interface RetirementPolicy {
  readonly soakDays: 30;
  readonly probeIntervalMinutes: 15;
  readonly minimumCompleteRunsPerUtcDay: 95;
  readonly minimumAvailability: 0.999;
  readonly maximumConsecutiveTransportFailures: 1;
  readonly quietPeriodHours: 72;
  readonly softRetireAfterDays: 30;
  readonly providerDeleteAfterDays: 60;
}

export interface ReplacementProject {
  readonly profile: AppProfile;
  readonly projectName: string;
  readonly projectId: string;
}

export interface ProtectedDomain {
  readonly host: string;
  readonly siteKey: string;
  readonly kind: ProtectedDomainKind;
  readonly ownerProjectId: string;
}

export interface GeneratedAlias {
  readonly id: string;
  readonly host: string;
}

export interface LegacyCredential {
  readonly legacyCredentialId: string;
  readonly targetCredentialId: string;
}

export interface LegacyRetirementResource {
  readonly siteKey: string;
  readonly projectName: string;
  readonly projectId: string;
  readonly repository: string;
  readonly githubRepository: string;
  readonly localClonePath: string;
  readonly retainedDeployment: Readonly<{
    id: string;
    sourceSha: string;
  }>;
  readonly environmentNameSha256: string;
  readonly generatedAliases: readonly GeneratedAlias[];
  readonly credentials: readonly LegacyCredential[];
}

export interface FoundationalReceiptIds {
  readonly terminalDomains: string;
  readonly w1RollbackDrill: string;
  readonly legacyResourceSeal: string;
  readonly releaseGates: Readonly<{
    inventory32: string;
    policyKernel: string;
    sharedUiSource: string;
  }>;
}

export interface RetirementManifest {
  readonly schemaVersion: typeof RETIREMENT_SCHEMA_VERSION;
  readonly manifestVersion: string;
  readonly createdAt: string;
  readonly terminalAcceptedAt: string;
  readonly source: Readonly<{
    repository: "elonotalone/oceanleo-sites";
    branch: "main";
    cutoverManifestSha256: string;
    environmentManifestSha256: string;
    finalSourceSha: string;
    finalCutoverLedgerSha256: string;
  }>;
  readonly replacementProjects: Readonly<Record<AppProfile, ReplacementProject>>;
  readonly protectedDomains: readonly ProtectedDomain[];
  readonly legacyProjects: readonly LegacyRetirementResource[];
  readonly foundationalReceiptIds: FoundationalReceiptIds;
  readonly policy: RetirementPolicy;
  readonly preservedIndefinitely: readonly [
    "canonical-domains",
    "compatibility-aliases",
    "manifests",
    "receipts",
    "ledgers",
    "audit-logs",
    "archived-git-history",
  ];
  readonly excludedScopes: readonly ["per-user-vault"];
}

export interface LoadedRetirementManifest {
  readonly manifest: RetirementManifest;
  readonly digest: string;
  readonly cutover: LoadedManifest;
}

export interface TerminalDomainsPayload {
  readonly cutoverManifestSha256: string;
  readonly environmentManifestSha256: string;
  readonly finalSourceSha: string;
  readonly finalCutoverLedgerSha256: string;
  readonly domains: readonly Readonly<{
    host: string;
    ownerProjectId: string;
    state: "smoke-passed";
    smokePassedAt: string;
  }>[];
}

export type W1RollbackStep =
  | Readonly<{
      kind: "move-to-replacement" | "return-to-legacy" | "re-move-to-replacement";
      projectId: string;
      providerReceiptId: string;
      completedAt: string;
    }>
  | Readonly<{
      kind: "legacy-smoke";
      projectId: string;
      smokeReceiptId: string;
      passed: true;
      completedAt: string;
    }>;

export interface W1RollbackDrillPayload {
  readonly siteKey: "asset";
  readonly host: "asset.oceanleo.com";
  readonly legacyProjectId: string;
  readonly replacementProjectId: string;
  readonly steps: readonly [
    W1RollbackStep,
    W1RollbackStep,
    W1RollbackStep,
    W1RollbackStep,
  ];
}

export interface ReleaseGatePayload {
  readonly gate: "inventory32" | "policy-kernel" | "shared-ui-source";
  readonly sourceSha: string;
  readonly status: "verified";
}

export interface LegacyResourceSealPayload {
  readonly projects: readonly Readonly<{
    projectId: string;
    retainedDeploymentId: string;
    retainedDeploymentSourceSha: string;
    environmentNameSha256: string;
    generatedAliasIds: readonly string[];
  }>[];
}

export interface SoakDailyRun {
  readonly utcDate: string;
  readonly completeRuns: number;
  readonly totalHostChecks: number;
  readonly availableHostChecks: number;
  readonly maxConsecutiveTransportFailures: number;
  readonly semanticMismatches: number;
}

export interface SoakPayload {
  readonly windowStartedAt: string;
  readonly observedThrough: string;
  readonly probeIntervalMinutes: number;
  readonly dailyRuns: readonly SoakDailyRun[];
  readonly semanticFailures: readonly Readonly<{
    id: string;
    occurredAt: string;
  }>[];
}

export interface ChangeLogPayload {
  readonly observedThrough: string;
  readonly acceptedChanges: readonly Readonly<{
    id: string;
    kind: AcceptedChangeKind;
    acceptedAt: string;
  }>[];
}

export interface IncidentStatusPayload {
  readonly observedThrough: string;
  readonly incidents: readonly Readonly<{
    id: string;
    severity: 1 | 2 | 3 | 4;
    openedAt: string;
    resolvedAt: string | null;
  }>[];
}

export interface HoldStatusPayload {
  readonly observedThrough: string;
  readonly holds: readonly Readonly<{
    id: string;
    kind: HoldKind;
    acceptedAt: string;
    releasedAt: string | null;
  }>[];
}

export interface SharedUiReleasePayload {
  readonly releaseId: string;
  readonly sourceSha: string;
  readonly releasedAt: string;
  readonly normalRelease: true;
  readonly topology: "replacement";
}

export interface GitArchivePayload {
  readonly projects: readonly Readonly<{
    projectId: string;
    githubRepository: string;
    repositoryArchiveReceiptId: string;
    archivedReadOnly: true;
    bundleReceiptId: string;
    bundleSha256: string;
    localClonePath: string;
    localCloneVerified: true;
  }>[];
}

export interface CredentialStatusPayload {
  readonly credentials: readonly Readonly<{
    projectId: string;
    legacyCredentialId: string;
    targetCredentialId: string;
    legacyFingerprintSha256: string;
    targetFingerprintSha256: string;
    distinct: boolean;
    issuerRevocationReceiptId: string;
    issuerRevocationProven: boolean;
  }>[];
}

export interface ReceiptPayloadByKind {
  readonly "terminal-domains": TerminalDomainsPayload;
  readonly "w1-rollback-drill": W1RollbackDrillPayload;
  readonly "release-gate": ReleaseGatePayload;
  readonly "legacy-resource-seal": LegacyResourceSealPayload;
  readonly soak: SoakPayload;
  readonly "change-log": ChangeLogPayload;
  readonly "incident-status": IncidentStatusPayload;
  readonly "hold-status": HoldStatusPayload;
  readonly "shared-ui-release": SharedUiReleasePayload;
  readonly "git-archive": GitArchivePayload;
  readonly "credential-status": CredentialStatusPayload;
}

export type RetirementReceiptKind = keyof ReceiptPayloadByKind;

export interface RetirementReceipt<
  K extends RetirementReceiptKind = RetirementReceiptKind,
> {
  readonly schemaVersion: typeof RETIREMENT_RECEIPT_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly kind: K;
  readonly issuedAt: string;
  readonly retirementManifestSha256: string;
  readonly payloadSha256: string;
  readonly payload: ReceiptPayloadByKind[K];
}

export type AnyRetirementReceipt = {
  [K in RetirementReceiptKind]: RetirementReceipt<K>;
}[RetirementReceiptKind];

export interface RetirementReceiptBundle {
  readonly schemaVersion: typeof RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION;
  readonly bundleId: string;
  readonly createdAt: string;
  readonly retirementManifestSha256: string;
  readonly receipts: readonly AnyRetirementReceipt[];
}

export interface LoadedRetirementReceiptBundle {
  readonly bundle: RetirementReceiptBundle;
  readonly digest: string;
}
