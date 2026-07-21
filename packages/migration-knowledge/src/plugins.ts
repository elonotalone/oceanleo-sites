import { createPendingPluginBatch } from "@oceanleo/plugin-runtime";

export const KNOWLEDGE_PLUGIN_BATCH = createPendingPluginBatch({
  id: "knowledge",
  migrationBatch: 3,
  profile: "standard",
  ownerPath: "packages/migration-knowledge",
  tenants: [
    { siteKey: "bizdev", extensionId: "business-development-workbench" },
    { siteKey: "meeting", extensionId: "meeting-workbench" },
    { siteKey: "paper", extensionId: "paper-workbench" },
    { siteKey: "law", extensionId: "law-workbench" },
    { siteKey: "study", extensionId: "study-workbench" },
    { siteKey: "edu", extensionId: "education-workbench" },
  ],
});
