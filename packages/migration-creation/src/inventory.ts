import {
  defineBatchInventory,
  type BatchInventoryEntry,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import { CREATION_PLUGIN_BATCH } from "./plugins";
import {
  creationProtocolFor,
  type CreationSiteKey,
} from "./protocols";

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

const extensionEntries = CREATION_PLUGIN_BATCH.plugins.map(
  (plugin): BatchInventoryEntry => {
    const protocol = creationProtocolFor(plugin.siteKey as CreationSiteKey);
    return {
      id: `plugin:standard:${plugin.siteKey}:${plugin.id}`,
      tenantKey: plugin.siteKey,
      route: null,
      kind: "plugin-extension",
      methods: [],
      capabilities: Object.freeze([
        ...new Set(plugin.routes.map((route) => route.capability)),
      ]),
      extensionId: plugin.id,
      parity: {
        status: extensionStatus(plugin.routes),
        source: protocol.catalogSource,
        evidence: ["packages/migration-creation/tests/creation.test.ts"],
      },
    };
  },
);

const routeEntries = CREATION_PLUGIN_BATCH.plugins.flatMap((plugin) =>
  plugin.routes.flatMap((route) => {
    const surfaces = routeSurfaces(route);
    if (surfaces.length === 0) {
      throw new Error(
        `${route.id}: creation inventory requires an executable surface.`,
      );
    }
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

export const CREATION_INVENTORY = defineBatchInventory({
  batchId: CREATION_PLUGIN_BATCH.id,
  migrationBatch: CREATION_PLUGIN_BATCH.migrationBatch,
  profile: CREATION_PLUGIN_BATCH.profile,
  ownerPath: CREATION_PLUGIN_BATCH.ownerPath,
  testPath: "packages/migration-creation/tests/creation.test.ts",
  tenantKeys: CREATION_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
  entries: [...extensionEntries, ...routeEntries],
});
