import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv from "ajv";
import { ALL_BATCH_INVENTORIES } from "@oceanleo/plugin-registry/inventory";

import {
  buildInventory,
  serializeInventory,
  type InventoryDocument,
} from "../inventory/build";

test("route and handler inventory is deterministic and schema-valid", async () => {
  const first = buildInventory();
  const second = buildInventory();
  assert.equal(serializeInventory(first), serializeInventory(second));

  const [generatedBytes, schemaBytes] = await Promise.all([
    readFile(
      new URL("../generated/route-handler-inventory.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../schemas/route-handler-inventory.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.equal(generatedBytes, serializeInventory(first));

  const generated = JSON.parse(generatedBytes) as InventoryDocument;
  const validate = new Ajv({ allErrors: true, strict: true }).compile(
    JSON.parse(schemaBytes) as object,
  );
  assert.equal(validate(generated), true, JSON.stringify(validate.errors));
});

test("inventory reports foundation and pending parity without profile leakage", () => {
  const inventory = buildInventory();
  assert.deepEqual(inventory.summary, {
    tenants: 31,
    standardTenants: 30,
    privilegedTenants: 1,
    domains: 37,
    entries: 233,
    parity: {
      foundation: 155,
      pending: 78,
      partial: 0,
      verified: 0,
      retired: 0,
    },
  });

  const ids = inventory.entries.map((entry) => entry.id);
  assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right)));
  assert.equal(new Set(ids).size, ids.length);

  const websiteLegacy = inventory.entries.filter((entry) =>
    entry.id.startsWith("legacy:website-privileged:website:"),
  );
  assert.equal(websiteLegacy.length, 47);
  assert.ok(
    websiteLegacy.every(
      (entry) =>
        entry.appProfile === "website-privileged" &&
        entry.tenantKey === "website" &&
        entry.parity.status === "pending" &&
        entry.migrationBatch === 6,
    ),
  );
  assert.equal(
    inventory.entries.some(
      (entry) =>
        entry.appProfile === "standard" &&
        (entry.tenantKey === "website" ||
          entry.capabilities.some(
            (capability) =>
              capability.startsWith("website:") &&
              capability !== "website:launch",
          )),
    ),
    false,
  );

  assert.deepEqual(
    ALL_BATCH_INVENTORIES.map((declaration) => declaration.ownerPath),
    [
      "packages/migration-office",
      "packages/migration-media",
      "packages/migration-knowledge",
      "packages/migration-creation",
      "packages/migration-platform",
      "packages/migration-website-privileged",
    ],
  );
  const websiteDeclaration = ALL_BATCH_INVENTORIES.find(
    (declaration) => declaration.batchId === "website-privileged",
  );
  assert.ok(websiteDeclaration);
  assert.equal(
    websiteDeclaration.entries.filter(
      (entry) =>
        entry.kind === "route-handler" &&
        entry.parity.status === "pending",
    ).length,
    47,
  );
});
