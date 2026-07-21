import { createPendingBatchInventory } from "@oceanleo/plugin-runtime";

import { KNOWLEDGE_PLUGIN_BATCH } from "./plugins";

export const KNOWLEDGE_INVENTORY = createPendingBatchInventory({
  batch: KNOWLEDGE_PLUGIN_BATCH,
  testPath: "packages/migration-knowledge/tests/knowledge.test.ts",
});
