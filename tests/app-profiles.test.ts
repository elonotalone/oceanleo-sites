import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { tenantHealthResult } from "@oceanleo/runtime";
import { tenantsForProfile } from "@oceanleo/tenant-registry";

import { APP_PROFILE as STANDARD_PROFILE } from "../apps/standard/profile";
import { APP_PROFILE as PRIVILEGED_PROFILE } from "../apps/website-privileged/profile";

const root = fileURLToPath(new URL("..", import.meta.url));

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", ".next", "node_modules"].includes(entry.name)) return [];
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function sourceBelow(directory: string): string {
  return filesBelow(directory)
    .filter((path) => /\.(?:json|ts|tsx)$/.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

test("the two app profiles have disjoint tenant sets and health metadata", () => {
  assert.equal(STANDARD_PROFILE, "standard");
  assert.equal(PRIVILEGED_PROFILE, "website-privileged");
  assert.equal(tenantsForProfile(STANDARD_PROFILE).length, 30);
  assert.equal(tenantsForProfile(PRIVILEGED_PROFILE).length, 1);
  assert.equal(
    tenantsForProfile(PRIVILEGED_PROFILE)[0]?.manifest.siteKey,
    "website",
  );
  assert.equal(
    tenantsForProfile(STANDARD_PROFILE).some(
      (tenant) => tenant.manifest.siteKey === "website",
    ),
    false,
  );

  assert.deepEqual(
    tenantHealthResult("agent.oceanleo.com", STANDARD_PROFILE),
    {
      ok: true,
      appProfile: "standard",
      registryVersion: "2026-07-21.1",
      inventorySchema: "oceanleo.route-handler-inventory.v1",
      tenantCount: 30,
      siteKey: "agent",
      canonicalHost: "agent.oceanleo.com",
      matchedHost: "agent.oceanleo.com",
      matchedDomainKind: "canonical",
    },
  );
  assert.deepEqual(
    tenantHealthResult("website.oceanleo.com", PRIVILEGED_PROFILE),
    {
      ok: true,
      appProfile: "website-privileged",
      registryVersion: "2026-07-21.1",
      inventorySchema: "oceanleo.route-handler-inventory.v1",
      tenantCount: 1,
      siteKey: "website",
      canonicalHost: "website.oceanleo.com",
      matchedHost: "website.oceanleo.com",
      matchedDomainKind: "canonical",
    },
  );
});

test("both Next apps expose the shared shell and secret-free metadata routes", () => {
  for (const app of ["standard", "website-privileged"]) {
    for (const relative of [
      "app/page.tsx",
      "app/api/health/route.ts",
      "app/api/tenant/route.ts",
      "app/robots.ts",
      "app/sitemap.ts",
      "proxy.ts",
    ]) {
      const path = `${root}/apps/${app}/${relative}`;
      assert.equal(existsSync(path) && statSync(path).isFile(), true, path);
    }
    assert.match(
      readFileSync(`${root}/apps/${app}/app/page.tsx`, "utf8"),
      /TenantShell/,
    );
  }

  const standardSource = sourceBelow(`${root}/apps/standard`);
  assert.doesNotMatch(standardSource, /WEBSITE_[A-Z0-9_]+/);
  assert.doesNotMatch(
    standardSource,
    /\/api\/(?:vault|servers|oauth|vercel|deploy)/,
  );
});

test("workspace pins one shared UI release and one lockfile", () => {
  const workspace = readFileSync(`${root}/pnpm-workspace.yaml`, "utf8");
  assert.match(
    workspace,
    /github:elonotalone\/oceanleo-ui#v0\.186\.0/,
  );

  for (const manifest of [
    "apps/standard/package.json",
    "apps/website-privileged/package.json",
    "packages/runtime/package.json",
    "packages/tenant-registry/package.json",
  ]) {
    const parsed = JSON.parse(
      readFileSync(`${root}/${manifest}`, "utf8"),
    ) as { dependencies?: Record<string, string> };
    assert.equal(parsed.dependencies?.["@oceanleo/ui"], "catalog:", manifest);
  }

  const lockfiles = filesBelow(root)
    .filter((path) => /(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(path))
    .map((path) => path.slice(root.length + 1));
  assert.deepEqual(lockfiles, ["pnpm-lock.yaml"]);
});
