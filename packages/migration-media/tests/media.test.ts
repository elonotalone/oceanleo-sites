import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { MEDIA_INVENTORY } from "../src/inventory";
import { MEDIA_PLUGIN_BATCH } from "../src/plugins";

test("media owns only its six pending tenant seams", async () => {
  assert.deepEqual(
    MEDIA_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["aihuman", "image", "video", "logo", "interior", "threed"],
  );
  assert.equal(MEDIA_INVENTORY.batchId, "media");
  assert.equal(MEDIA_INVENTORY.ownerPath, "packages/migration-media");
  assert.ok(
    MEDIA_INVENTORY.entries.every(
      (entry) => entry.parity.status === "pending",
    ),
  );

  const tenant = tenantForSiteKey("image");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("standard", [MEDIA_PLUGIN_BATCH]);
  assert.equal(
    (
      await dispatcher.dispatch({
        tenant,
        pathname: "/workspace/cutout",
        surface: "page",
        request: new Request("https://image.oceanleo.com/workspace/cutout"),
      })
    ).kind,
    "pending",
  );
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/unowned",
      surface: "page",
      request: new Request("https://image.oceanleo.com/unowned"),
    }),
    { kind: "not-found", status: 404 },
  );
});
