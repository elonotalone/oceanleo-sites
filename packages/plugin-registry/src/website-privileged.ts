import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "@oceanleo/migration-website-privileged/plugins";
import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";

export const WEBSITE_PRIVILEGED_PLUGIN_BATCHES = Object.freeze([
  WEBSITE_PRIVILEGED_PLUGIN_BATCH,
]);

export const websitePrivilegedPluginDispatcher = createPluginDispatcher(
  "website-privileged",
  WEBSITE_PRIVILEGED_PLUGIN_BATCHES,
);
