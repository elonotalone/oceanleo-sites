import { createPendingPluginBatch } from "@oceanleo/plugin-runtime";

export const OFFICE_PLUGIN_BATCH = createPendingPluginBatch({
  id: "office",
  migrationBatch: 1,
  profile: "standard",
  ownerPath: "packages/migration-office",
  tenants: [
    {
      siteKey: "ppt",
      extensionId: "presentation-workbench",
      aliases: [
        {
          sourceHost: "ppt.oceanleo.com",
          destinationHost: "slide.oceanleo.com",
        },
      ],
    },
    { siteKey: "excel", extensionId: "spreadsheet-workbench" },
    { siteKey: "word", extensionId: "document-workbench" },
    { siteKey: "converter", extensionId: "conversion-workbench" },
    { siteKey: "resume", extensionId: "resume-workbench" },
  ],
});
