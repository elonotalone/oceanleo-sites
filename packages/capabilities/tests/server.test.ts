import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityDeniedError,
  assertCapability,
  resolveSecretReference,
  secretReferencesForTenant,
  type SecretReferenceId,
} from "../src/server";
import {
  tenantForSiteKey,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

function tenant(siteKey: string): TenantDefinition {
  const resolved = tenantForSiteKey(siteKey);
  if (!resolved) throw new Error(`Missing test tenant ${siteKey}.`);
  return resolved;
}

function unreadEnvironment(): Readonly<Record<string, string | undefined>> {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Environment was read before authority checks passed.");
      },
    },
  );
}

test("secret references expose only frozen internal IDs", () => {
  const website = tenant("website");
  const references = secretReferencesForTenant(website);

  assert.deepEqual(
    references.map(({ id }) => id),
    [
      "website.github-token",
      "website.vercel-token",
      "website.cloudflare-token",
      "website.supabase-management-token",
      "website.server-ssh-key",
      "website.railway-token",
      "website.aliyun-access-key-id",
      "website.aliyun-access-key-secret",
    ],
  );
  assert.equal(Object.isFrozen(references), true);
  for (const reference of references) {
    assert.equal(Object.isFrozen(reference), true);
    assert.deepEqual(Object.keys(reference), ["id"]);
  }
  assert.deepEqual(secretReferencesForTenant(tenant("agent")), []);
});

test("trusted tenant and internal ID resolve the immutable environment name", () => {
  const reads: PropertyKey[] = [];
  const environment = new Proxy(
    { WEBSITE_VERCEL_TOKEN: "fixture-token" },
    {
      get(target, property, receiver) {
        reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    },
  );

  assert.equal(
    resolveSecretReference(
      tenant("website"),
      "website.vercel-token",
      environment,
    ),
    "fixture-token",
  );
  assert.deepEqual(reads, ["WEBSITE_VERCEL_TOKEN"]);
});

test("forged references and unknown IDs fail before environment access", () => {
  const website = tenant("website");
  const forgedReference = Object.freeze({
    id: "website.vercel-token",
    envName: "NEXT_PUBLIC_FORGED_TOKEN",
    profile: "website-privileged",
    capability: "website:deploy",
  });

  assert.throws(
    () =>
      resolveSecretReference(
        website,
        forgedReference as unknown as SecretReferenceId,
        unreadEnvironment(),
      ),
    CapabilityDeniedError,
  );
  assert.throws(
    () =>
      resolveSecretReference(
        website,
        "website.unknown-token" as SecretReferenceId,
        unreadEnvironment(),
      ),
    CapabilityDeniedError,
  );
});

test("untrusted tenants and wrong tenant profiles fail before environment access", () => {
  const website = tenant("website");
  const forgedTenant = Object.freeze({ ...website }) as TenantDefinition;

  assert.throws(
    () =>
      resolveSecretReference(
        forgedTenant,
        "website.vercel-token",
        unreadEnvironment(),
      ),
    CapabilityDeniedError,
  );
  assert.throws(
    () =>
      resolveSecretReference(
        tenant("agent"),
        "website.vercel-token",
        unreadEnvironment(),
      ),
    CapabilityDeniedError,
  );
  assert.throws(
    () => assertCapability(tenant("agent"), "website:deploy"),
    CapabilityDeniedError,
  );
});

test("public names and absent values cannot satisfy a secret reference", () => {
  const reads: PropertyKey[] = [];
  const publicOnlyEnvironment = new Proxy(
    { NEXT_PUBLIC_WEBSITE_VERCEL_TOKEN: "public-value" },
    {
      get(target, property, receiver) {
        reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    },
  );

  assert.throws(
    () =>
      resolveSecretReference(
        tenant("website"),
        "website.vercel-token",
        publicOnlyEnvironment,
      ),
    /unresolved/,
  );
  assert.deepEqual(reads, ["WEBSITE_VERCEL_TOKEN"]);
  assert.throws(
    () =>
      resolveSecretReference(tenant("website"), "website.vercel-token", {
        WEBSITE_VERCEL_TOKEN: "",
      }),
    /unresolved/,
  );
});

test("the legacy object-plus-profile resolver shape has no authority", () => {
  const reference = secretReferencesForTenant(tenant("website"))[0];
  assert.ok(reference);

  assert.throws(
    () =>
      resolveSecretReference(
        reference as unknown as TenantDefinition,
        "website-privileged" as SecretReferenceId,
        { WEBSITE_GITHUB_TOKEN: "fixture-token" },
      ),
    CapabilityDeniedError,
  );
});
