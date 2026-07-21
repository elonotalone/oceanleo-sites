import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ALL_BATCH_INVENTORIES } from "../src/inventory";
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

test("one inventory aggregator consumes six disjoint declaration seams", () => {
  assert.deepEqual(
    ALL_BATCH_INVENTORIES.map((declaration) => declaration.batchId),
    [
      "office",
      "media",
      "knowledge",
      "creation",
      "platform",
      "website-privileged",
    ],
  );
  assert.equal(
    new Set(
      ALL_BATCH_INVENTORIES.flatMap(
        (declaration) => declaration.tenantKeys,
      ),
    ).size,
    31,
  );
  assert.equal(
    ALL_BATCH_INVENTORIES.flatMap((declaration) => declaration.entries)
      .length,
    78,
  );
});
