import { readFile } from "node:fs/promises";

import Ajv from "ajv";

import {
  buildInventory,
  serializeInventory,
  type InventoryDocument,
} from "../inventory/build";

const generatedUrl = new URL(
  "../generated/route-handler-inventory.json",
  import.meta.url,
);
const schemaUrl = new URL(
  "../schemas/route-handler-inventory.schema.json",
  import.meta.url,
);
const [actualBytes, schemaBytes] = await Promise.all([
  readFile(generatedUrl, "utf8"),
  readFile(schemaUrl, "utf8"),
]);
const expected = buildInventory();
const expectedBytes = serializeInventory(expected);

if (actualBytes !== expectedBytes) {
  throw new Error(
    "Generated inventory is stale. Run pnpm inventory:generate and review the diff.",
  );
}

const document = JSON.parse(actualBytes) as InventoryDocument;
const schema = JSON.parse(schemaBytes) as object;
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
if (!validate(document)) {
  throw new Error(`Inventory schema failed: ${JSON.stringify(validate.errors)}`);
}

const statusTotal = Object.values(document.summary.parity).reduce(
  (total, count) => total + count,
  0,
);
if (
  statusTotal !== document.summary.entries ||
  document.entries.length !== document.summary.entries
) {
  throw new Error("Inventory summary does not match its entries.");
}

console.log(
  `inventory ok: ${document.summary.tenants} tenants, ${document.summary.domains} domains, ${document.summary.entries} entries`,
);
