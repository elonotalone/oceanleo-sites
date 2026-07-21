import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { CREATION_INVENTORY } from "../src/inventory";
import { CREATION_PLUGIN_BATCH } from "../src/plugins";

test("creation owns only its five pending tenant seams", async () => {
  assert.deepEqual(
    CREATION_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["ecommerce", "novel", "script", "design", "make"],
  );
  assert.equal(CREATION_INVENTORY.batchId, "creation");
  assert.equal(CREATION_INVENTORY.ownerPath, "packages/migration-creation");
  assert.ok(
    CREATION_INVENTORY.entries.every(
      (entry) => entry.parity.status === "pending",
    ),
  );

  const tenant = tenantForSiteKey("design");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("standard", [
    CREATION_PLUGIN_BATCH,
  ]);
  assert.equal(
    (
      await dispatcher.dispatch({
        tenant,
        pathname: "/workspace/canvas",
        surface: "page",
        request: new Request("https://design.oceanleo.com/workspace/canvas"),
      })
    ).kind,
    "pending",
  );
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/unowned",
      surface: "page",
      request: new Request("https://design.oceanleo.com/unowned"),
    }),
    { kind: "not-found", status: 404 },
  );
});
