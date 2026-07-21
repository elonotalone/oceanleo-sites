import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import { MEDIA_PLUGIN_BATCH } from "./plugins";

const TEST_EVIDENCE = "packages/migration-media/tests/media.test.ts";

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

function extensionStatus(
  routes: readonly PluginRouteDeclaration[],
): BatchInventoryEntry["parity"]["status"] {
  if (routes.some((route) => route.parity.status === "pending")) {
    return "pending";
  }
  if (routes.some((route) => route.parity.status === "partial")) {
    return "partial";
  }
  if (routes.some((route) => route.parity.status === "verified")) {
    return "verified";
  }
  return "retired";
}

const pluginEntries: readonly BatchInventoryEntry[] =
  MEDIA_PLUGIN_BATCH.plugins.map((plugin) => ({
    id: `plugin:standard:${plugin.siteKey}:${plugin.id}`,
    tenantKey: plugin.siteKey,
    route: null,
    kind: "plugin-extension",
    methods: [],
    capabilities: [...new Set(plugin.routes.map((route) => route.capability))],
    extensionId: plugin.id,
    parity: {
      status: extensionStatus(plugin.routes),
      source: `legacy:${plugin.siteKey}`,
      evidence: [TEST_EVIDENCE],
    },
  }));

const routeEntries: readonly BatchInventoryEntry[] =
  MEDIA_PLUGIN_BATCH.plugins.flatMap((plugin) =>
    plugin.routes.flatMap((route) => {
      const surfaces = routeSurfaces(route);
      return surfaces.map(
        (surface): BatchInventoryEntry => ({
          id:
            surfaces.length > 1
              ? `route:standard:${plugin.siteKey}:${route.id}:${surface}`
              : `route:standard:${plugin.siteKey}:${route.id}`,
          tenantKey: plugin.siteKey,
          route: route.pattern,
          kind:
            surface === "page" && !route.methods.includes("*")
              ? "page"
              : "route-handler",
          methods: route.methods,
          capabilities: [route.capability],
          extensionId: plugin.id,
          parity: route.parity,
        }),
      );
    }),
  );

export const MEDIA_INVENTORY = defineBatchInventory({
  batchId: MEDIA_PLUGIN_BATCH.id,
  migrationBatch: MEDIA_PLUGIN_BATCH.migrationBatch,
  profile: MEDIA_PLUGIN_BATCH.profile,
  ownerPath: MEDIA_PLUGIN_BATCH.ownerPath,
  testPath: "packages/migration-media/tests/media.test.ts",
  tenantKeys: MEDIA_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
  entries: [...pluginEntries, ...routeEntries],
});
