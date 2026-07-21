import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AppProfile,
  CutoverDomain,
  CutoverManifest,
  DomainConfiguration,
  LoadedManifest,
  WaveManifest,
  WaveId,
} from "./types";

const deployDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST_PATH = resolve(
  deployDirectory,
  "cutover-manifest.json",
);
export const DEFAULT_MANIFEST_DIGEST_PATH = resolve(
  deployDirectory,
  "cutover-manifest.sha256",
);

const TEAM_ID = "team_Jk2R4jQ9GDtSbG2oOXqTRum9";
const WAVE_IDS: readonly WaveId[] = [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
];
const WAVE_DOMAIN_COUNTS = [1, 6, 10, 6, 5, 8, 1] as const;
const EMPTY_DOMAIN_CONFIGURATION: DomainConfiguration = Object.freeze({
  gitBranch: null,
  redirect: null,
  redirectStatusCode: null,
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid cutover manifest: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function assertEnvironmentNames(
  profile: AppProfile,
  required: readonly string[],
  forbidden: readonly string[],
  optional: readonly string[] = [],
): void {
  const namePattern = /^[A-Z][A-Z0-9_]*$/;
  invariant(required.length > 0, `${profile} requires no environment names`);
  for (const name of [...required, ...forbidden, ...optional]) {
    invariant(
      typeof name === "string" && namePattern.test(name),
      `${profile} has invalid environment key name`,
    );
  }
  invariant(
    new Set(required).size === required.length,
    `${profile} repeats a required environment name`,
  );
  invariant(
    new Set(forbidden).size === forbidden.length,
    `${profile} repeats a forbidden environment name`,
  );
  invariant(
    new Set(optional).size === optional.length,
    `${profile} repeats an optional environment name`,
  );
  invariant(
    required.every((name) => !forbidden.includes(name)),
    `${profile} both requires and forbids an environment name`,
  );
  invariant(
    optional.every(
      (name) => !required.includes(name) && !forbidden.includes(name),
    ),
    `${profile} optional environment name overlaps required or forbidden`,
  );
}

function validateAndFlatten(raw: unknown): {
  manifest: CutoverManifest;
  domains: readonly CutoverDomain[];
} {
  invariant(isRecord(raw), "root must be an object");
  invariant(
    raw.schemaVersion === "oceanleo.two-project-cutover.v1",
    "schemaVersion mismatch",
  );
  const manifest = raw as unknown as CutoverManifest;
  invariant(
    manifest.discovery?.teamId === TEAM_ID,
    "provider team does not match the fixed team",
  );
  invariant(
    manifest.discovery?.provider === "vercel-ops",
    "provider must be vercel-ops",
  );
  invariant(
    manifest.discovery.customDomainCount === 37 &&
      manifest.discovery.legacyProjectCount === 31,
    "discovery cardinality mismatch",
  );
  invariant(
    manifest.source?.branch === "main" &&
      manifest.source.githubRepository === "elonotalone/oceanleo-sites",
    "source repository contract mismatch",
  );

  const expectedTargets = {
    standard: {
      name: "oceanleo-sites-standard",
      root: "apps/standard",
    },
    "website-privileged": {
      name: "oceanleo-sites-website-privileged",
      root: "apps/website-privileged",
    },
  } as const;
  for (const profile of [
    "standard",
    "website-privileged",
  ] satisfies readonly AppProfile[]) {
    const target = manifest.targets?.[profile];
    invariant(target?.profile === profile, `${profile} target profile mismatch`);
    invariant(
      target.projectName === expectedTargets[profile].name &&
        target.rootDirectory === expectedTargets[profile].root,
      `${profile} target name or root mismatch`,
    );
    invariant(
      target.teamId === TEAM_ID &&
        target.framework === "nextjs" &&
        target.nodeVersion === "24.x" &&
        target.productionBranch === "main",
      `${profile} target settings mismatch`,
    );
    invariant(
      target.gitRepository.type === "github" &&
        target.gitRepository.owner === "elonotalone" &&
        target.gitRepository.repo === "oceanleo-sites",
      `${profile} Git repository mismatch`,
    );
    invariant(
      target.installCommand ===
        "cd ../.. && pnpm install --frozen-lockfile" &&
        target.buildCommand === `cd ../.. && pnpm build:${profile}`,
      `${profile} build command mismatch`,
    );
    assertEnvironmentNames(
      profile,
      target.environment.required,
      target.environment.forbidden,
      target.environment.optional ?? [],
    );
  }

  invariant(
    Array.isArray(manifest.legacyProjects) &&
      manifest.legacyProjects.length === 31,
    "expected 31 legacy projects",
  );
  const legacyBySite = new Map(
    manifest.legacyProjects.map((project) => [project.siteKey, project]),
  );
  invariant(legacyBySite.size === 31, "legacy site keys must be unique");
  invariant(
    new Set(manifest.legacyProjects.map((project) => project.projectId)).size ===
      31,
    "legacy project IDs must be unique",
  );
  for (const project of manifest.legacyProjects) {
    invariant(
      /^prj_[A-Za-z0-9]{28}$/.test(project.projectId),
      `${project.siteKey} has an invalid legacy project ID`,
    );
    invariant(
      project.projectName.length > 0 && project.repository.length > 0,
      `${project.siteKey} has incomplete legacy ownership`,
    );
  }

  invariant(
    Array.isArray(manifest.waves) && manifest.waves.length === WAVE_IDS.length,
    "expected waves W1-W7",
  );
  const waves = manifest.waves as readonly WaveManifest[];
  const hosts = new Set<string>();
  const sites = new Set<string>();
  const flattened: CutoverDomain[] = [];
  for (const [waveIndex, wave] of waves.entries()) {
    invariant(wave.id === WAVE_IDS[waveIndex], "wave order must be W1-W7");
    const waveStart = flattened.length;
    for (const tenant of wave.tenants) {
      const legacy = legacyBySite.get(tenant.siteKey);
      invariant(legacy, `${tenant.siteKey} has no legacy owner`);
      invariant(!sites.has(tenant.siteKey), `${tenant.siteKey} appears twice`);
      sites.add(tenant.siteKey);
      invariant(
        tenant.profile ===
          (tenant.siteKey === "website" ? "website-privileged" : "standard"),
        `${tenant.siteKey} has the wrong profile`,
      );
      invariant(
        tenant.specializedPath.startsWith("/"),
        `${tenant.siteKey} specialized path is not absolute`,
      );
      const canonicalIndex = tenant.domains.findIndex(
        (domain) => domain.kind === "canonical",
      );
      invariant(canonicalIndex >= 0, `${tenant.siteKey} has no canonical domain`);
      invariant(
        tenant.domains.filter((domain) => domain.kind === "canonical").length ===
          1,
        `${tenant.siteKey} must have exactly one canonical domain`,
      );
      invariant(
        tenant.domains.every(
          (domain, index) =>
            domain.kind !== "canonical" || index === canonicalIndex,
        ),
        `${tenant.siteKey} must declare its canonical domain once`,
      );
      invariant(
        tenant.domains.every(
          (domain, index) =>
            domain.kind !== "alias" || index > canonicalIndex,
        ),
        `${tenant.siteKey} aliases must follow its canonical domain`,
      );
      for (const domain of tenant.domains) {
        invariant(
          /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.oceanleo\.com$/.test(domain.host),
          `${domain.host} is not an exact OceanLeo host`,
        );
        invariant(!hosts.has(domain.host), `${domain.host} appears twice`);
        hosts.add(domain.host);
        const configuration = domain.configuration
          ? deepFreeze({ ...domain.configuration })
          : EMPTY_DOMAIN_CONFIGURATION;
        flattened.push(
          deepFreeze({
            sequence: flattened.length + 1,
            wave: wave.id,
            siteKey: tenant.siteKey,
            profile: tenant.profile,
            specializedPath: tenant.specializedPath,
            host: domain.host,
            kind: domain.kind,
            targetProjectName:
              manifest.targets[tenant.profile].projectName,
            legacyProjectName: legacy.projectName,
            legacyProjectId: legacy.projectId,
            legacyRepository: legacy.repository,
            forwardConfiguration: configuration,
            rollbackOwnerProjectId: legacy.projectId,
            rollbackConfiguration: configuration,
          }),
        );
      }
    }
    invariant(
      flattened.length - waveStart === WAVE_DOMAIN_COUNTS[waveIndex],
      `${wave.id} domain count mismatch`,
    );
  }

  invariant(sites.size === 31, "every legacy site must appear in one wave");
  invariant(
    [...legacyBySite.keys()].every((siteKey) => sites.has(siteKey)),
    "wave coverage does not match legacy projects",
  );
  invariant(hosts.size === 37, "expected exactly 37 unique domains");
  invariant(
    flattened.filter((domain) => domain.profile === "standard").length === 36 &&
      flattened.filter((domain) => domain.profile === "website-privileged")
        .length === 1,
    "target profile domain partition must be 36 + 1",
  );

  const ppt = flattened.find((domain) => domain.host === "ppt.oceanleo.com");
  invariant(
    ppt?.kind === "alias" &&
      ppt.forwardConfiguration.redirect === "slide.oceanleo.com" &&
      ppt.forwardConfiguration.redirectStatusCode === 308 &&
      ppt.rollbackConfiguration.redirect === "slide.oceanleo.com" &&
      ppt.rollbackConfiguration.redirectStatusCode === 308,
    "ppt redirect restoration contract mismatch",
  );
  invariant(
    flattened[0]?.host === "asset.oceanleo.com" &&
      flattened.at(-1)?.host === "website.oceanleo.com",
    "canary and terminal wave boundaries changed",
  );

  return {
    manifest: deepFreeze(manifest),
    domains: deepFreeze(flattened),
  };
}

export async function loadCutoverManifest(
  manifestPath = DEFAULT_MANIFEST_PATH,
  digestPath = DEFAULT_MANIFEST_DIGEST_PATH,
): Promise<LoadedManifest> {
  const [bytes, digestFile] = await Promise.all([
    readFile(manifestPath),
    readFile(digestPath, "utf8"),
  ]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expectedDigest = digestFile.trim().split(/\s+/u)[0];
  invariant(
    /^[a-f0-9]{64}$/.test(expectedDigest ?? "") && digest === expectedDigest,
    "manifest digest mismatch",
  );
  const { manifest, domains } = validateAndFlatten(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  return deepFreeze({ manifest, digest, domains });
}

export interface SitesTsvRow {
  readonly key: string;
  readonly directory: string;
  readonly frontendSubdirectory: string;
  readonly push: string;
}

export function parseSitesTsv(contents: string): readonly SitesTsvRow[] {
  const rows = contents
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .slice(1)
    .map((line) => {
      const [key, directory, frontendSubdirectory, push] = line.split("\t");
      invariant(
        Boolean(key && directory && frontendSubdirectory && push),
        "sites TSV row is incomplete",
      );
      return deepFreeze({
        key: key as string,
        directory: directory as string,
        frontendSubdirectory: frontendSubdirectory as string,
        push: push as string,
      });
    });
  invariant(rows.length === 31, "sites TSV must contain 31 consumers");
  invariant(
    new Set(rows.map((row) => row.key)).size === rows.length,
    "sites TSV keys must be unique",
  );
  return deepFreeze(rows);
}

export function reviewManifestAgainstSitesTsv(
  loaded: LoadedManifest,
  contents: string,
): Readonly<{ consumers: number; domains: number }> {
  const rows = parseSitesTsv(contents);
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  for (const project of loaded.manifest.legacyProjects) {
    const row = rowByKey.get(project.siteKey);
    invariant(row, `${project.siteKey} is absent from sites TSV`);
    invariant(
      row.directory === project.repository,
      `${project.siteKey} repository differs from sites TSV`,
    );
  }
  invariant(
    rows.every((row) =>
      loaded.manifest.legacyProjects.some(
        (project) => project.siteKey === row.key,
      ),
    ),
    "sites TSV contains an unowned consumer",
  );
  return deepFreeze({ consumers: rows.length, domains: loaded.domains.length });
}
