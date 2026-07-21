import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { KNOWLEDGE_INVENTORY } from "../src/inventory";
import { KNOWLEDGE_PLUGIN_BATCH } from "../src/plugins";

test("knowledge owns only its six pending tenant seams", async () => {
  assert.deepEqual(
    KNOWLEDGE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["bizdev", "meeting", "paper", "law", "study", "edu"],
  );
  assert.equal(KNOWLEDGE_INVENTORY.batchId, "knowledge");
  assert.equal(
    KNOWLEDGE_INVENTORY.ownerPath,
    "packages/migration-knowledge",
  );
  assert.ok(
    KNOWLEDGE_INVENTORY.entries.every(
      (entry) => entry.parity.status === "pending",
    ),
  );

  const tenant = tenantForSiteKey("paper");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("standard", [
    KNOWLEDGE_PLUGIN_BATCH,
  ]);
  assert.equal(
    (
      await dispatcher.dispatch({
        tenant,
        pathname: "/workspace/research",
        surface: "page",
        request: new Request("https://paper.oceanleo.com/workspace/research"),
      })
    ).kind,
    "pending",
  );
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/unowned",
      surface: "page",
      request: new Request("https://paper.oceanleo.com/unowned"),
    }),
    { kind: "not-found", status: 404 },
  );
});
