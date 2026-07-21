import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AtomicJsonLedgerStore,
  createInitialLedger,
} from "../deploy/ledger";
import { loadCutoverManifest } from "../deploy/manifest";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

test("atomic ledger round-trips all 37 domain records with private mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oceanleo-cutover-ledger-"));
  try {
    const path = join(directory, "state", "ledger.json");
    const store = new AtomicJsonLedgerStore(path);
    const loaded = await loadCutoverManifest();
    const ledger = createInitialLedger(
      loaded,
      SOURCE_SHA,
      "2026-07-21T15:00:00.000Z",
    );

    await store.withExclusiveLock(async () => {
      await store.save(ledger);
    });

    const restored = await store.load();
    assert.deepEqual(restored, ledger);
    assert.equal(Object.keys(restored?.domains ?? {}).length, 37);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(directory, "state")), [
      "ledger.json",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
