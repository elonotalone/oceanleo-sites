import { createPendingBatchInventory } from "@oceanleo/plugin-runtime";

import { CREATION_PLUGIN_BATCH } from "./plugins";

export const CREATION_INVENTORY = createPendingBatchInventory({
  batch: CREATION_PLUGIN_BATCH,
  testPath: "packages/migration-creation/tests/creation.test.ts",
});
