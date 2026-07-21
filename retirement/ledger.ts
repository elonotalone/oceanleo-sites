import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalSha256,
  deepFreeze,
  invariant,
  isRecord,
  isoMilliseconds,
} from "./canonical";
import type { RetirementMutationReceipt } from "./provider";

export const RETIREMENT_LEDGER_SCHEMA_VERSION =
  "oceanleo.retirement-ledger/v1" as const;
export const RETIREMENT_AUDIT_SCHEMA_VERSION =
  "oceanleo.retirement-audit/v1" as const;

export type RetirementLedgerStage =
  | "sealed"
  | "soft-retiring"
  | "soft-retired"
  | "deleting-provider-resources"
  | "provider-resources-deleted";

export interface RetirementLedger {
  schemaVersion: typeof RETIREMENT_LEDGER_SCHEMA_VERSION;
  manifestSha256: string;
  createdAt: string;
  updatedAt: string;
  stage: RetirementLedgerStage;
  lastReceiptBundleSha256: string;
  softRetiredAt?: string;
  providerResourcesDeletedAt?: string;
  completedActions: Record<string, RetirementMutationReceipt>;
  lastAuditSequence: number;
  lastAuditHash: string | null;
}

interface JournalState {
  readonly schemaVersion: typeof RETIREMENT_LEDGER_SCHEMA_VERSION;
  readonly manifestSha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stage: RetirementLedgerStage;
  readonly lastReceiptBundleSha256: string;
  readonly softRetiredAt?: string;
  readonly providerResourcesDeletedAt?: string;
  readonly completedActions: Readonly<Record<string, RetirementMutationReceipt>>;
}

interface RetirementAuditEventBody {
  readonly schemaVersion: typeof RETIREMENT_AUDIT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly previousHash: string | null;
  readonly recordedAt: string;
  readonly command: string;
  readonly manifestSha256: string;
  readonly receiptBundleSha256: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly stateAfter: JournalState;
}

export interface RetirementAuditEvent extends RetirementAuditEventBody {
  readonly eventHash: string;
}

