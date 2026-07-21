import { CREATION_PLUGIN_BATCH } from "@oceanleo/migration-creation/plugins";
import { KNOWLEDGE_PLUGIN_BATCH } from "@oceanleo/migration-knowledge/plugins";
import { MEDIA_PLUGIN_BATCH } from "@oceanleo/migration-media/plugins";
import { OFFICE_PLUGIN_BATCH } from "@oceanleo/migration-office/plugins";
import { PLATFORM_PLUGIN_BATCH } from "@oceanleo/migration-platform/plugins";
import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";

export const STANDARD_PLUGIN_BATCHES = Object.freeze([
  OFFICE_PLUGIN_BATCH,
  MEDIA_PLUGIN_BATCH,
  KNOWLEDGE_PLUGIN_BATCH,
  CREATION_PLUGIN_BATCH,
  PLATFORM_PLUGIN_BATCH,
]);

export const standardPluginDispatcher = createPluginDispatcher(
  "standard",
  STANDARD_PLUGIN_BATCHES,
);
