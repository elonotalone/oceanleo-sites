import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginParityStatus,
  type PluginRouteDeclaration,
  type TenantPluginDefinition,
} from "@oceanleo/plugin-runtime";

import { OFFICE_PLUGIN_BATCH } from "./plugins";

function extensionStatus(
  plugin: TenantPluginDefinition,
): PluginParityStatus {
  // Match inventory/gates.ts extensionParity: any pending wins over partial.
  if (plugin.routes.some((route) => route.parity.status === "pending")) {
    return "pending";
  }
  if (plugin.routes.some((route) => route.parity.status === "partial")) {
    return "partial";
  }
  if (plugin.routes.some((route) => route.parity.status === "verified")) {
    return "verified";
  }
  return "retired";
}

function extensionEntry(
  plugin: TenantPluginDefinition,
): BatchInventoryEntry {
  return {
    id: `plugin:standard:${plugin.siteKey}:${plugin.id}`,
    tenantKey: plugin.siteKey,
    route: null,
    kind: "plugin-extension",
    methods: [],
    capabilities: [
      ...new Set(plugin.routes.map((route) => route.capability)),
    ].sort(),
    extensionId: plugin.id,
    parity: {
      status: extensionStatus(plugin),
      source: `legacy:${plugin.siteKey}`,
      evidence: ["packages/migration-office/tests/office.test.ts"],
    },
  };
}

function routeSurfaces(
  route: PluginRouteDeclaration,
): readonly ("api" | "page")[] {
  const surfaces: ("api" | "page")[] = [];
  if (
    (route.surface === "page" || route.surface === "both") &&
    (route.kind === "page" || route.kind === "redirect")
  ) {
    surfaces.push("page");
  }
  if (
    (route.surface === "api" || route.surface === "both") &&
    route.kind !== "page"
  ) {
    surfaces.push("api");
  }
  return surfaces;
}

function routeEntries(
  plugin: TenantPluginDefinition,
): BatchInventoryEntry[] {
  return plugin.routes.flatMap((route) => {
    const surfaces = routeSurfaces(route);
    return surfaces.map((surface) => ({
      id:
        surfaces.length > 1
          ? `route:standard:${plugin.siteKey}:${route.id}:${surface}`
          : `route:standard:${plugin.siteKey}:${route.id}`,
      tenantKey: plugin.siteKey,
      route: route.pattern,
      // Gate projection: concrete page routes → page; API surface and wildcard
      // method redirects → route-handler (schema forbids "*" on kind page).
      kind:
        surface === "page" && !route.methods.includes("*")
          ? "page"
          : "route-handler",
      methods: route.methods,
      capabilities: [route.capability],
      extensionId: plugin.id,
      parity: route.parity,
    }));
  });
}

export const OFFICE_INVENTORY = defineBatchInventory({
  batchId: OFFICE_PLUGIN_BATCH.id,
  migrationBatch: OFFICE_PLUGIN_BATCH.migrationBatch,
  profile: OFFICE_PLUGIN_BATCH.profile,
  ownerPath: OFFICE_PLUGIN_BATCH.ownerPath,
  testPath: "packages/migration-office/tests/office.test.ts",
  tenantKeys: OFFICE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
  entries: OFFICE_PLUGIN_BATCH.plugins.flatMap((plugin) => [
    extensionEntry(plugin),
    ...routeEntries(plugin),
  ]),
});
