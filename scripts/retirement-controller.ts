import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  RetirementController,
} from "../retirement/controller";
import { RetirementGateError } from "../retirement/gates";
import { AtomicRetirementLedgerStore } from "../retirement/ledger";
import { loadRetirementManifest } from "../retirement/manifest";
import type { RetirementProvider } from "../retirement/provider";
import { loadRetirementReceiptBundle } from "../retirement/receipts";
import { VercelRetirementProvider } from "../retirement/vercel-provider";
import { assertDualAppMutationsAllowed } from "./assert-dual-app-retired";

type Command =
  | "status"
  | "check"
  | "soft-retire"
  | "delete-provider-resources";

const COMMANDS: readonly Command[] = [
  "status",
  "check",
  "soft-retire",
  "delete-provider-resources",
];

interface ParsedArguments {
  readonly command: Command;
  readonly execute: boolean;
  readonly manifestPath: string;
  readonly manifestDigestPath: string;
  readonly receiptsPath: string;
  readonly receiptsDigestPath: string;
  readonly ledgerPath: string;
}

function requiredPath(
  value: string | undefined,
  option: string,
): string {
  if (!value) throw new RetirementGateError(`${option}-required`);
  return resolve(value);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command as Command)) {
    throw new RetirementGateError("command-invalid");
  }
  let execute = false;
  let manifestPath =
    process.env.OCEANLEO_RETIREMENT_MANIFEST ??
    "/var/lib/oceanleo-retirement/retirement-manifest.json";
  let manifestDigestPath =
    process.env.OCEANLEO_RETIREMENT_MANIFEST_SHA256 ??
    "/var/lib/oceanleo-retirement/retirement-manifest.sha256";
  let receiptsPath =
    process.env.OCEANLEO_RETIREMENT_RECEIPTS ??
    "/var/lib/oceanleo-retirement/retirement-receipts.json";
  let receiptsDigestPath =
    process.env.OCEANLEO_RETIREMENT_RECEIPTS_SHA256 ??
    "/var/lib/oceanleo-retirement/retirement-receipts.sha256";
  let ledgerPath =
    process.env.OCEANLEO_RETIREMENT_LEDGER ??
    "/var/lib/oceanleo-retirement/ledger.json";

  const paths = new Map<
    string,
    (value: string) => void
  >([
    ["--manifest", (value) => (manifestPath = value)],
    ["--manifest-sha256", (value) => (manifestDigestPath = value)],
    ["--receipts", (value) => (receiptsPath = value)],
    ["--receipts-sha256", (value) => (receiptsDigestPath = value)],
    ["--ledger", (value) => (ledgerPath = value)],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      if (execute) throw new RetirementGateError("execute-flag-repeated");
      execute = true;
      continue;
    }
    const assign = paths.get(argument ?? "");
    if (assign) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new RetirementGateError("option-value-invalid", {
          option: argument,
        });
      }
      assign(value);
      index += 1;
      continue;
    }
    throw new RetirementGateError("option-invalid", { option: argument });
  }
  if (
    execute &&
    (command === "status" || command === "check")
  ) {
    throw new RetirementGateError("execute-not-allowed", { command });
  }
  try {
    assertDualAppMutationsAllowed({
      command: command as string,
      execute,
    });
  } catch (error) {
    throw new RetirementGateError("dual-app-retired", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return Object.freeze({
    command: command as Command,
    execute,
    manifestPath: requiredPath(manifestPath, "manifest"),
    manifestDigestPath: requiredPath(
      manifestDigestPath,
      "manifest-sha256",
    ),
    receiptsPath: requiredPath(receiptsPath, "receipts"),
    receiptsDigestPath: requiredPath(
      receiptsDigestPath,
      "receipts-sha256",
    ),
    ledgerPath: resolve(ledgerPath),
  });
}

function safeError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof RetirementGateError) {
    return Object.freeze({
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  return Object.freeze({
    name: error instanceof Error ? error.name : "Error",
    code: "unclassified-error",
    message:
      error instanceof Error
        ? error.message
        : "Retirement controller failed without an Error object.",
  });
}

export interface RetirementCliDependencies {
  readonly provider?: RetirementProvider;
}

export async function runRetirementCli(
  argv: readonly string[],
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
  dependencies: RetirementCliDependencies = {},
): Promise<number> {
  try {
    const options = parseArguments(argv);
    const loaded = await loadRetirementManifest({
      manifestPath: options.manifestPath,
      digestPath: options.manifestDigestPath,
    });
    const evidence = await loadRetirementReceiptBundle(
      options.receiptsPath,
      options.receiptsDigestPath,
      loaded.digest,
    );
    const provider: RetirementProvider | undefined =
      dependencies.provider ??
      (options.execute
        ? new VercelRetirementProvider({
            protectedHosts: loaded.manifest.protectedDomains.map(
              (domain) => domain.host,
            ),
          })
        : undefined);
    const controller = new RetirementController({
      loaded,
      evidence,
      ledgerStore: new AtomicRetirementLedgerStore(options.ledgerPath),
      provider,
    });
    const result =
      options.command === "status"
        ? await controller.status()
        : options.command === "check"
          ? await controller.check()
          : options.command === "soft-retire"
            ? await controller.softRetire(options.execute)
            : await controller.deleteProviderResources(options.execute);
    write(JSON.stringify({ ok: result.evaluation.ok, result }, null, 2));
    return result.evaluation.ok ? 0 : 1;
  } catch (error) {
    write(JSON.stringify({ ok: false, error: safeError(error) }, null, 2));
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  process.exitCode = await runRetirementCli(process.argv.slice(2));
}
