import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { OFFICE_INVENTORY } from "../src/inventory";
import { OFFICE_PLUGIN_BATCH } from "../src/plugins";

test("office owns only its five pending tenant seams", async () => {
  assert.deepEqual(
    OFFICE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["ppt", "excel", "word", "converter", "resume"],
  );
  assert.equal(OFFICE_INVENTORY.batchId, "office");
  assert.equal(OFFICE_INVENTORY.ownerPath, "packages/migration-office");
  assert.ok(
    OFFICE_INVENTORY.entries.every(
      (entry) => entry.parity.status === "pending",
    ),
  );

  const tenant = tenantForSiteKey("ppt");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("standard", [OFFICE_PLUGIN_BATCH]);
  assert.equal(
    (
      await dispatcher.dispatch({
        tenant,
        pathname: "/workspace/deck",
        surface: "page",
        request: new Request("https://slide.oceanleo.com/workspace/deck"),
      })
    ).kind,
    "pending",
  );
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/unowned",
      surface: "page",
      request: new Request("https://slide.oceanleo.com/unowned"),
    }),
    { kind: "not-found", status: 404 },
  );
});
