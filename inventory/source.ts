import type { CapabilityId } from "@oceanleo/capabilities/server";

export const INVENTORY_SCHEMA =
  "oceanleo.route-handler-inventory.v1" as const;
export const INVENTORY_SOURCE_REVISION = "foundation-2026-07-21.1" as const;

export type ParityStatus =
  | "foundation"
  | "pending"
  | "partial"
  | "verified"
  | "retired";

export type InventoryKind =
  | "page"
  | "route-handler"
  | "metadata"
  | "plugin-extension";

export interface FoundationRoute {
  readonly route: string;
  readonly kind: Exclude<InventoryKind, "plugin-extension">;
  readonly methods: readonly string[];
  readonly capabilities: readonly CapabilityId[];
}

export const FOUNDATION_ROUTES: readonly FoundationRoute[] = Object.freeze([
  {
    route: "/",
    kind: "page",
    methods: ["GET"],
    capabilities: ["shell:render"],
  },
  {
    route: "/api/health",
    kind: "route-handler",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/api/tenant",
    kind: "route-handler",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/robots.txt",
    kind: "metadata",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/sitemap.xml",
    kind: "metadata",
    methods: ["GET"],
    capabilities: [],
  },
]);

export const WEBSITE_LEGACY_HANDLERS: readonly string[] = Object.freeze([
  "/api/cursor-agent",
  "/api/cursor-agent/[id]",
  "/api/cursor-agent/models",
  "/api/deploy",
  "/api/deploy/[id]/status",
  "/api/domain/brainstorm",
  "/api/domain/purchase",
  "/api/domain/search",
  "/api/generate-site",
  "/api/generate-site/stream",
  "/api/github/repos",
  "/api/oauth/aliyun",
  "/api/oauth/cloudflare",
  "/api/oauth/github",
  "/api/oauth/railway",
  "/api/oauth/supabase",
  "/api/oauth/vercel",
  "/api/preview/quota",
  "/api/servers",
  "/api/servers/[id]/test",
  "/api/servers/provision",
  "/api/setup/check-db",
  "/api/setup/init-db",
  "/api/sites",
  "/api/sites/[id]/backend",
  "/api/sites/[id]/backend/deploy",
  "/api/sites/[id]/backend/ops",
  "/api/sites/[id]/domain",
  "/api/sites/[id]/domain/dns",
  "/api/sites/[id]/domain/purchase-and-bind",
  "/api/sites/[id]/env",
  "/api/sites/[id]/overrides/sync",
  "/api/sites/[id]/toggle",
  "/api/sites/[id]/transfer-out",
  "/api/sites/[id]/vibe-code",
  "/api/sites/[id]/vibe-code-hosted",
  "/api/sites/[id]/vibe-code/pr",
  "/api/sites/[id]/virtual-config",
  "/api/sites/import",
  "/api/sites/platform-deploy",
  "/api/templates",
  "/api/user-templates",
  "/api/user-templates/[id]",
  "/api/user-templates/[id]/snapshot",
  "/api/vault",
  "/api/vault/diagnose",
  "/api/vercel/projects",
]);

export function websiteHandlerCapabilities(
  route: string,
): readonly CapabilityId[] {
  if (
    route.includes("/vault") ||
    route.includes("/env") ||
    route.startsWith("/api/setup/")
  ) {
    return ["website:vault"];
  }
  if (route.includes("/domain")) {
    return ["website:domain-admin"];
  }
  if (route.includes("/servers") || route.includes("/backend")) {
    return ["website:server-admin"];
  }
  if (route.includes("/oauth/")) return ["website:provider-oauth"];
  if (
    route.includes("/deploy") ||
    route.includes("/vercel/") ||
    route.includes("/transfer-out")
  ) {
    return ["website:deploy"];
  }
  return ["website:source-edit"];
}
