import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildInventory, serializeInventory } from "../inventory/build";

const outputUrl = new URL("../generated/route-handler-inventory.json", import.meta.url);
const inventory = buildInventory();
await mkdir(new URL("../generated/", import.meta.url), { recursive: true });
await writeFile(outputUrl, serializeInventory(inventory), "utf8");

console.log(
  `generated ${fileURLToPath(outputUrl)} (${inventory.summary.entries} entries)`,
);
