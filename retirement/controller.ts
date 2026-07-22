import {
  assertRetirementGatesPassed,
  evaluateRetirementGates,
  RetirementGateError,
  type RetirementGateEvaluation,
} from "./gates";
import {
  assertRetirementLedgerCompatible,
  createInitialRetirementLedger,
  type RetirementLedger,
  type RetirementLedgerStore,
} from "./ledger";
import {
  buildProviderDeletionPlan,
  buildSoftRetirementPlan,
  PlanOnlyRetirementProvider,
  type RetirementMutationAction,
  type RetirementProvider,
  validateMutationReceipt,
} from "./provider";
import type {
  LoadedRetirementManifest,
  LoadedRetirementReceiptBundle,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface RetirementClock {
  now(): string;
}

const SYSTEM_CLOCK: RetirementClock = Object.freeze({
  now: () => new Date().toISOString(),
});

export interface RetirementControllerDependencies {
  readonly loaded: LoadedRetirementManifest;
  readonly evidence: LoadedRetirementReceiptBundle;
  readonly ledgerStore: RetirementLedgerStore;
  readonly provider?: RetirementProvider;
  readonly clock?: RetirementClock;
}

export interface RetirementCommandResult {
  readonly command:
    | "status"
    | "check"
    | "soft-retire"
    | "delete-provider-resources";
  readonly dryRun: boolean;
  readonly mutations: boolean;
  readonly idempotent?: boolean;
  readonly stage: string;
  readonly evaluation: RetirementGateEvaluation;
  readonly plan?: readonly RetirementMutationAction[];
  readonly completedActionCount?: number;
  readonly deletionEligibleAt?: string;
}

function deletionEligibleAt(
  ledger: RetirementLedger,
  evaluation: RetirementGateEvaluation,
  providerDeleteAfterDays: number,
  softRetireAfterDays: number,
): number {
  if (
    !["soft-retired", "deleting-provider-resources", "provider-resources-deleted"].includes(
      ledger.stage,
    ) ||
    !ledger.softRetiredAt ||
    !evaluation.softRetireEligibleAt
  ) {
    throw new RetirementGateError("soft-retirement-incomplete");
  }
  const softRetiredAt = Date.parse(ledger.softRetiredAt);
  const soakSoftBoundary = Date.parse(evaluation.softRetireEligibleAt);
  if (!Number.isFinite(softRetiredAt) || !Number.isFinite(soakSoftBoundary)) {
    throw new RetirementGateError("retirement-boundary-invalid");
  }
  return Math.max(
    softRetiredAt + providerDeleteAfterDays * DAY_MS,
    soakSoftBoundary +
      (providerDeleteAfterDays - softRetireAfterDays) * DAY_MS,
  );
}

export class RetirementController {
  private readonly loaded: LoadedRetirementManifest;
  private readonly evidence: LoadedRetirementReceiptBundle;
  private readonly ledgerStore: RetirementLedgerStore;
  private readonly provider: RetirementProvider;
  private readonly clock: RetirementClock;

  constructor(dependencies: RetirementControllerDependencies) {
    this.loaded = dependencies.loaded;
    this.evidence = dependencies.evidence;
    this.ledgerStore = dependencies.ledgerStore;
    this.provider = dependencies.provider ?? new PlanOnlyRetirementProvider();
    this.clock = dependencies.clock ?? SYSTEM_CLOCK;
  }

  private evaluate(now = this.clock.now()): RetirementGateEvaluation {
    return evaluateRetirementGates(
      this.loaded,
      this.evidence,
      now,
    );
  }

  private async loadCompatibleLedger(): Promise<RetirementLedger | null> {
    const ledger = await this.ledgerStore.load();
    if (ledger) {
      assertRetirementLedgerCompatible(ledger, this.loaded.digest);
    }
    return ledger;
  }

  private async initializeLedger(now: string): Promise<RetirementLedger> {
    const ledger = createInitialRetirementLedger(
      this.loaded.digest,
      this.evidence.digest,
      now,
    );
    return this.ledgerStore.commit(ledger, {
      command: "initialize",
      recordedAt: now,
      receiptBundleSha256: this.evidence.digest,
      details: {
        manifestVersion: this.loaded.manifest.manifestVersion,
      },
    });
  }

  private async completeActions(
    ledger: RetirementLedger,
    actions: readonly RetirementMutationAction[],
  ): Promise<RetirementLedger> {
    let current = ledger;
    for (const action of actions) {
      if (current.completedActions[action.actionId]) continue;
      const receipt = validateMutationReceipt(
        action,
        await this.provider.apply(action),
      );
      current.completedActions[action.actionId] = receipt;
      current = await this.ledgerStore.commit(current, {
        command: "complete-action",
        recordedAt: this.clock.now(),
        receiptBundleSha256: this.evidence.digest,
        details: {
          actionId: action.actionId,
          actionKind: action.kind,
          providerReceiptId: receipt.providerReceiptId,
        },
      });
    }
    return current;
  }

  async status(): Promise<RetirementCommandResult> {
    const [ledger, evaluation] = await Promise.all([
      this.loadCompatibleLedger(),
      Promise.resolve(this.evaluate()),
    ]);
    return Object.freeze({
      command: "status",
      dryRun: true,
      mutations: false,
      stage: ledger?.stage ?? "uninitialized",
      evaluation,
      completedActionCount: Object.keys(ledger?.completedActions ?? {}).length,
    });
  }

  async check(): Promise<RetirementCommandResult> {
    const ledger = await this.loadCompatibleLedger();
    const evaluation = this.evaluate();
    return Object.freeze({
      command: "check",
      dryRun: true,
      mutations: false,
      stage: ledger?.stage ?? "uninitialized",
      evaluation,
      completedActionCount: Object.keys(ledger?.completedActions ?? {}).length,
    });
  }

  async softRetire(execute = false): Promise<RetirementCommandResult> {
    const evaluation = this.evaluate();
    assertRetirementGatesPassed(evaluation);
    const plan = buildSoftRetirementPlan(this.loaded.manifest);
    const existing = await this.loadCompatibleLedger();
    if (!execute) {
      return Object.freeze({
        command: "soft-retire",
        dryRun: true,
        mutations: false,
        stage: existing?.stage ?? "uninitialized",
        evaluation,
        plan,
        completedActionCount: Object.keys(existing?.completedActions ?? {})
          .length,
      });
    }

    return this.ledgerStore.withExclusiveLock(async () => {
      const lockedEvaluation = this.evaluate();
      assertRetirementGatesPassed(lockedEvaluation);
      let ledger = await this.loadCompatibleLedger();
      ledger ??= await this.initializeLedger(this.clock.now());
      if (
        ["soft-retired", "deleting-provider-resources", "provider-resources-deleted"].includes(
          ledger.stage,
        )
      ) {
        return Object.freeze({
          command: "soft-retire",
          dryRun: false,
          mutations: false,
          idempotent: true,
          stage: ledger.stage,
          evaluation: lockedEvaluation,
          plan,
          completedActionCount: Object.keys(ledger.completedActions).length,
        });
      }
      if (ledger.stage === "sealed") {
        ledger.stage = "soft-retiring";
        ledger = await this.ledgerStore.commit(ledger, {
          command: "begin-soft-retire",
          recordedAt: this.clock.now(),
          receiptBundleSha256: this.evidence.digest,
          details: { plannedActions: plan.length },
        });
      }
      if (ledger.stage !== "soft-retiring") {
        throw new RetirementGateError("soft-retirement-stage-invalid", {
          stage: ledger.stage,
        });
      }
      ledger = await this.completeActions(ledger, plan);
      ledger.stage = "soft-retired";
      ledger.softRetiredAt ??= this.clock.now();
      ledger = await this.ledgerStore.commit(ledger, {
        command: "complete-soft-retire",
        recordedAt: this.clock.now(),
        receiptBundleSha256: this.evidence.digest,
        details: { completedActions: plan.length },
      });
      return Object.freeze({
        command: "soft-retire",
        dryRun: false,
        mutations: plan.length > 0,
        stage: ledger.stage,
        evaluation: lockedEvaluation,
        plan,
        completedActionCount: Object.keys(ledger.completedActions).length,
      });
    });
  }

  async deleteProviderResources(
    execute = false,
  ): Promise<RetirementCommandResult> {
    const now = this.clock.now();
    const evaluation = this.evaluate(now);
    assertRetirementGatesPassed(evaluation);
    const ledger = await this.loadCompatibleLedger();
    if (!ledger) throw new RetirementGateError("retirement-ledger-missing");
    const eligibleAt = deletionEligibleAt(
      ledger,
      evaluation,
      this.loaded.manifest.policy.providerDeleteAfterDays,
      this.loaded.manifest.policy.softRetireAfterDays,
    );
    if (Date.parse(now) < eligibleAt) {
      throw new RetirementGateError("provider-deletion-premature", {
        eligibleAt: new Date(eligibleAt).toISOString(),
      });
    }
    const plan = buildProviderDeletionPlan(this.loaded.manifest);
    if (!execute) {
      return Object.freeze({
        command: "delete-provider-resources",
        dryRun: true,
        mutations: false,
        stage: ledger.stage,
        evaluation,
        plan,
        completedActionCount: Object.keys(ledger.completedActions).length,
        deletionEligibleAt: new Date(eligibleAt).toISOString(),
      });
    }

    return this.ledgerStore.withExclusiveLock(async () => {
      const lockedNow = this.clock.now();
      const lockedEvaluation = this.evaluate(lockedNow);
      assertRetirementGatesPassed(lockedEvaluation);
      let lockedLedger = await this.loadCompatibleLedger();
      if (!lockedLedger) {
        throw new RetirementGateError("retirement-ledger-missing");
      }
      const lockedEligibleAt = deletionEligibleAt(
        lockedLedger,
        lockedEvaluation,
        this.loaded.manifest.policy.providerDeleteAfterDays,
        this.loaded.manifest.policy.softRetireAfterDays,
      );
      if (Date.parse(lockedNow) < lockedEligibleAt) {
        throw new RetirementGateError("provider-deletion-premature", {
          eligibleAt: new Date(lockedEligibleAt).toISOString(),
        });
      }
      if (lockedLedger.stage === "provider-resources-deleted") {
        return Object.freeze({
          command: "delete-provider-resources",
          dryRun: false,
          mutations: false,
          idempotent: true,
          stage: lockedLedger.stage,
          evaluation: lockedEvaluation,
          plan,
          completedActionCount: Object.keys(lockedLedger.completedActions)
            .length,
          deletionEligibleAt: new Date(lockedEligibleAt).toISOString(),
        });
      }
      if (lockedLedger.stage === "soft-retired") {
        lockedLedger.stage = "deleting-provider-resources";
        lockedLedger = await this.ledgerStore.commit(lockedLedger, {
          command: "begin-delete-provider-resources",
          recordedAt: this.clock.now(),
          receiptBundleSha256: this.evidence.digest,
          details: { plannedActions: plan.length },
        });
      }
      if (lockedLedger.stage !== "deleting-provider-resources") {
        throw new RetirementGateError("provider-deletion-stage-invalid", {
          stage: lockedLedger.stage,
        });
      }
      lockedLedger = await this.completeActions(lockedLedger, plan);
      lockedLedger.stage = "provider-resources-deleted";
      lockedLedger.providerResourcesDeletedAt ??= this.clock.now();
      lockedLedger = await this.ledgerStore.commit(lockedLedger, {
        command: "complete-delete-provider-resources",
        recordedAt: this.clock.now(),
        receiptBundleSha256: this.evidence.digest,
        details: { completedActions: plan.length },
      });
      return Object.freeze({
        command: "delete-provider-resources",
        dryRun: false,
        mutations: plan.length > 0,
        stage: lockedLedger.stage,
        evaluation: lockedEvaluation,
        plan,
        completedActionCount: Object.keys(lockedLedger.completedActions).length,
        deletionEligibleAt: new Date(lockedEligibleAt).toISOString(),
      });
    });
  }
}
