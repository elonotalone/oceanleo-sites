import { createPendingBatchInventory } from "@oceanleo/plugin-runtime";

import { MEDIA_PLUGIN_BATCH } from "./plugins";

export const MEDIA_INVENTORY = createPendingBatchInventory({
  batch: MEDIA_PLUGIN_BATCH,
  testPath: "packages/migration-media/tests/media.test.ts",
});
