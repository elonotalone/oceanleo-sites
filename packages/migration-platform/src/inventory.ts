import { createPendingBatchInventory } from "@oceanleo/plugin-runtime";

import { PLATFORM_PLUGIN_BATCH } from "./plugins";

export const PLATFORM_INVENTORY = createPendingBatchInventory({
  batch: PLATFORM_PLUGIN_BATCH,
  testPath: "packages/migration-platform/tests/platform.test.ts",
});
