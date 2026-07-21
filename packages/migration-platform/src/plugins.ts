import {
  definePluginBatch,
  type PluginRouteDeclaration,
  type PluginRouteHandler,
} from "@oceanleo/plugin-runtime";

import {
  handleElementDocumentRequest,
  handleFaviconProxyRequest,
  handleTemplateDocumentRequest,
  handleTrialChatRequest,
} from "./api-handlers";
import { createPlatformPageNode } from "./platform-page";
import {
  PLATFORM_ALIAS_CONTRACTS,
  PLATFORM_PARITY_EVIDENCE,
  PLATFORM_TENANT_CONTRACTS,
  type PlatformApiRouteContract,
  type PlatformPageRouteContract,
  type PlatformRouteContract,
  type PlatformTenantContract,
} from "./source-parity";

function pageHandler(
  tenant: PlatformTenantContract,
  route: PlatformPageRouteContract,
): PluginRouteHandler {
  return ({ params, request }) => ({
    kind: "page",
    node: createPlatformPageNode({
      tenant,
      route,
      params,
      requestUrl: request.url,
    }),
  });
}

function apiHandler(route: PlatformApiRouteContract): PluginRouteHandler {
  if (route.view === "trial-chat") {
    return async ({ request }) => ({
      kind: "response",
      response: await handleTrialChatRequest(request),
    });
  }
  if (route.view === "favicon-proxy") {
    return async ({ request }) => ({
      kind: "response",
      response: await handleFaviconProxyRequest(request),
    });
  }
  if (route.view === "element-document") {
    return ({ params, request }) => ({
      kind: "response",
      response: handleElementDocumentRequest(request, params),
    });
  }
  return ({ params, request }) => ({
    kind: "response",
    response: handleTemplateDocumentRequest(request, params),
  });
}

function pluginRoute(
  tenant: PlatformTenantContract,
  route: PlatformRouteContract,
): PluginRouteDeclaration {
  return {
    id: route.id,
    kind: route.kind,
    surface: route.surface,
    pattern: route.pattern,
    methods: route.methods,
    capability: route.capability,
    parity: {
      status: "verified",
      source: route.source,
      evidence: PLATFORM_PARITY_EVIDENCE,
    },
    handler:
      route.kind === "page"
        ? pageHandler(tenant, route)
        : apiHandler(route),
  };
}

const aliasRoutesBySite = new Map<
  PlatformTenantContract["siteKey"],
  PluginRouteDeclaration
>(
  PLATFORM_ALIAS_CONTRACTS.map((alias) => [
    alias.siteKey,
    {
      id: alias.id,
      kind: "redirect",
      surface: "both",
      pattern: "/:path*",
      methods: ["*"],
      hosts: [alias.sourceHost],
      capability: "shell:render",
      priority: 100,
      parity: {
        status: "verified",
        source: alias.source,
        evidence: alias.evidence,
      },
      redirect: {
        protocol: "https",
        host: alias.destinationHost,
        path: { mode: "preserve" },
        status: 308,
      },
    } satisfies PluginRouteDeclaration,
  ]),
);

function legacyApiPageRedirects(
  tenant: PlatformTenantContract,
): PluginRouteDeclaration[] {
  const hasApiGuide = tenant.routes.some(
    (route) => route.kind === "page" && route.pattern === "/api-guide",
  );
  // Bare `/api` cannot mount on page or api catch-alls (page reserves the
  // segment; api/[...segments] needs a child). Only `/api/guide` is reachable.
  if (!hasApiGuide) return [];
  return [
    {
      id: `${tenant.siteKey}.api.legacy-guide.redirect`,
      kind: "redirect",
      surface: "api",
      pattern: "/api/guide",
      methods: ["*"],
      capability: "shell:render",
      parity: {
        status: "verified",
        source: `${tenant.siteKey}:app/api/guide/page.tsx`,
        evidence: PLATFORM_PARITY_EVIDENCE,
      },
      redirect: {
        protocol: "https",
        host: tenant.canonicalHost,
        path: { mode: "fixed", value: "/api-guide" },
        status: 308,
      },
    },
  ];
}

export const PLATFORM_PLUGIN_BATCH = definePluginBatch({
  id: "platform",
  migrationBatch: 5,
  profile: "standard",
  ownerPath: "packages/migration-platform",
  plugins: PLATFORM_TENANT_CONTRACTS.map((tenant) => ({
    id: tenant.extensionId,
    siteKey: tenant.siteKey,
    routes: [
      ...(aliasRoutesBySite.has(tenant.siteKey)
        ? [aliasRoutesBySite.get(tenant.siteKey)!]
        : []),
      ...legacyApiPageRedirects(tenant),
      ...tenant.routes.map((route) => pluginRoute(tenant, route)),
    ],
  })),
});