export interface LedgerCommitContext {
  readonly command: string;
  readonly recordedAt: string;
  readonly receiptBundleSha256: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RetirementLedgerStore {
  load(): Promise<RetirementLedger | null>;
  commit(
    ledger: RetirementLedger,
    context: LedgerCommitContext,
  ): Promise<RetirementLedger>;
  withExclusiveLock<T>(operation: () => Promise<T>): Promise<T>;
}

function cloneLedger(ledger: RetirementLedger): RetirementLedger {
  return structuredClone(ledger);
}

function journalState(ledger: RetirementLedger): JournalState {
  const state: JournalState = {
    schemaVersion: ledger.schemaVersion,
    manifestSha256: ledger.manifestSha256,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
    stage: ledger.stage,
    lastReceiptBundleSha256: ledger.lastReceiptBundleSha256,
    completedActions: structuredClone(ledger.completedActions),
    ...(ledger.softRetiredAt
      ? { softRetiredAt: ledger.softRetiredAt }
      : {}),
    ...(ledger.providerResourcesDeletedAt
      ? { providerResourcesDeletedAt: ledger.providerResourcesDeletedAt }
      : {}),
  };
  return deepFreeze(state);
}

function ledgerFromEvent(event: RetirementAuditEvent): RetirementLedger {
  return {
    ...structuredClone(event.stateAfter),
    completedActions: structuredClone(event.stateAfter.completedActions),
    lastAuditSequence: event.sequence,
    lastAuditHash: event.eventHash,
  };
}

function validateLedgerShape(raw: unknown): RetirementLedger {
  invariant(isRecord(raw), "retirement ledger must be an object");
  invariant(
    raw.schemaVersion === RETIREMENT_LEDGER_SCHEMA_VERSION,
    "retirement ledger schema mismatch",
  );
  invariant(
    typeof raw.manifestSha256 === "string" &&
      typeof raw.createdAt === "string" &&
      typeof raw.updatedAt === "string" &&
      typeof raw.lastReceiptBundleSha256 === "string",
    "retirement ledger identity is incomplete",
  );
  invariant(
    [
      "sealed",
      "soft-retiring",
      "soft-retired",
      "deleting-provider-resources",
      "provider-resources-deleted",
    ].includes(String(raw.stage)),
    "retirement ledger stage is invalid",
  );
  invariant(isRecord(raw.completedActions), "completedActions is invalid");
  invariant(
    Number.isInteger(raw.lastAuditSequence) &&
      Number(raw.lastAuditSequence) >= 0,
    "lastAuditSequence is invalid",
  );
  invariant(
    raw.lastAuditHash === null || typeof raw.lastAuditHash === "string",
    "lastAuditHash is invalid",
  );
  isoMilliseconds(raw.createdAt, "ledger createdAt");
  isoMilliseconds(raw.updatedAt, "ledger updatedAt");
  return structuredClone(raw) as unknown as RetirementLedger;
}

export function createInitialRetirementLedger(
  manifestSha256: string,
  receiptBundleSha256: string,
  now: string,
): RetirementLedger {
  isoMilliseconds(now, "initial ledger timestamp");
  return {
    schemaVersion: RETIREMENT_LEDGER_SCHEMA_VERSION,
    manifestSha256,
    createdAt: now,
    updatedAt: now,
    stage: "sealed",
    lastReceiptBundleSha256: receiptBundleSha256,
    completedActions: {},
    lastAuditSequence: 0,
    lastAuditHash: null,
  };
}

export function assertRetirementLedgerCompatible(
  ledger: RetirementLedger,
  manifestSha256: string,
): void {
  invariant(
    ledger.schemaVersion === RETIREMENT_LEDGER_SCHEMA_VERSION &&
      ledger.manifestSha256 === manifestSha256,
    "retirement ledger is bound to another manifest",
  );
}

function parseAuditJournal(contents: string): readonly RetirementAuditEvent[] {
  if (contents.length === 0) return [];
  invariant(contents.endsWith("\n"), "audit journal has a partial final record");
  const events: RetirementAuditEvent[] = [];
  let previousHash: string | null = null;
  for (const [index, line] of contents.trimEnd().split("\n").entries()) {
    const raw = JSON.parse(line) as unknown;
    invariant(isRecord(raw), `audit event ${index + 1} is invalid`);
    invariant(
      raw.schemaVersion === RETIREMENT_AUDIT_SCHEMA_VERSION &&
        raw.sequence === index + 1 &&
        raw.previousHash === previousHash &&
        typeof raw.eventHash === "string",
      `audit event ${index + 1} chain is invalid`,
    );
    const { eventHash, ...body } = raw;
    invariant(
      eventHash === canonicalSha256(body),
      `audit event ${index + 1} digest mismatch`,
    );
    const event = raw as unknown as RetirementAuditEvent;
    validateLedgerShape({
      ...event.stateAfter,
      lastAuditSequence: event.sequence,
      lastAuditHash: event.eventHash,
    });
    events.push(deepFreeze(event));
    previousHash = eventHash;
  }
  return deepFreeze(events);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertPrivateMode(path: string): Promise<void> {
  const mode = (await stat(path)).mode & 0o777;
  invariant(mode === 0o600, `${path} must have mode 0600`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class AtomicRetirementLedgerStore implements RetirementLedgerStore {
  readonly journalPath: string;
  readonly lockPath: string;

  constructor(readonly path: string) {
    this.journalPath = `${path}.audit.jsonl`;
    this.lockPath = `${path}.lock`;
  }

  async load(): Promise<RetirementLedger | null> {
    const [snapshotBytes, journalBytes] = await Promise.all([
      readOptional(this.path),
      readOptional(this.journalPath),
    ]);
    if (snapshotBytes !== null) await assertPrivateMode(this.path);
    if (journalBytes !== null) await assertPrivateMode(this.journalPath);
    const snapshot =
      snapshotBytes === null
        ? null
        : validateLedgerShape(JSON.parse(snapshotBytes) as unknown);
    const events =
      journalBytes === null ? [] : parseAuditJournal(journalBytes);
    const latest = events.at(-1);
    if (!latest) {
      invariant(snapshot === null, "snapshot exists without an audit journal");
      return null;
    }
    const authoritative = ledgerFromEvent(latest);
    if (snapshot) {
      invariant(
        snapshot.manifestSha256 === authoritative.manifestSha256 &&
          snapshot.lastAuditSequence <= authoritative.lastAuditSequence,
        "retirement snapshot is incompatible with its audit journal",
      );
      if (snapshot.lastAuditSequence === authoritative.lastAuditSequence) {
        invariant(
          canonicalSha256(snapshot) === canonicalSha256(authoritative),
          "retirement snapshot differs from its audit event",
        );
      }
    }
    return authoritative;
  }

  private async appendEvent(event: RetirementAuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const handle = await open(this.journalPath, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(this.journalPath, 0o600);
  }

  private async replaceSnapshot(ledger: RetirementLedger): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const handle = await open(temporaryPath, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async commit(
    ledger: RetirementLedger,
    context: LedgerCommitContext,
  ): Promise<RetirementLedger> {
    const current = await this.load();
    invariant(
      (current === null &&
        ledger.lastAuditSequence === 0 &&
        ledger.lastAuditHash === null) ||
        (current !== null &&
          ledger.lastAuditSequence === current.lastAuditSequence &&
          ledger.lastAuditHash === current.lastAuditHash),
      "retirement ledger changed since it was loaded",
    );
    isoMilliseconds(context.recordedAt, "audit recordedAt");
    const pending = cloneLedger(ledger);
    pending.updatedAt = context.recordedAt;
    pending.lastReceiptBundleSha256 = context.receiptBundleSha256;
    const body: RetirementAuditEventBody = {
      schemaVersion: RETIREMENT_AUDIT_SCHEMA_VERSION,
      sequence: ledger.lastAuditSequence + 1,
      previousHash: ledger.lastAuditHash,
      recordedAt: context.recordedAt,
      command: context.command,
      manifestSha256: ledger.manifestSha256,
      receiptBundleSha256: context.receiptBundleSha256,
      details: deepFreeze(structuredClone(context.details ?? {})),
      stateAfter: journalState(pending),
    };
    const event: RetirementAuditEvent = deepFreeze({
      ...body,
      eventHash: canonicalSha256(body),
    });
    await this.appendEvent(event);
    const committed = ledgerFromEvent(event);
    await this.replaceSnapshot(committed);
    return committed;
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          })}\n`,
          "utf8",
        );
        await handle.sync();
        return async () => {
          await handle.close();
          await unlink(this.lockPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          const lock = JSON.parse(
            await readFile(this.lockPath, "utf8"),
          ) as { pid?: unknown };
          stale =
            typeof lock.pid !== "number" ||
            !Number.isInteger(lock.pid) ||
            !isProcessAlive(lock.pid);
        } catch {
          stale = false;
        }
        if (!stale || attempt > 0) {
          throw new Error(
            `Another retirement controller owns ${this.lockPath}; no mutation was attempted.`,
          );
        }
        await unlink(this.lockPath);
      }
    }
    throw new Error("Unable to acquire the retirement ledger lock.");
  }

  async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}

export class MemoryRetirementLedgerStore implements RetirementLedgerStore {
  private ledger: RetirementLedger | null = null;
  readonly events: RetirementAuditEvent[] = [];

  async load(): Promise<RetirementLedger | null> {
    return this.ledger ? cloneLedger(this.ledger) : null;
  }

  async commit(
    ledger: RetirementLedger,
    context: LedgerCommitContext,
  ): Promise<RetirementLedger> {
    const current = this.ledger;
    invariant(
      (current === null && ledger.lastAuditSequence === 0) ||
        (current !== null &&
          current.lastAuditSequence === ledger.lastAuditSequence &&
          current.lastAuditHash === ledger.lastAuditHash),
      "memory retirement ledger changed since it was loaded",
    );
    const pending = cloneLedger(ledger);
    pending.updatedAt = context.recordedAt;
    pending.lastReceiptBundleSha256 = context.receiptBundleSha256;
    const body: RetirementAuditEventBody = {
      schemaVersion: RETIREMENT_AUDIT_SCHEMA_VERSION,
      sequence: ledger.lastAuditSequence + 1,
      previousHash: ledger.lastAuditHash,
      recordedAt: context.recordedAt,
      command: context.command,
      manifestSha256: ledger.manifestSha256,
      receiptBundleSha256: context.receiptBundleSha256,
      details: deepFreeze(structuredClone(context.details ?? {})),
      stateAfter: journalState(pending),
    };
    const event = deepFreeze({
      ...body,
      eventHash: canonicalSha256(body),
    });
    this.events.push(event);
    this.ledger = ledgerFromEvent(event);
    return cloneLedger(this.ledger);
  }

  async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}
