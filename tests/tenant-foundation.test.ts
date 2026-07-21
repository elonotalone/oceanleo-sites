import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityDeniedError,
  CapabilityEscalationError,
  capabilitiesForTenant,
  resolveSecretReference,
  secretReferencesForTenant,
} from "@oceanleo/capabilities/server";
import {
  TENANTS,
  normalizeHostHeader,
  resolveTenantRequest,
  tenantForSiteKey,
} from "@oceanleo/tenant-registry";
import {
  tenantAnalyticsContext,
  tenantCacheKey,
  tenantCacheTag,
  tenantCanonicalUrl,
  tenantCookieName,
  tenantCookieOptions,
  tenantCorsHeaders,
  tenantHealthResult,
  tenantResponseHeaders,
  tenantRobotsText,
  tenantSitemap,
} from "@oceanleo/runtime";

const expectedAliases = new Map([
  ["myselfie.oceanleo.com", "image"],
  ["ppt.oceanleo.com", "ppt"],
  ["remove.oceanleo.com", "image"],
  ["skill.oceanleo.com", "agent"],
  ["studio.oceanleo.com", "video"],
  ["threed.oceanleo.com", "threed"],
]);

function tenant(siteKey: string) {
  const value = tenantForSiteKey(siteKey);
  assert.ok(value, `missing tenant ${siteKey}`);
  return value;
}

test("all canonical and alias hosts resolve through the exact allowlist", () => {
  assert.equal(TENANTS.length, 31);
  assert.equal(
    TENANTS.reduce((total, current) => total + current.domains.length, 0),
    37,
  );
  const aliases = TENANTS.flatMap((current) =>
    current.domains
      .filter((domain) => domain.kind === "alias")
      .map((domain) => [domain.host, current.manifest.siteKey] as const),
  );
  assert.deepEqual(new Map(aliases), expectedAliases);

  for (const current of TENANTS) {
    for (const domain of current.domains) {
      const resolved = resolveTenantRequest(domain.host, current.profile);
      assert.equal(resolved.ok, true, domain.host);
      if (resolved.ok) {
        assert.equal(resolved.tenant.manifest.siteKey, current.manifest.siteKey);
        assert.equal(resolved.matchedDomain.kind, domain.kind);
      }
    }
  }
});

test("unknown and malicious Host values fail closed", () => {
  const malformed = [
    null,
    "",
    "agent.oceanleo.com@attacker.invalid",
    "agent.oceanleo.com,website.oceanleo.com",
    "agent.oceanleo.com/path",
    "agent.oceanleo.com.",
    " agent.oceanleo.com",
    "agent..oceanleo.com",
    "agent.oceanleo.com:0",
    "agent.oceanleo.com:65536",
    "agent.oceanleo.com\nx-forwarded-host: website.oceanleo.com",
    "[::1]",
  ];
  for (const host of malformed) {
    assert.equal(normalizeHostHeader(host), null, String(host));
    const result = resolveTenantRequest(host, "standard");
    assert.deepEqual(result, {
      ok: false,
      status: 404,
      reason: "unknown-host",
      host: null,
    });
  }
  for (const host of [
    "unknown.oceanleo.com",
    "agent.oceanleo.com.attacker.invalid",
  ]) {
    assert.equal(normalizeHostHeader(host), host);
    assert.deepEqual(resolveTenantRequest(host, "standard"), {
      ok: false,
      status: 404,
      reason: "unknown-host",
      host,
    });
  }

  const normalized = resolveTenantRequest("AGENT.OCEANLEO.COM:443", "standard");
  assert.equal(normalized.ok, true);
  if (normalized.ok) assert.equal(normalized.host, "agent.oceanleo.com");
});

test("known hosts sent to the wrong app profile return 421", () => {
  assert.deepEqual(resolveTenantRequest("website.oceanleo.com", "standard"), {
    ok: false,
    status: 421,
    reason: "profile-mismatch",
    host: "website.oceanleo.com",
  });
  assert.deepEqual(
    resolveTenantRequest("agent.oceanleo.com", "website-privileged"),
    {
      ok: false,
      status: 421,
      reason: "profile-mismatch",
      host: "agent.oceanleo.com",
    },
  );
  assert.equal(
    tenantHealthResult("website.oceanleo.com", "website-privileged").ok,
    true,
  );
  assert.equal(tenantHealthResult("website.oceanleo.com", "standard").ok, false);
});

