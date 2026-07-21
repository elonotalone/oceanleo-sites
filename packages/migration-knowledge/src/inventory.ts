import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import { KNOWLEDGE_PLUGIN_BATCH } from "./plugins";

const TEST_PATH =
  "packages/migration-knowledge/tests/knowledge.test.ts" as const;

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

const entries: BatchInventoryEntry[] = [];
for (const plugin of KNOWLEDGE_PLUGIN_BATCH.plugins) {
  entries.push({
    id: `plugin:${KNOWLEDGE_PLUGIN_BATCH.profile}:${plugin.siteKey}:${plugin.id}`,
    tenantKey: plugin.siteKey,
    route: null,
    kind: "plugin-extension",
    methods: [],
    capabilities: [
      ...new Set(plugin.routes.map((route) => route.capability)),
    ].sort(),
    extensionId: plugin.id,
    parity: {
      status: extensionStatus(plugin.routes),
      source: `legacy:${plugin.siteKey}`,
      evidence: [TEST_PATH],
    },
  });

  for (const route of plugin.routes) {
    const surfaces = routeSurfaces(route);
    for (const surface of surfaces) {
      entries.push({
        id:
          surfaces.length > 1
            ? `route:${KNOWLEDGE_PLUGIN_BATCH.profile}:${plugin.siteKey}:${route.id}:${surface}`
            : `route:${KNOWLEDGE_PLUGIN_BATCH.profile}:${plugin.siteKey}:${route.id}`,
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
      });
    }
  }
}

export const KNOWLEDGE_INVENTORY = defineBatchInventory({
  batchId: KNOWLEDGE_PLUGIN_BATCH.id,
  migrationBatch: KNOWLEDGE_PLUGIN_BATCH.migrationBatch,
  profile: KNOWLEDGE_PLUGIN_BATCH.profile,
  ownerPath: KNOWLEDGE_PLUGIN_BATCH.ownerPath,
  tenantKeys: KNOWLEDGE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
  testPath: "packages/migration-knowledge/tests/knowledge.test.ts",
  entries,
});
