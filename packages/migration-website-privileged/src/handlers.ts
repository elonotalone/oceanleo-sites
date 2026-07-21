import type { CapabilityId } from "@oceanleo/capabilities/server";

export const WEBSITE_HANDLER_PATHS: readonly string[] = Object.freeze([
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

if (WEBSITE_HANDLER_PATHS.length !== 47) {
  throw new Error("Website privileged batch must retain all 47 handler paths.");
}

export function websiteHandlerCapability(
  route: string,
): CapabilityId {
  if (
    route.includes("/vault") ||
    route.includes("/env") ||
    route.startsWith("/api/setup/")
  ) {
    return "website:vault";
  }
  if (route.includes("/domain")) return "website:domain-admin";
  if (route.includes("/servers") || route.includes("/backend")) {
    return "website:server-admin";
  }
  if (route.includes("/oauth/")) return "website:provider-oauth";
  if (
    route.includes("/deploy") ||
    route.includes("/vercel/") ||
    route.includes("/transfer-out")
  ) {
    return "website:deploy";
  }
  return "website:source-edit";
}

export function websitePluginPattern(route: string): `/${string}` {
  return route.replace(
    /\[([A-Za-z][A-Za-z0-9_]*)\]/g,
    ":$1",
  ) as `/${string}`;
}
