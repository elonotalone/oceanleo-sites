import { readFile } from "node:fs/promises";

import {
  EnvironmentSyncError,
  loadEnvironmentMapping,
  synchronizeEnvironment,
} from "../deploy/environment";
import {
  loadCutoverManifest,
  reviewManifestAgainstSitesTsv,
} from "../deploy/manifest";
import { VercelOpsProvider } from "../deploy/provider";
import type { AppProfile, ProjectInfo } from "../deploy/types";

const profiles: readonly AppProfile[] = [
  "standard",
  "website-privileged",
];

async function review(): Promise<Readonly<Record<string, unknown>>> {
  const loaded = await loadCutoverManifest();
  const sitesTsv = await readFile(
    loaded.manifest.discovery.sitesTsv,
    "utf8",
  );
  const inventory = reviewManifestAgainstSitesTsv(loaded, sitesTsv);
  const provider = new VercelOpsProvider();
  const observedHosts = new Set<string>();

  for (const legacy of loaded.manifest.legacyProjects) {
    const project = await provider.getProject(legacy.projectId);
    if (
      !project ||
      project.id !== legacy.projectId ||
      project.name !== legacy.projectName ||
      project.link?.repo !== legacy.repository
    ) {
      throw new Error(
        `Legacy project identity drift for site key ${legacy.siteKey}.`,
      );
    }
    const expected = loaded.domains
      .filter((domain) => domain.siteKey === legacy.siteKey)
      .sort((left, right) => left.host.localeCompare(right.host));
    const observed = (await provider.listProjectDomains(project.id))
      .filter((domain) => domain.host.endsWith(".oceanleo.com"))
      .sort((left, right) => left.host.localeCompare(right.host));
    for (const domain of observed) {
        if (!domain.verified) {
          throw new Error(`Unverified legacy domain ${domain.host}.`);
        }
        if (observedHosts.has(domain.host)) {
          throw new Error(`Duplicate legacy owner for ${domain.host}.`);
        }
        observedHosts.add(domain.host);
    }
    if (
      expected.length !== observed.length ||
      expected.some((domain, index) => {
        const current = observed[index];
        return (
          !current ||
          domain.host !== current.host ||
          domain.rollbackConfiguration.gitBranch !== current.gitBranch ||
          domain.rollbackConfiguration.redirect !== current.redirect ||
          domain.rollbackConfiguration.redirectStatusCode !==
            current.redirectStatusCode
        );
      })
    ) {
      throw new Error(`Legacy domain ownership drift for ${legacy.siteKey}.`);
    }
  }

  if (observedHosts.size !== 37) {
    throw new Error(`Expected 37 legacy domains, found ${observedHosts.size}.`);
  }

  const targets: Record<string, unknown> = {};
  const targetProjects: Partial<Record<AppProfile, ProjectInfo>> = {};
  for (const profile of profiles) {
    const contract = loaded.manifest.targets[profile];
    const project = await provider.getProject(contract.projectName);
    if (!project) {
      targets[profile] = {
        exists: false,
        missingRequiredEnvironmentNames: contract.environment.required,
      };
      continue;
    }
    targetProjects[profile] = project;
    const environment = await provider.listEnvironmentKeys(project.id);
    const productionNames = new Set(
      environment
        .filter(
          (entry) =>
            entry.targets.length === 0 ||
            entry.targets.includes("production"),
        )
        .map((entry) => entry.key),
    );
    targets[profile] = {
      exists: true,
      projectId: project.id,
      missingRequiredEnvironmentNames: contract.environment.required.filter(
        (name) => !productionNames.has(name),
      ),
      forbiddenEnvironmentNamesPresent:
        contract.environment.forbidden.filter((name) =>
          productionNames.has(name),
        ),
    };
  }

  const environmentMapping = await loadEnvironmentMapping(loaded);
  let environmentReview: Readonly<Record<string, unknown>>;
  try {
    environmentReview = await synchronizeEnvironment(
      loaded,
      environmentMapping,
      provider,
      targetProjects,
      false,
    );
  } catch (error) {
    if (!(error instanceof EnvironmentSyncError)) throw error;
    environmentReview = Object.freeze({
      ready: false,
      code: error.code,
      ...error.details,
    });
  }

  return Object.freeze({
    ok: true,
    mutationAttempted: false,
    provider: loaded.manifest.discovery.provider,
    teamId: loaded.manifest.discovery.teamId,
    manifestVersion: loaded.manifest.manifestVersion,
    manifestSha256: loaded.digest,
    consumers: inventory.consumers,
    legacyProjects: loaded.manifest.legacyProjects.length,
    exactLegacyDomains: observedHosts.size,
    targets,
    environmentMapping: environmentReview,
  });
}

try {
  process.stdout.write(`${JSON.stringify(await review(), null, 2)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        mutationAttempted: false,
        error: error instanceof Error ? error.message : "Review failed.",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}
