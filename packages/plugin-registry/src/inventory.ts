import { CREATION_INVENTORY } from "@oceanleo/migration-creation/inventory";
import { CREATION_PLUGIN_BATCH } from "@oceanleo/migration-creation/plugins";
import { KNOWLEDGE_INVENTORY } from "@oceanleo/migration-knowledge/inventory";
import { KNOWLEDGE_PLUGIN_BATCH } from "@oceanleo/migration-knowledge/plugins";
import { MEDIA_INVENTORY } from "@oceanleo/migration-media/inventory";
import { MEDIA_PLUGIN_BATCH } from "@oceanleo/migration-media/plugins";
import { OFFICE_INVENTORY } from "@oceanleo/migration-office/inventory";
import { OFFICE_PLUGIN_BATCH } from "@oceanleo/migration-office/plugins";
import { PLATFORM_INVENTORY } from "@oceanleo/migration-platform/inventory";
import { PLATFORM_PLUGIN_BATCH } from "@oceanleo/migration-platform/plugins";
import { WEBSITE_PRIVILEGED_INVENTORY } from "@oceanleo/migration-website-privileged/inventory";
import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "@oceanleo/migration-website-privileged/plugins";
import type {
  BatchInventoryDeclaration,
  PluginBatchDefinition,
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

export const ALL_PLUGIN_BATCHES: readonly PluginBatchDefinition[] =
  Object.freeze([
    OFFICE_PLUGIN_BATCH,
    MEDIA_PLUGIN_BATCH,
    KNOWLEDGE_PLUGIN_BATCH,
    CREATION_PLUGIN_BATCH,
    PLATFORM_PLUGIN_BATCH,
    WEBSITE_PRIVILEGED_PLUGIN_BATCH,
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

const pluginTenantKeys = ALL_PLUGIN_BATCHES.flatMap((batch) =>
  batch.plugins.map((plugin) => plugin.siteKey),
);
const inventoryTenantKeys = ALL_BATCH_INVENTORIES.flatMap(
  (declaration) => declaration.tenantKeys,
);
if (
  ALL_PLUGIN_BATCHES.length !== EXPECTED_BATCH_IDS.length ||
  ALL_BATCH_INVENTORIES.length !== EXPECTED_BATCH_IDS.length ||
  ALL_PLUGIN_BATCHES.some(
    (batch, index) =>
      batch.id !== EXPECTED_BATCH_IDS[index] ||
      batch.migrationBatch !== index + 1 ||
      batch.profile !==
        (batch.id === "website-privileged"
          ? "website-privileged"
          : "standard"),
  ) ||
  ALL_BATCH_INVENTORIES.some(
    (declaration, index) => {
      const batch = ALL_PLUGIN_BATCHES[index];
      return (
        !batch ||
        declaration.batchId !== EXPECTED_BATCH_IDS[index] ||
        declaration.migrationBatch !== index + 1 ||
        declaration.profile !==
          (declaration.batchId === "website-privileged"
            ? "website-privileged"
            : "standard") ||
        declaration.batchId !== batch.id ||
        declaration.migrationBatch !== batch.migrationBatch ||
        declaration.profile !== batch.profile ||
        declaration.ownerPath !== batch.ownerPath ||
        [...declaration.tenantKeys].sort().join("\0") !==
          batch.plugins
            .map((plugin) => plugin.siteKey)
            .sort()
            .join("\0")
      );
    },
  )
) {
  throw new Error("Migration inventory aggregator has an invalid batch seam.");
}
if (
  new Set(pluginTenantKeys).size !== pluginTenantKeys.length ||
  new Set(inventoryTenantKeys).size !== inventoryTenantKeys.length ||
  [...pluginTenantKeys].sort().join("\0") !==
    [...inventoryTenantKeys].sort().join("\0")
) {
  throw new Error(
    "Migration plugin and inventory batches must own the same disjoint tenants.",
  );
}
