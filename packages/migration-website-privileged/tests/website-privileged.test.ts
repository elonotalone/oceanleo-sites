import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { WEBSITE_HANDLER_PATHS } from "../src/handlers";
import { WEBSITE_PRIVILEGED_INVENTORY } from "../src/inventory";
import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "../src/plugins";

test("website owns 47 pending handlers in its privileged package", async () => {
  const handlers = WEBSITE_PRIVILEGED_INVENTORY.entries.filter(
    (entry) => entry.kind === "route-handler",
  );
  assert.equal(WEBSITE_HANDLER_PATHS.length, 47);
  assert.equal(handlers.length, 47);
  assert.ok(handlers.every((entry) => entry.parity.status === "pending"));
  assert.deepEqual(WEBSITE_PRIVILEGED_INVENTORY.tenantKeys, ["website"]);
  assert.equal(
    WEBSITE_PRIVILEGED_INVENTORY.ownerPath,
    "packages/migration-website-privileged",
  );

  const tenant = tenantForSiteKey("website");
  assert.ok(tenant);
  const dispatcher = createPluginDispatcher("website-privileged", [
    WEBSITE_PRIVILEGED_PLUGIN_BATCH,
  ]);
  const pending = await dispatcher.dispatch({
    tenant,
    pathname: "/api/sites/site-7/env",
    surface: "api",
    request: new Request("https://website.oceanleo.com/api/sites/site-7/env"),
  });
  assert.equal(pending.kind, "pending");
  if (pending.kind === "pending") {
    assert.deepEqual(pending.params, { id: "site-7" });
  }
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/api/not-declared",
      surface: "api",
      request: new Request(
        "https://website.oceanleo.com/api/not-declared",
      ),
    }),
    { kind: "not-found", status: 404 },
  );
});
