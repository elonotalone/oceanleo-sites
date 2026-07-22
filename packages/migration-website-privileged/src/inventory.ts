import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginRouteDeclaration,
  type TenantPluginDefinition,
} from "@oceanleo/plugin-runtime";

import {
  WEBSITE_HANDLER_DESCRIPTORS,
  websiteHandlerCapability,
  websitePluginPattern,
} from "./handlers";
import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "./plugins";
import { WEBSITE_WORKSPACE_PARITY_EVIDENCE } from "./workspace";

const TEST_EVIDENCE =
  "packages/migration-website-privileged/tests/website-privileged.test.ts";

const pluginEntries: readonly BatchInventoryEntry[] =
  WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins.map((plugin) => {
    const statuses = plugin.routes.map((route) => route.parity.status);
    const extensionParity = statuses.includes("pending")
      ? "pending"
      : statuses.includes("partial")
        ? "partial"
        : statuses.includes("verified")
          ? "verified"
          : "retired";
    return {
      id: `plugin:website-privileged:${plugin.siteKey}:${plugin.id}`,
      tenantKey: plugin.siteKey,
      route: null,
      kind: "plugin-extension" as const,
      methods: [],
      capabilities: [
        ...new Set(plugin.routes.map((route) => route.capability)),
      ].sort(),
      extensionId: plugin.id,
      parity: {
        status: extensionParity,
        source: "legacy:website",
        evidence: [
          ...new Set([TEST_EVIDENCE, ...WEBSITE_WORKSPACE_PARITY_EVIDENCE]),
        ],
      },
    };
  });

const handlerInventory = WEBSITE_HANDLER_DESCRIPTORS.map(
  (descriptor): BatchInventoryEntry => ({
    id: `route:website-privileged:website:${descriptor.route}`,
    tenantKey: "website",
    route: websitePluginPattern(descriptor.route),
    kind: "route-handler",
    methods: descriptor.methods,
    capabilities: [websiteHandlerCapability(descriptor.route)],
    extensionId: "website-source-workbench",
    parity: descriptor.parity,
  }),
);

function pageRouteInventory(
  plugin: TenantPluginDefinition,
  route: PluginRouteDeclaration,
): BatchInventoryEntry {
  return {
    id: `route:website-privileged:${plugin.siteKey}:${route.id}`,
    tenantKey: plugin.siteKey,
    route: route.pattern,
    kind: "page",
    methods: route.methods.includes("*") ? ["GET", "HEAD"] : [...route.methods],
    capabilities: [route.capability],
    extensionId: plugin.id,
    parity: route.parity,
  };
}

const pageInventory: readonly BatchInventoryEntry[] =
  WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins.flatMap((plugin) =>
    plugin.routes
      .filter((route) => route.kind === "page" || route.kind === "redirect")
      .map((route) => pageRouteInventory(plugin, route)),
  );

export const WEBSITE_PRIVILEGED_INVENTORY = defineBatchInventory({
  batchId: WEBSITE_PRIVILEGED_PLUGIN_BATCH.id,
  migrationBatch: WEBSITE_PRIVILEGED_PLUGIN_BATCH.migrationBatch,
  profile: WEBSITE_PRIVILEGED_PLUGIN_BATCH.profile,
  ownerPath: WEBSITE_PRIVILEGED_PLUGIN_BATCH.ownerPath,
  testPath:
    "packages/migration-website-privileged/tests/website-privileged.test.ts",
  tenantKeys: WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins.map(
    (plugin) => plugin.siteKey,
  ),
  entries: [...pluginEntries, ...pageInventory, ...handlerInventory],
});
