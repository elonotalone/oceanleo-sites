import "server-only";

import { capabilitiesForTenant } from "@oceanleo/capabilities/server";
import {
  resolveTenantRequest,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";
import type { Metadata, MetadataRoute } from "next";
import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  mergeVary,
  tenantCanonicalUrl,
  tenantHealthResult,
  tenantResponseHeaders,
  tenantSitemap,
} from "./index";

export async function currentTenant(
  profile: AppProfile,
): Promise<TenantDefinition> {
  const requestHeaders = await headers();
  const resolution = resolveTenantRequest(requestHeaders.get("host"), profile);
  if (!resolution.ok) {
    const { notFound } = await import("next/navigation");
    return notFound();
  }
  return resolution.tenant;
}

export interface TenantIsolationContext {
  readonly profile: AppProfile;
  readonly tenant?: TenantDefinition;
}

const SAFE_TENANT_CACHE_CONTROL =
  tenantResponseHeaders("no-store")["Cache-Control"];

function cacheControlIsTenantSafe(value: string | null): boolean {
  if (!value) return false;
  const directives = value.split(",").map((directive) => {
    const separator = directive.indexOf("=");
    return {
      name: directive
        .slice(0, separator < 0 ? undefined : separator)
        .trim()
        .toLowerCase(),
      parameterized: separator >= 0,
    };
  });
  const hasBareDirective = (name: string) =>
    directives.some(
      (directive) => directive.name === name && !directive.parameterized,
    );
  const hasDirective = (name: string) =>
    directives.some((directive) => directive.name === name);
  return (
    (hasBareDirective("private") || hasBareDirective("no-store")) &&
    !hasDirective("public") &&
    !hasDirective("s-maxage")
  );
}

export function tenantIsolationHeaders(
  initialHeaders: HeadersInit | undefined,
  context: TenantIsolationContext,
): Headers {
  if (context.tenant && context.tenant.profile !== context.profile) {
    throw new TypeError("Tenant isolation context has mismatched profiles.");
  }

  const isolated = new Headers(initialHeaders);
  isolated.set("Vary", mergeVary(isolated.get("Vary"), "Host"));
  if (!cacheControlIsTenantSafe(isolated.get("Cache-Control"))) {
    isolated.set("Cache-Control", SAFE_TENANT_CACHE_CONTROL);
  }
  isolated.set("X-Content-Type-Options", "nosniff");
  isolated.set("X-OceanLeo-App-Profile", context.profile);
  if (context.tenant) {
    isolated.set(
      "X-OceanLeo-Tenant",
      String(context.tenant.manifest.siteKey),
    );
  } else {
    isolated.delete("X-OceanLeo-Tenant");
  }
  return isolated;
}

function applyTenantIsolation(
  response: NextResponse,
  context: TenantIsolationContext,
): NextResponse {
  const isolated = tenantIsolationHeaders(response.headers, context);
  isolated.forEach((value, name) => {
    response.headers.set(name, value);
  });
  if (!context.tenant) response.headers.delete("X-OceanLeo-Tenant");
  return response;
}

function canonicalAliasLocation(
  request: NextRequest,
  canonicalHost: string,
): string {
  const source = new URL(request.url);
  return `https://${canonicalHost}${source.pathname}${source.search}`;
}

export function tenantProxyResponse(
  request: NextRequest,
  profile: AppProfile,
): NextResponse {
  const resolution = resolveTenantRequest(request.headers.get("host"), profile);
  if (!resolution.ok) {
    return applyTenantIsolation(
      NextResponse.json(
        {
          error: resolution.reason,
          status: resolution.status,
        },
        {
          status: resolution.status,
          headers: tenantResponseHeaders("no-store"),
        },
      ),
      { profile },
    );
  }

  const context = { profile, tenant: resolution.tenant } as const;
  if (resolution.matchedDomain.kind === "alias") {
    return applyTenantIsolation(
      NextResponse.redirect(
        canonicalAliasLocation(request, resolution.tenant.canonicalHost),
        308,
      ),
      context,
    );
  }

  return applyTenantIsolation(NextResponse.next(), context);
}

export function tenantHealthResponse(
  request: NextRequest,
  profile: AppProfile,
): NextResponse {
  const payload = tenantHealthResult(request.headers.get("host"), profile);
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : payload.status,
    headers: tenantResponseHeaders("no-store"),
  });
}

export function tenantMetadataResponse(
  request: NextRequest,
  profile: AppProfile,
): NextResponse {
  const resolution = resolveTenantRequest(request.headers.get("host"), profile);
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.reason, status: resolution.status },
      {
        status: resolution.status,
        headers: tenantResponseHeaders("no-store"),
      },
    );
  }
  const { tenant, matchedDomain } = resolution;
  const manifest = tenant.manifest;
  return NextResponse.json(
    {
      schema: manifest.schema,
      siteKey: manifest.siteKey,
      profile: tenant.profile,
      canonicalHost: tenant.canonicalHost,
      matchedDomain,
      domains: tenant.domains,
      brand: manifest.brand,
      shell: manifest.shell,
      auth: manifest.auth,
      credits: manifest.credits,
      workspace: manifest.workspace,
      adapters: manifest.adapters,
      plugin: tenant.plugin,
      capabilities: capabilitiesForTenant(tenant),
    },
    {
      headers: tenantResponseHeaders("no-store"),
    },
  );
}

export async function tenantPageMetadata(
  profile: AppProfile,
): Promise<Metadata> {
  const tenant = await currentTenant(profile);
  return {
    title: tenant.manifest.brand.name,
    description: `${tenant.manifest.brand.name} on OceanLeo`,
    alternates: {
      canonical: tenantCanonicalUrl(tenant),
    },
    robots: {
      index: true,
      follow: true,
    },
    other: {
      "oceanleo:site-key": String(tenant.manifest.siteKey),
      "oceanleo:app-profile": profile,
    },
  };
}

export async function tenantRobots(
  profile: AppProfile,
): Promise<MetadataRoute.Robots> {
  const tenant = await currentTenant(profile);
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: tenantCanonicalUrl(tenant, "/sitemap.xml"),
    host: `https://${tenant.canonicalHost}`,
  };
}

export async function tenantSitemapRoute(
  profile: AppProfile,
): Promise<MetadataRoute.Sitemap> {
  const tenant = await currentTenant(profile);
  return tenantSitemap(tenant).map((entry) => ({
    url: entry.url,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
