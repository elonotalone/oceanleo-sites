import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALL_BATCH_INVENTORIES,
  ALL_PLUGIN_BATCHES,
} from "../src/inventory";
import {
  STANDARD_PLUGIN_BATCHES,
  standardPluginDispatcher,
} from "../src/standard";
import {
  WEBSITE_PRIVILEGED_PLUGIN_BATCHES,
  websitePrivilegedPluginDispatcher,
} from "../src/website-privileged";

test("profile entrypoints have disjoint package import graphs", async () => {
  const [standardSource, privilegedSource] = await Promise.all([
    readFile(new URL("../src/standard.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/website-privileged.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(standardSource, /migration-website-privileged/);
  assert.doesNotMatch(
    privilegedSource,
    /migration-(?:office|media|knowledge|creation|platform)/,
  );

  assert.deepEqual(
    STANDARD_PLUGIN_BATCHES.map((batch) => batch.id),
    ["office", "media", "knowledge", "creation", "platform"],
  );
  assert.equal(standardPluginDispatcher.tenantKeys.length, 30);
  assert.equal(standardPluginDispatcher.tenantKeys.includes("website"), false);
  assert.deepEqual(
    WEBSITE_PRIVILEGED_PLUGIN_BATCHES.map((batch) => batch.id),
    ["website-privileged"],
  );
  assert.deepEqual(websitePrivilegedPluginDispatcher.tenantKeys, ["website"]);
});

test("one inventory aggregator follows all reviewed plugin batch outputs", () => {
  const reviewedBatchIds = [
    "office",
    "media",
    "knowledge",
    "creation",
    "platform",
    "website-privileged",
  ];
  assert.deepEqual(
    ALL_PLUGIN_BATCHES.map((batch) => batch.id),
    reviewedBatchIds,
  );
  assert.deepEqual(
    ALL_BATCH_INVENTORIES.map((declaration) => declaration.batchId),
    reviewedBatchIds,
  );

  const pluginTenants = ALL_PLUGIN_BATCHES.flatMap((batch) =>
    batch.plugins.map((plugin) => plugin.siteKey),
  );
  const inventoryTenants = ALL_BATCH_INVENTORIES.flatMap(
    (declaration) => declaration.tenantKeys,
  );
  assert.equal(new Set(pluginTenants).size, pluginTenants.length);
  assert.equal(new Set(inventoryTenants).size, inventoryTenants.length);
  assert.deepEqual([...inventoryTenants].sort(), [...pluginTenants].sort());

  for (const [index, batch] of ALL_PLUGIN_BATCHES.entries()) {
    const declaration = ALL_BATCH_INVENTORIES[index];
    assert.ok(declaration);
    assert.equal(declaration.profile, batch.profile);
    assert.equal(declaration.migrationBatch, batch.migrationBatch);
    assert.equal(declaration.ownerPath, batch.ownerPath);
    assert.deepEqual(
      [...declaration.tenantKeys].sort(),
      batch.plugins.map((plugin) => plugin.siteKey).sort(),
    );
  }
});