test("manifests cannot self-grant trusted capabilities", () => {
  const agent = tenant("agent");
  const website = tenant("website");
  assert.ok(capabilitiesForTenant(agent).includes("website:launch"));
  assert.ok(!capabilitiesForTenant(agent).includes("website:deploy"));
  assert.ok(capabilitiesForTenant(website).includes("website:deploy"));

  const topLevelClaim = {
    ...agent.manifest,
    capabilities: ["website:deploy"],
  } as unknown as typeof agent.manifest;
  assert.throws(
    () => capabilitiesForTenant(agent, topLevelClaim),
    CapabilityEscalationError,
  );

  const contextClaim = {
    ...agent.manifest,
    appContext: {
      ...agent.manifest.appContext,
      permissions: ["website:deploy"],
    },
  } as unknown as typeof agent.manifest;
  assert.throws(
    () => capabilitiesForTenant(agent, contextClaim),
    CapabilityEscalationError,
  );
  assert.throws(
    () => capabilitiesForTenant(agent, website.manifest),
    CapabilityEscalationError,
  );
});

test("secret references are privileged, server-only names", () => {
  const agent = tenant("agent");
  const website = tenant("website");
  assert.deepEqual(secretReferencesForTenant(agent), []);
  const references = secretReferencesForTenant(website);
  assert.equal(references.length, 8);
  assert.ok(references.every((reference) => !reference.envName.startsWith("NEXT_PUBLIC_")));
  assert.ok(
    JSON.stringify(TENANTS).includes("WEBSITE_VERCEL_TOKEN") === false,
    "tenant manifests must not contain secret references",
  );

  const reference = references.find(
    (candidate) => candidate.id === "website.vercel-token",
  );
  assert.ok(reference);
  const fixtureEnvironment = { [reference.envName]: "fixture" };
  assert.equal(
    resolveSecretReference(
      reference,
      "website-privileged",
      fixtureEnvironment,
    ),
    "fixture",
  );
  assert.throws(
    () =>
      resolveSecretReference(reference, "standard", fixtureEnvironment),
    CapabilityDeniedError,
  );
});

test("cookie, cache, CORS, canonical, analytics, robots, and sitemap isolate tenants", () => {
  const agent = tenant("agent");
  const image = tenant("image");

  assert.notEqual(
    tenantCookieName(agent, "session"),
    tenantCookieName(image, "session"),
  );
  assert.deepEqual(tenantCookieOptions(), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  assert.equal("domain" in tenantCookieOptions(), false);

  assert.notEqual(
    tenantCacheKey(agent, "artifact", "one"),
    tenantCacheKey(image, "artifact", "one"),
  );
  assert.notEqual(
    tenantCacheKey(agent, "a|1:b"),
    tenantCacheKey(agent, "a", "1:b"),
  );
  assert.equal(tenantCacheTag(agent, "shell"), "tenant:agent:shell");
  assert.equal(tenantResponseHeaders("no-store").Vary, "Host");

  assert.deepEqual(
    tenantCorsHeaders(image, "https://remove.oceanleo.com"),
    {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": "https://remove.oceanleo.com",
      Vary: "Host, Origin",
    },
  );
  assert.equal(
    tenantCorsHeaders(image, "https://agent.oceanleo.com"),
    null,
  );
  assert.equal(
    tenantCorsHeaders(image, "https://image.oceanleo.com/path"),
    null,
  );

  assert.equal(
    tenantCanonicalUrl(image, "/workspace?fn=selfie"),
    "https://image.oceanleo.com/workspace?fn=selfie",
  );
  assert.deepEqual(tenantAnalyticsContext(image), {
    siteKey: "image",
    canonicalHost: "image.oceanleo.com",
    profile: "standard",
  });
  assert.match(
    tenantRobotsText(image),
    /Sitemap: https:\/\/image\.oceanleo\.com\/sitemap\.xml/,
  );
  assert.ok(
    tenantSitemap(image).every((entry) =>
      entry.url.startsWith("https://image.oceanleo.com/"),
    ),
  );
});
