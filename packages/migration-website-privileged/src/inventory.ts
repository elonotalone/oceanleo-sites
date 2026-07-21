import {
  createPendingBatchInventory,
  type BatchInventoryEntry,
} from "@oceanleo/plugin-runtime";

import {
  WEBSITE_HANDLER_PATHS,
  websiteHandlerCapability,
} from "./handlers";
import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "./plugins";

const handlerInventory = WEBSITE_HANDLER_PATHS.map(
  (route): BatchInventoryEntry => ({
    id: `legacy:website-privileged:website:${route}`,
    tenantKey: "website",
    route,
    kind: "route-handler",
    methods: ["UNMIGRATED"],
    capabilities: [websiteHandlerCapability(route)],
    extensionId: "website-source-workbench",
    parity: {
      status: "pending",
      source: `website:front/app${route}/route.ts`,
      evidence: [],
    },
  }),
);

export const WEBSITE_PRIVILEGED_INVENTORY = createPendingBatchInventory({
  batch: WEBSITE_PRIVILEGED_PLUGIN_BATCH,
  testPath:
    "packages/migration-website-privileged/tests/website-privileged.test.ts",
  extraEntries: handlerInventory,
});
