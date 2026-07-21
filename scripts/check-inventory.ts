import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import {
  ALL_BATCH_INVENTORIES,
  ALL_PLUGIN_BATCHES,
} from "@oceanleo/plugin-registry/inventory";
import { TENANTS } from "@oceanleo/tenant-registry";

import {
  buildInventory,
  serializeInventory,
} from "../inventory/build";
import {
  InventoryGateError,
  inspectEvidenceFiles,
  inspectInventoryReconciliation,
  inspectInventorySummary,
  releaseParityStatus,
  type InventoryGateIssue,
} from "../inventory/gates";
import { FOUNDATION_ROUTES } from "../inventory/source";

const generatedUrl = new URL(
  "../generated/route-handler-inventory.json",
  import.meta.url,
);
const schemaUrl = new URL(
  "../schemas/route-handler-inventory.schema.json",
  import.meta.url,
);
const expected = buildInventory();
const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
const schemaValid = validate(expected);
const schemaIssues: readonly InventoryGateIssue[] = schemaValid
  ? []
  : [
      {
        code: "schema",
        message: `${validate.errors?.length ?? 0} schema violation(s): ${(validate.errors ?? [])
          .slice(0, 5)
          .map((error) => `${error.instancePath || "/"} ${error.keyword}`)
          .join(", ")}`,
      },
    ];
const reconciliation = inspectInventoryReconciliation({
  batches: ALL_PLUGIN_BATCHES,
  inventories: ALL_BATCH_INVENTORIES,
  tenants: TENANTS,
  foundationRoutes: FOUNDATION_ROUTES,
});
const evidenceIssues = await inspectEvidenceFiles(
  expected,
  fileURLToPath(new URL("../", import.meta.url)),
);
const release = releaseParityStatus(expected);
const migrationPending = expected.entries.filter(
  (entry) =>
    entry.parity.status === "pending" &&
    entry.appProfile === "standard",
).length;
const migrationIssues: readonly InventoryGateIssue[] =
  migrationPending === 0
    ? []
    : [
        {
          code: "release-parity",
          message: `standard pending=${migrationPending}; migration acceptance requires standard pending=0 (website pending and all partial remain cutover-gated).`,
        },
      ];
const gateIssues = [
  ...schemaIssues,
  ...inspectInventorySummary(expected),
  ...migrationIssues,
  ...evidenceIssues,
  ...reconciliation.issues,
];
if (gateIssues.length > 0) {
  throw new InventoryGateError("Terminal inventory acceptance", gateIssues);
}

const actualBytes = await readFile(generatedUrl, "utf8");
const expectedBytes = serializeInventory(expected);
if (actualBytes !== expectedBytes) {
  throw new Error(
    "Generated inventory is stale. Run pnpm inventory:generate and review the diff.",
  );
}

console.log(
  `inventory ok: ${expected.summary.tenants} tenants, ${expected.summary.domains} domains, ${expected.summary.entries} entries, ${reconciliation.pluginRoutes} plugin routes/${reconciliation.routeContracts} surface contracts, pending=${release.pending}, partial=${release.partial}, cutoverReady=${release.ready}`,
);
