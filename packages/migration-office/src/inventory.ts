import { createPendingBatchInventory } from "@oceanleo/plugin-runtime";

import { OFFICE_PLUGIN_BATCH } from "./plugins";

export const OFFICE_INVENTORY = createPendingBatchInventory({
  batch: OFFICE_PLUGIN_BATCH,
  testPath: "packages/migration-office/tests/office.test.ts",
});
