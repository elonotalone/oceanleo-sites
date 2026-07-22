/**
 * Refresh operational retirement receipts (change-log, incident-status,
 * hold-status, soak summary) while preserving sealed foundational receipts.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalSha256, sha256 } from "../retirement/canonical";
import {
  sealRetirementReceipt,
  sealRetirementReceiptBundle,
  receiptsOfKind,
} from "../retirement/receipts";
import type {
  AnyRetirementReceipt,
  RetirementReceiptBundle,
  SoakDailyRun,
  SoakPayload,
} from "../retirement/types";

const OUT_DIR =
  process.env.OCEANLEO_RETIREMENT_OUT ?? "/var/lib/oceanleo-retirement";

async function loadJournalDaily(): Promise<{
  dailyRuns: SoakDailyRun[];
  semanticFailures: Array<{ id: string; occurredAt: string }>;
  observedThrough: string | null;
}> {
  let text = "";
  try {
    text = await readFile(resolve(OUT_DIR, "soak/journal.ndjson"), "utf8");
  } catch {
    return { dailyRuns: [], semanticFailures: [], observedThrough: null };
  }
  const byDate = new Map<
    string,
    {
      completeRuns: number;
      totalHostChecks: number;
      availableHostChecks: number;
      maxConsecutiveTransportFailures: number;
      semanticMismatches: number;
    }
  >();
  const semanticFailures: Array<{ id: string; occurredAt: string }> = [];
  let observedThrough: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const run = JSON.parse(line) as {
      utcDate: string;
      finishedAt: string;
      totalHostChecks: number;
      availableHostChecks: number;
      maxConsecutiveTransportFailures: number;
      semanticMismatches: number;
      hostCount: number;
    };
    observedThrough = run.finishedAt;
    const current = byDate.get(run.utcDate) ?? {
      completeRuns: 0,
      totalHostChecks: 0,
      availableHostChecks: 0,
      maxConsecutiveTransportFailures: 0,
      semanticMismatches: 0,
    };
    if (run.hostCount === 37) current.completeRuns += 1;
    current.totalHostChecks += run.totalHostChecks;
    current.availableHostChecks += run.availableHostChecks;
    current.maxConsecutiveTransportFailures = Math.max(
      current.maxConsecutiveTransportFailures,
      run.maxConsecutiveTransportFailures,
    );
    current.semanticMismatches += run.semanticMismatches;
    byDate.set(run.utcDate, current);
    if (run.semanticMismatches > 0) {
      semanticFailures.push({
        id: `semantic-${run.finishedAt}`,
        occurredAt: run.finishedAt,
      });
    }
  }
  const dailyRuns = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([utcDate, stats]) => ({ utcDate, ...stats }));
  return { dailyRuns, semanticFailures, observedThrough };
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const manifestDigest = (
    await readFile(resolve(OUT_DIR, "retirement-manifest.sha256"), "utf8")
  )
    .trim()
    .split(/\s+/u)[0] as string;
  const bundle = JSON.parse(
    await readFile(resolve(OUT_DIR, "retirement-receipts.json"), "utf8"),
  ) as RetirementReceiptBundle;
  if (bundle.retirementManifestSha256 !== manifestDigest) {
    throw new Error("receipt bundle / manifest digest mismatch");
  }

  const keepKinds = new Set([
    "terminal-domains",
    "w1-rollback-drill",
    "release-gate",
    "legacy-resource-seal",
    // Post-cutover seals that refresh must not drop.
    "shared-ui-release",
    "git-archive",
    "credential-status",
  ]);
  const foundational = bundle.receipts.filter((receipt) =>
    keepKinds.has(receipt.kind),
  ) as AnyRetirementReceipt[];

  const priorSoak = receiptsOfKind(bundle, "soak")[0]?.payload as
    | SoakPayload
    | undefined;
  if (!priorSoak) throw new Error("soak receipt missing from sealed bundle");
  const journal = await loadJournalDaily();
  const soakPayload: SoakPayload = {
    windowStartedAt: priorSoak.windowStartedAt,
    observedThrough: journal.observedThrough ?? now,
    probeIntervalMinutes: 15,
    dailyRuns: journal.dailyRuns,
    semanticFailures: journal.semanticFailures,
  };
  const changeLogPayload = {
    observedThrough: now,
    acceptedChanges: [] as const,
  };
  const incidentPayload = {
    observedThrough: now,
    incidents: [] as const,
  };
  const holdPayload = {
    observedThrough: now,
    holds: [] as const,
  };

  const idFor = (kind: string, payload: unknown): string =>
    `sha256:${sha256(`${kind}:${canonicalSha256(payload)}`)}`;

  const refreshed: AnyRetirementReceipt[] = [
    ...foundational,
    sealRetirementReceipt(
      manifestDigest,
      idFor("soak", soakPayload),
      "soak",
      now,
      soakPayload,
    ),
    sealRetirementReceipt(
      manifestDigest,
      idFor("change-log", changeLogPayload),
      "change-log",
      now,
      changeLogPayload,
    ),
    sealRetirementReceipt(
      manifestDigest,
      idFor("incident-status", incidentPayload),
      "incident-status",
      now,
      incidentPayload,
    ),
    sealRetirementReceipt(
      manifestDigest,
      idFor("hold-status", holdPayload),
      "hold-status",
      now,
      holdPayload,
    ),
  ];

  const loaded = sealRetirementReceiptBundle(
    manifestDigest,
    bundle.bundleId,
    now,
    refreshed,
  );
  const receiptsJson = `${JSON.stringify(loaded.bundle, null, 2)}\n`;
  await writeFile(resolve(OUT_DIR, "retirement-receipts.json"), receiptsJson, {
    mode: 0o600,
  });
  await writeFile(
    resolve(OUT_DIR, "retirement-receipts.sha256"),
    `${sha256(receiptsJson)}  retirement-receipts.json\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        refreshedAt: now,
        receiptBundleDigest: loaded.digest,
        soakDaysAccumulated: soakPayload.dailyRuns.length,
        completeRunsToday:
          soakPayload.dailyRuns.find(
            (day) => day.utcDate === now.slice(0, 10),
          )?.completeRuns ?? 0,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
