/**
 * One-shot probe of all 37 protected retirement hosts.
 * Appends a run record under /var/lib/oceanleo-retirement/soak/.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR =
  process.env.OCEANLEO_RETIREMENT_OUT ?? "/var/lib/oceanleo-retirement";
const MANIFEST_PATH = resolve(OUT_DIR, "retirement-manifest.json");
const TIMEOUT_MS = 12_000;

interface ProtectedDomain {
  readonly host: string;
  readonly siteKey: string;
  readonly kind: string;
  readonly ownerProjectId: string;
}

interface HostResult {
  readonly host: string;
  readonly siteKey: string;
  readonly available: boolean;
  readonly status: number | null;
  readonly transportFailure: boolean;
  readonly semanticMismatch: boolean;
  readonly error: string | null;
  readonly tenantHeader: string | null;
  readonly profileHeader: string | null;
}

async function probeHost(domain: ProtectedDomain): Promise<HostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://${domain.host}/`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "oceanleo-retirement-soak/1.0" },
    });
    const status = response.status;
    const available = status >= 200 && status < 400;
    const tenant = response.headers.get("x-oceanleo-tenant");
    const profile = response.headers.get("x-oceanleo-app-profile");
    let semanticMismatch = false;
    if (domain.kind === "canonical" && available) {
      // Replacement topology should advertise tenant; legacy may not.
      if (tenant && tenant !== domain.siteKey) semanticMismatch = true;
    }
    return {
      host: domain.host,
      siteKey: domain.siteKey,
      available,
      status,
      transportFailure: !available,
      semanticMismatch,
      error: null,
      tenantHeader: tenant,
      profileHeader: profile,
    };
  } catch (error) {
    return {
      host: domain.host,
      siteKey: domain.siteKey,
      available: false,
      status: null,
      transportFailure: true,
      semanticMismatch: false,
      error: error instanceof Error ? error.message : String(error),
      tenantHeader: null,
      profileHeader: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function maxConsecutive(flags: readonly boolean[]): number {
  let max = 0;
  let run = 0;
  for (const flag of flags) {
    if (flag) {
      run += 1;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
  }
  return max;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
    protectedDomains: ProtectedDomain[];
    policy: { probeIntervalMinutes: number };
  };
  const startedAt = new Date().toISOString();
  const results: HostResult[] = [];
  for (const domain of manifest.protectedDomains) {
    results.push(await probeHost(domain));
  }
  const finishedAt = new Date().toISOString();
  const transportFlags = results.map((result) => result.transportFailure);
  const record = {
    startedAt,
    finishedAt,
    utcDate: startedAt.slice(0, 10),
    hostCount: results.length,
    availableHostChecks: results.filter((result) => result.available).length,
    totalHostChecks: results.length,
    maxConsecutiveTransportFailures: maxConsecutive(transportFlags),
    semanticMismatches: results.filter((result) => result.semanticMismatch)
      .length,
    results,
  };
  const soakDir = resolve(OUT_DIR, "soak");
  await mkdir(soakDir, { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(resolve(soakDir, "journal.ndjson"), line, { mode: 0o600 });
  const runId = createHash("sha256").update(line).digest("hex").slice(0, 16);
  await writeFile(
    resolve(soakDir, `run-${startedAt.replace(/[:.]/g, "-")}-${runId}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok:
          record.semanticMismatches === 0 &&
          record.maxConsecutiveTransportFailures <= 1 &&
          record.availableHostChecks === 37,
        ...record,
        results: undefined,
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
