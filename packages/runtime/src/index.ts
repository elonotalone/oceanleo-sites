import {
  TENANT_REGISTRY_VERSION,
  resolveTenantRequest,
  tenantsForProfile,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

export const ROUTE_INVENTORY_SCHEMA =
  "oceanleo.route-handler-inventory.v1" as const;

function safeToken(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase stable token.`);
  }
  return value;
}

function safePath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\u0000-\u001f\\]/.test(path)
  ) {
    throw new TypeError("Canonical paths must be absolute local paths.");
  }
  return path;
}

export function tenantCookieName(
  tenant: TenantDefinition,
  purpose: string,
): string {
  return `ol_${safeToken(String(tenant.manifest.siteKey), "siteKey")}_${safeToken(
    purpose,
    "cookie purpose",
  )}`;
}

export interface TenantCookieOptions {
  readonly httpOnly: boolean;
  readonly path: "/";
  readonly sameSite: "lax";
  readonly secure: boolean;
}

export function tenantCookieOptions(): TenantCookieOptions {
  return Object.freeze({
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
}

function encodedCachePart(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError("Cache key parts cannot contain control characters.");
  }
  return `${new TextEncoder().encode(value).length}:${value}`;
}

export function tenantCacheKey(
  tenant: TenantDefinition,
  ...parts: readonly string[]
): string {
  return [
    "oceanleo",
    encodedCachePart(String(tenant.manifest.siteKey)),
    ...parts.map(encodedCachePart),
  ].join("|");
}

export function tenantCacheTag(
  tenant: TenantDefinition,
  purpose: string,
): string {
  return `tenant:${safeToken(String(tenant.manifest.siteKey), "siteKey")}:${safeToken(
    purpose,
    "cache purpose",
  )}`;
}

export function mergeVary(
  current: string | null | undefined,
  ...required: readonly string[]
): string {
  const values = new Map<string, string>();
  for (const value of [...(current ?? "").split(","), ...required]) {
    const token = value.trim();
    if (token) values.set(token.toLowerCase(), token);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b)).join(", ");
}

export function tenantResponseHeaders(
  policy: "private" | "no-store" = "private",
): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control":
      policy === "no-store"
        ? "private, no-store, max-age=0"
        : "private, max-age=0, must-revalidate",
    Vary: "Host",
  });
}

function exactTenantOrigin(
  tenant: TenantDefinition,
  value: string | null,
): string | null {
  if (!value || value !== value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    return null;
  }
  return tenant.domains.some((domain) => domain.host === parsed.hostname)
    ? parsed.origin
    : null;
}

export function tenantCorsHeaders(
  tenant: TenantDefinition,
  requestOrigin: string | null,
): Readonly<Record<string, string>> | null {
  const origin = exactTenantOrigin(tenant, requestOrigin);
  if (!origin) return null;
  return Object.freeze({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    Vary: mergeVary(null, "Host", "Origin"),
  });
}

export function tenantCanonicalUrl(
  tenant: TenantDefinition,
  path = "/",
): string {
  return new URL(safePath(path), `https://${tenant.canonicalHost}`).toString();
}

export interface TenantAnalyticsContext {
  readonly siteKey: string;
  readonly canonicalHost: string;
  readonly profile: AppProfile;
}

export function tenantAnalyticsContext(
  tenant: TenantDefinition,
): TenantAnalyticsContext {
  return Object.freeze({
    siteKey: String(tenant.manifest.siteKey),
    canonicalHost: tenant.canonicalHost,
    profile: tenant.profile,
  });
}

export function tenantRobotsText(tenant: TenantDefinition): string {
  return [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${tenantCanonicalUrl(tenant, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

export interface TenantSitemapEntry {
  readonly url: string;
  readonly changeFrequency: "weekly";
  readonly priority: number;
}

export function tenantSitemap(
  tenant: TenantDefinition,
): readonly TenantSitemapEntry[] {
  return Object.freeze([
    Object.freeze({
      url: tenantCanonicalUrl(tenant),
      changeFrequency: "weekly" as const,
      priority: 1,
    }),
    Object.freeze({
      url: tenantCanonicalUrl(
        tenant,
        tenant.manifest.workspace.canonicalBasePath,
      ),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }),
  ]);
}

export type TenantHealthResult =
  | Readonly<{
      ok: true;
      appProfile: AppProfile;
      registryVersion: typeof TENANT_REGISTRY_VERSION;
      inventorySchema: typeof ROUTE_INVENTORY_SCHEMA;
      tenantCount: number;
      siteKey: string;
      canonicalHost: string;
      matchedHost: string;
      matchedDomainKind: "canonical" | "alias";
    }>
  | Readonly<{
      ok: false;
      status: 404 | 421;
      error: "unknown-host" | "profile-mismatch";
    }>;

export function tenantHealthResult(
  hostHeader: string | null,
  profile: AppProfile,
): TenantHealthResult {
  const resolution = resolveTenantRequest(hostHeader, profile);
  if (!resolution.ok) {
    return Object.freeze({
      ok: false,
      status: resolution.status,
      error: resolution.reason,
    });
  }
  return Object.freeze({
    ok: true,
    appProfile: profile,
    registryVersion: TENANT_REGISTRY_VERSION,
    inventorySchema: ROUTE_INVENTORY_SCHEMA,
    tenantCount: tenantsForProfile(profile).length,
    siteKey: String(resolution.tenant.manifest.siteKey),
    canonicalHost: resolution.tenant.canonicalHost,
    matchedHost: resolution.host,
    matchedDomainKind: resolution.matchedDomain.kind,
  });
}
