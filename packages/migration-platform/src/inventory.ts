import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import { PLATFORM_PLUGIN_BATCH } from "./plugins";
import { PLATFORM_PARITY_EVIDENCE } from "./source-parity";

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

const extensionEntries = PLATFORM_PLUGIN_BATCH.plugins.map(
  (plugin): BatchInventoryEntry => ({
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
      status: "verified",
      source: `tenant-registry:${plugin.siteKey}:${plugin.id}`,
      evidence: PLATFORM_PARITY_EVIDENCE,
    },
  }),
);

const routeEntries = PLATFORM_PLUGIN_BATCH.plugins.flatMap((plugin) =>
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
        // Gate projection: concrete page routes → page; API surface and
        // wildcard method redirects → route-handler (schema forbids "*" on
        // kind page).
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

export const PLATFORM_INVENTORY = defineBatchInventory({
  batchId: PLATFORM_PLUGIN_BATCH.id,
  migrationBatch: PLATFORM_PLUGIN_BATCH.migrationBatch,
  profile: PLATFORM_PLUGIN_BATCH.profile,
  ownerPath: PLATFORM_PLUGIN_BATCH.ownerPath,
  testPath: "packages/migration-platform/tests/platform.test.ts",
  tenantKeys: PLATFORM_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
  entries: [...extensionEntries, ...routeEntries],
});
