import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RETIRED_MARKER = resolve(REPO_ROOT, "RETIRED.md");

const MUTATING_COMMANDS = new Set([
  "create-project",
  "sync-env",
  "deploy",
  "move",
  "rollback",
  "soft-retire",
  "delete-provider-resources",
]);

/** Fail closed once RETIRED.md is present — dual-app publish is gone. */
export function assertDualAppMutationsAllowed(options: {
  readonly command: string;
  readonly execute: boolean;
}): void {
  if (!existsSync(RETIRED_MARKER)) {
    return;
  }
  if (options.execute || MUTATING_COMMANDS.has(options.command)) {
    throw new Error(
      `oceanleo-sites dual-app path is retired (${RETIRED_MARKER}). ` +
        "Production publish is independent GitHub repos → independent Vercel projects only. " +
        "See RETIRED.md and oceandino docs/architecture/oceanleo-shared-ui-change-workflow.md.",
    );
  }
}

export function retiredMarkerPath(): string {
  return RETIRED_MARKER;
}
