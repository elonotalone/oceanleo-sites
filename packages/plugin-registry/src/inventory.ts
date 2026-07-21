import { CREATION_INVENTORY } from "@oceanleo/migration-creation/inventory";
import { KNOWLEDGE_INVENTORY } from "@oceanleo/migration-knowledge/inventory";
import { MEDIA_INVENTORY } from "@oceanleo/migration-media/inventory";
import { OFFICE_INVENTORY } from "@oceanleo/migration-office/inventory";
import { PLATFORM_INVENTORY } from "@oceanleo/migration-platform/inventory";
import { WEBSITE_PRIVILEGED_INVENTORY } from "@oceanleo/migration-website-privileged/inventory";
import type {
  BatchInventoryDeclaration,
  PluginBatchId,
} from "@oceanleo/plugin-runtime";

const EXPECTED_BATCH_IDS: readonly PluginBatchId[] = Object.freeze([
  "office",
  "media",
  "knowledge",
  "creation",
  "platform",
  "website-privileged",
]);

export const ALL_BATCH_INVENTORIES: readonly BatchInventoryDeclaration[] =
  Object.freeze([
    OFFICE_INVENTORY,
    MEDIA_INVENTORY,
    KNOWLEDGE_INVENTORY,
    CREATION_INVENTORY,
    PLATFORM_INVENTORY,
    WEBSITE_PRIVILEGED_INVENTORY,
  ]);

const tenantKeys = ALL_BATCH_INVENTORIES.flatMap(
  (declaration) => declaration.tenantKeys,
);
if (
  ALL_BATCH_INVENTORIES.some(
    (declaration, index) =>
      declaration.batchId !== EXPECTED_BATCH_IDS[index] ||
      declaration.migrationBatch !== index + 1 ||
      declaration.profile !==
        (declaration.batchId === "website-privileged"
          ? "website-privileged"
          : "standard"),
  )
) {
  throw new Error("Migration inventory aggregator has an invalid batch seam.");
}
if (tenantKeys.length !== 31 || new Set(tenantKeys).size !== 31) {
  throw new Error("Migration inventory batches must own 31 disjoint tenants.");
}

const websiteHandlers = WEBSITE_PRIVILEGED_INVENTORY.entries.filter(
  (entry) => entry.kind === "route-handler",
);
if (websiteHandlers.length !== 47) {
  throw new Error("Website privileged inventory must retain 47 handlers.");
}
