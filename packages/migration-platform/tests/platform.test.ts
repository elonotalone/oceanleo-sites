import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { PLATFORM_INVENTORY } from "../src/inventory";
import { PLATFORM_PLUGIN_BATCH } from "../src/plugins";

test("platform owns only its eight pending tenant seams", async () => {
  assert.deepEqual(
    PLATFORM_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["agent", "chat", "music", "search", "money", "aitools", "asset", "game"],
  );
  assert.equal(PLATFORM_INVENTORY.batchId, "platform");
  assert.equal(PLATFORM_INVENTORY.ownerPath, "packages/migration-platform");
  assert.ok(
    PLATFORM_INVENTORY.entries.every(
      (entry) => entry.parity.status === "pending",
    ),
  );

  const tenant = tenantForSiteKey("agent");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("standard", [
    PLATFORM_PLUGIN_BATCH,
  ]);
  assert.equal(
    (
      await dispatcher.dispatch({
        tenant,
        pathname: "/workspace/session",
        surface: "page",
        request: new Request("https://agent.oceanleo.com/workspace/session"),
      })
    ).kind,
    "pending",
  );
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/unowned",
      surface: "page",
      request: new Request("https://agent.oceanleo.com/unowned"),
    }),
    { kind: "not-found", status: 404 },
  );
});
