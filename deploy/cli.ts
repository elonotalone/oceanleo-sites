import { resolve } from "node:path";

import {
  CutoverController,
  CutoverGateError,
  CutoverWaveError,
} from "./controller";
import {
  EnvironmentSyncError,
  loadEnvironmentMapping,
} from "./environment";
import { AtomicJsonLedgerStore } from "./ledger";
import {
  GeneratedInventoryInspector,
  GitSourceInspector,
} from "./local-state";
import { loadCutoverManifest } from "./manifest";
import { VercelOpsProvider } from "./provider";
import type { WaveId } from "./types";
import { assertDualAppMutationsAllowed } from "../scripts/assert-dual-app-retired";

type Command =
  | "plan"
  | "check"
  | "create-project"
  | "sync-env"
  | "deploy"
  | "move"
  | "rollback"
  | "status";

const COMMANDS: readonly Command[] = [
  "plan",
  "check",
  "create-project",
  "sync-env",
  "deploy",
  "move",
  "rollback",
  "status",
];
const WAVES: readonly WaveId[] = [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
];

interface ParsedArguments {
  readonly command: Command;
  readonly sourceSha?: string;
  readonly wave?: WaveId;
  readonly ledgerPath: string;
  readonly execute: boolean;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command as Command)) {
    throw new CutoverGateError("command-invalid");
  }
  let sourceSha: string | undefined;
  let wave: WaveId | undefined;
  let ledgerPath =
    process.env.OCEANLEO_CUTOVER_LEDGER ??
    "/var/lib/oceanleo-cutover/ledger.json";
  let execute = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      if (execute) throw new CutoverGateError("execute-flag-repeated");
      execute = true;
      continue;
    }
    if (argument === "--sha") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || sourceSha) {
        throw new CutoverGateError("sha-option-invalid");
      }
      sourceSha = value;
      index += 1;
      continue;
    }
    if (argument === "--wave") {
      const value = argv[index + 1];
      if (!value || !WAVES.includes(value as WaveId) || wave) {
        throw new CutoverGateError("wave-option-invalid");
      }
      wave = value as WaveId;
      index += 1;
      continue;
    }
    if (argument === "--ledger") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CutoverGateError("ledger-option-invalid");
      }
      ledgerPath = resolve(value);
      index += 1;
      continue;
    }
    throw new CutoverGateError("option-invalid", { option: argument });
  }
  const typedCommand = command as Command;
  if (
    ["plan", "check", "create-project", "sync-env", "deploy", "move"].includes(
      typedCommand,
    ) &&
    !sourceSha
  ) {
    throw new CutoverGateError("source-sha-required");
  }
  if (typedCommand === "move" && !wave) {
    throw new CutoverGateError("wave-required");
  }
  if (
    execute &&
    ["plan", "check", "status"].includes(typedCommand)
  ) {
    throw new CutoverGateError("execute-not-allowed", {
      command: typedCommand,
    });
  }
  try {
    assertDualAppMutationsAllowed({
      command: typedCommand,
      execute,
    });
  } catch (error) {
    throw new CutoverGateError("dual-app-retired", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return Object.freeze({
    command: typedCommand,
    sourceSha,
    wave,
    ledgerPath,
    execute,
  });
}

function safeError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof EnvironmentSyncError) {
    return Object.freeze({
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  if (error instanceof CutoverGateError) {
    return Object.freeze({
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  if (error instanceof CutoverWaveError) {
    return Object.freeze({
      name: error.name,
      code: error.failureCode,
      message: error.message,
      wave: error.wave,
      rollbackSucceeded: error.rollbackSucceeded,
    });
  }
  return Object.freeze({
    name: error instanceof Error ? error.name : "Error",
    code: "unclassified-error",
    message:
      error instanceof Error
        ? error.message
        : "Cutover controller failed without an Error object.",
  });
}

export async function runCutoverCli(
  argv: readonly string[],
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Promise<number> {
  try {
    const options = parseArguments(argv);
    const loaded = await loadCutoverManifest();
    const repositoryRoot = loaded.manifest.source.repositoryRoot;
    const controller = new CutoverController({
      loaded,
      provider: new VercelOpsProvider(),
      ledgerStore: new AtomicJsonLedgerStore(options.ledgerPath),
      sourceInspector: new GitSourceInspector(repositoryRoot),
      inventoryInspector: new GeneratedInventoryInspector(repositoryRoot),
    });
    let result: Readonly<Record<string, unknown>>;
    switch (options.command) {
      case "plan":
        result = controller.plan(
          options.sourceSha as string,
          options.wave,
        );
        break;
      case "check":
        result = await controller.check(
          options.sourceSha as string,
          options.wave,
        );
        break;
      case "create-project":
        result = await controller.createProjects(
          options.sourceSha as string,
          options.execute,
        );
        break;
      case "sync-env":
        result = await controller.syncEnvironment(
          options.sourceSha as string,
          await loadEnvironmentMapping(loaded),
          options.execute,
        );
        break;
      case "deploy":
        result = await controller.deploy(
          options.sourceSha as string,
          options.execute,
        );
        break;
      case "move":
        result = await controller.move(
          options.sourceSha as string,
          options.wave as WaveId,
          options.execute,
        );
        break;
      case "rollback":
        result = await controller.rollback(options.wave, options.execute);
        break;
      case "status":
        result = await controller.status();
        break;
    }
    write(JSON.stringify({ ok: true, command: options.command, result }, null, 2));
    return 0;
  } catch (error) {
    write(JSON.stringify({ ok: false, error: safeError(error) }, null, 2));
    return 1;
  }
}
