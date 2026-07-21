import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SourceState {
  readonly branch: string;
  readonly headSha: string;
  readonly originMainSha: string | null;
  readonly dirtyEntryCount: number;
}

export interface SourceInspector {
  inspect(): Promise<SourceState>;
}

export interface InventoryState {
  readonly pending: number;
  readonly partial: number;
  readonly entries: number;
  readonly domains: number;
}

export interface InventoryInspector {
  inspect(): Promise<InventoryState>;
}

function git(repositoryRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(
      "git",
      ["-C", repositoryRoot, ...args],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Git inspection failed for ${args[0] ?? "command"}.`));
          return;
        }
        resolveResult(stdout.trim());
      },
    );
  });
}

export class GitSourceInspector implements SourceInspector {
  constructor(private readonly repositoryRoot: string) {}

  async inspect(): Promise<SourceState> {
    const [branch, headSha, dirty] = await Promise.all([
      git(this.repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      git(this.repositoryRoot, ["rev-parse", "HEAD"]),
      git(this.repositoryRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
    ]);
    let originMainSha: string | null = null;
    try {
      originMainSha = await git(this.repositoryRoot, [
        "rev-parse",
        "refs/remotes/origin/main",
      ]);
    } catch {
      originMainSha = null;
    }
    return Object.freeze({
      branch,
      headSha,
      originMainSha,
      dirtyEntryCount: dirty ? dirty.split(/\r?\n/u).length : 0,
    });
  }
}

export class GeneratedInventoryInspector implements InventoryInspector {
  constructor(private readonly repositoryRoot: string) {}

  async inspect(): Promise<InventoryState> {
    const path = resolve(
      this.repositoryRoot,
      "generated/route-handler-inventory.json",
    );
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      summary?: {
        entries?: unknown;
        domains?: unknown;
        parity?: {
          pending?: unknown;
          partial?: unknown;
        };
      };
    };
    const pending = parsed.summary?.parity?.pending;
    const partial = parsed.summary?.parity?.partial;
    const entries = parsed.summary?.entries;
    const domains = parsed.summary?.domains;
    if (
      typeof pending !== "number" ||
      typeof partial !== "number" ||
      typeof entries !== "number" ||
      typeof domains !== "number"
    ) {
      throw new Error("Generated inventory summary is incomplete.");
    }
    return Object.freeze({ pending, partial, entries, domains });
  }
}
