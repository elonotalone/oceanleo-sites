import { createPendingPluginBatch } from "@oceanleo/plugin-runtime";

export const CREATION_PLUGIN_BATCH = createPendingPluginBatch({
  id: "creation",
  migrationBatch: 4,
  profile: "standard",
  ownerPath: "packages/migration-creation",
  tenants: [
    { siteKey: "ecommerce", extensionId: "ecommerce-asset-studio" },
    { siteKey: "novel", extensionId: "novel-workbench" },
    { siteKey: "script", extensionId: "script-workbench" },
    { siteKey: "design", extensionId: "design-canvas" },
    { siteKey: "make", extensionId: "custom-commerce-workbench" },
  ],
});
