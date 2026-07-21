import "server-only";

import { capabilitiesForTenant } from "@oceanleo/capabilities/server";
import {
  resolveTenantRequest,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";
import type { Metadata, MetadataRoute } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import {
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
  if (!resolution.ok) notFound();
  return resolution.tenant;
}

export function tenantProxyResponse(
  request: NextRequest,
  profile: AppProfile,
): NextResponse {
  const resolution = resolveTenantRequest(request.headers.get("host"), profile);
  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: resolution.reason,
        status: resolution.status,
      },
      {
        status: resolution.status,
        headers: {
          ...tenantResponseHeaders("no-store"),
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("Vary", "Host");
  response.headers.set(
    "X-OceanLeo-Tenant",
    String(resolution.tenant.manifest.siteKey),
  );
  response.headers.set("X-OceanLeo-App-Profile", profile);
  return response;
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
