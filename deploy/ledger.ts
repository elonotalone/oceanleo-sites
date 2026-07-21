import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AppProfile,
  DomainMoveReceipt,
  LoadedManifest,
  WaveId,
} from "./types";

export type WaveLedgerState =
  | "pending"
  | "in-progress"
  | "complete"
  | "rolling-back"
  | "rolled-back"
  | "rollback-failed";

export type DomainLedgerState =
  | "pending"
  | "move-requested"
  | "owner-verified"
  | "smoke-passed"
  | "rollback-requested"
  | "rolled-back"
  | "rollback-failed";

export interface DeploymentLedgerRecord {
  id: string;
  url: string;
  sourceSha: string;
  state: string;
  observedAt: string;
}

export interface TargetLedgerRecord {
  projectId?: string;
  deployment?: DeploymentLedgerRecord;
}

export interface WaveLedgerRecord {
  state: WaveLedgerState;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
}

export interface DomainLedgerRecord {
  wave: WaveId;
  sequence: number;
  state: DomainLedgerState;
  expectedLegacyProjectId: string;
  currentOwnerProjectId: string;
  moveAttempts: number;
  rollbackAttempts: number;
  moveReceipt?: DomainMoveReceipt;
  rollbackReceipt?: DomainMoveReceipt;
  ownerVerifiedAt?: string;
  smokeVerifiedAt?: string;
  rolledBackAt?: string;
  failureCode?: string;
}

export interface CutoverLedger {
  schemaVersion: "oceanleo.cutover-ledger.v1";
  manifestVersion: string;
  manifestSha256: string;
  sourceSha: string;
  createdAt: string;
  updatedAt: string;
  targets: Record<AppProfile, TargetLedgerRecord>;
  waves: Record<WaveId, WaveLedgerRecord>;
  domains: Record<string, DomainLedgerRecord>;
}

export interface LedgerStore {
  load(): Promise<CutoverLedger | null>;
  save(ledger: CutoverLedger): Promise<void>;
  withExclusiveLock<T>(operation: () => Promise<T>): Promise<T>;
}

const WAVE_IDS: readonly WaveId[] = [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
];

export function createInitialLedger(
  loaded: LoadedManifest,
  sourceSha: string,
  now: string,
): CutoverLedger {
  const waves = Object.fromEntries(
    WAVE_IDS.map((wave) => [wave, { state: "pending" }]),
  ) as Record<WaveId, WaveLedgerRecord>;
  const domains = Object.fromEntries(
    loaded.domains.map((domain) => [
      domain.host,
      {
        wave: domain.wave,
        sequence: domain.sequence,
        state: "pending",
        expectedLegacyProjectId: domain.legacyProjectId,
        currentOwnerProjectId: domain.legacyProjectId,
        moveAttempts: 0,
        rollbackAttempts: 0,
      } satisfies DomainLedgerRecord,
    ]),
  );
  return {
    schemaVersion: "oceanleo.cutover-ledger.v1",
    manifestVersion: loaded.manifest.manifestVersion,
    manifestSha256: loaded.digest,
    sourceSha,
    createdAt: now,
    updatedAt: now,
    targets: {
      standard: {},
      "website-privileged": {},
    },
    waves,
    domains,
  };
}

export function assertLedgerCompatible(
  ledger: CutoverLedger,
  loaded: LoadedManifest,
  sourceSha?: string,
): void {
  if (
    ledger.schemaVersion !== "oceanleo.cutover-ledger.v1" ||
    ledger.manifestVersion !== loaded.manifest.manifestVersion ||
    ledger.manifestSha256 !== loaded.digest
  ) {
    throw new Error("Cutover ledger does not match the immutable manifest.");
  }
  if (sourceSha !== undefined && ledger.sourceSha !== sourceSha) {
    throw new Error("Cutover ledger is bound to a different source SHA.");
  }
  const expectedHosts = loaded.domains.map((domain) => domain.host).sort();
  const ledgerHosts = Object.keys(ledger.domains).sort();
  if (
    expectedHosts.length !== ledgerHosts.length ||
    expectedHosts.some((host, index) => host !== ledgerHosts[index])
  ) {
    throw new Error("Cutover ledger domain set does not match the manifest.");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class AtomicJsonLedgerStore implements LedgerStore {
  readonly lockPath: string;

  constructor(readonly path: string) {
    this.lockPath = `${path}.lock`;
  }

  async load(): Promise<CutoverLedger | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { schemaVersion?: unknown }).schemaVersion !==
          "oceanleo.cutover-ledger.v1"
      ) {
        throw new Error("Cutover ledger has an invalid schema.");
      }
      return parsed as CutoverLedger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(ledger: CutoverLedger): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const bytes = `${JSON.stringify(ledger, null, 2)}\n`;
    try {
      await writeFile(temporaryPath, bytes, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const temporaryHandle = await open(temporaryPath, "r");
      try {
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
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
            `Another cutover controller owns ${this.lockPath}; no mutation was attempted.`,
          );
        }
        await unlink(this.lockPath);
      }
    }
    throw new Error("Unable to acquire the cutover ledger lock.");
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
