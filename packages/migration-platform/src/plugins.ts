import { createPendingPluginBatch } from "@oceanleo/plugin-runtime";

export const PLATFORM_PLUGIN_BATCH = createPendingPluginBatch({
  id: "platform",
  migrationBatch: 5,
  profile: "standard",
  ownerPath: "packages/migration-platform",
  tenants: [
    {
      siteKey: "agent",
      extensionId: "agent-orchestration",
      aliases: [
        {
          sourceHost: "skill.oceanleo.com",
          destinationHost: "agent.oceanleo.com",
        },
      ],
    },
    { siteKey: "chat", extensionId: "multi-model-chat" },
    { siteKey: "music", extensionId: "music-workbench" },
    { siteKey: "search", extensionId: "search-workbench" },
    { siteKey: "money", extensionId: "money-workbench" },
    { siteKey: "aitools", extensionId: "ai-tools-directory" },
    { siteKey: "asset", extensionId: "asset-library" },
    { siteKey: "game", extensionId: "game-platform" },
  ],
});
