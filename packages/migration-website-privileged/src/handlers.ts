import type { CapabilityId } from "@oceanleo/capabilities/server";
import type {
  PluginMethod,
  PluginParity,
  PluginRouteHandler,
} from "@oceanleo/plugin-runtime";

import { CORE_WEBSITE_HANDLERS } from "./ported-core";
import { GENERATION_WEBSITE_HANDLERS } from "./ported-generation";
import { ORCHESTRATION_WEBSITE_HANDLERS } from "./ported-orchestration";
import { PROVIDER_WEBSITE_HANDLERS } from "./ported-provider";
import { SERVER_WEBSITE_HANDLERS } from "./ported-servers";
import { SITE_WEBSITE_HANDLERS } from "./ported-sites";

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

const WEBSITE_HANDLER_METHODS: Readonly<
  Record<string, readonly PluginMethod[]>
> = Object.freeze({
  "/api/cursor-agent": ["POST"],
  "/api/cursor-agent/[id]": ["GET"],
  "/api/cursor-agent/models": ["GET"],
  "/api/deploy": ["POST"],
  "/api/deploy/[id]/status": ["GET"],
  "/api/domain/brainstorm": ["POST"],
  "/api/domain/purchase": ["POST"],
  "/api/domain/search": ["GET"],
  "/api/generate-site": ["POST"],
  "/api/generate-site/stream": ["POST"],
  "/api/github/repos": ["GET"],
  "/api/oauth/aliyun": ["POST"],
  "/api/oauth/cloudflare": ["POST"],
  "/api/oauth/github": ["GET"],
  "/api/oauth/railway": ["POST"],
  "/api/oauth/supabase": ["GET"],
  "/api/oauth/vercel": ["GET"],
  "/api/preview/quota": ["POST"],
  "/api/servers": ["GET", "POST", "DELETE"],
  "/api/servers/[id]/test": ["POST"],
  "/api/servers/provision": ["GET", "POST"],
  "/api/setup/check-db": ["GET"],
  "/api/setup/init-db": ["POST"],
  "/api/sites": ["GET", "PATCH", "DELETE"],
  "/api/sites/[id]/backend": ["GET", "POST"],
  "/api/sites/[id]/backend/deploy": ["POST"],
  "/api/sites/[id]/backend/ops": ["GET", "POST"],
  "/api/sites/[id]/domain": ["GET", "POST", "DELETE"],
  "/api/sites/[id]/domain/dns": ["GET"],
  "/api/sites/[id]/domain/purchase-and-bind": ["POST"],
  "/api/sites/[id]/env": ["GET", "PUT", "POST", "DELETE"],
  "/api/sites/[id]/overrides/sync": ["POST"],
  "/api/sites/[id]/toggle": ["POST"],
  "/api/sites/[id]/transfer-out": ["POST"],
  "/api/sites/[id]/vibe-code": ["GET", "POST"],
  "/api/sites/[id]/vibe-code-hosted": ["GET", "POST"],
  "/api/sites/[id]/vibe-code/pr": ["GET", "POST"],
  "/api/sites/[id]/virtual-config": ["GET", "PUT"],
  "/api/sites/import": ["POST"],
  "/api/sites/platform-deploy": ["POST"],
  "/api/templates": ["GET"],
  "/api/user-templates": ["GET", "POST"],
  "/api/user-templates/[id]": ["GET", "PATCH", "DELETE"],
  "/api/user-templates/[id]/snapshot": ["POST", "DELETE"],
  "/api/vault": ["GET", "DELETE"],
  "/api/vault/diagnose": ["GET"],
  "/api/vercel/projects": ["GET"],
});

const PORTED_HANDLERS: Readonly<Record<string, PluginRouteHandler>> =
  Object.freeze({
    ...CORE_WEBSITE_HANDLERS,
    ...PROVIDER_WEBSITE_HANDLERS,
    ...SITE_WEBSITE_HANDLERS,
    ...GENERATION_WEBSITE_HANDLERS,
    ...ORCHESTRATION_WEBSITE_HANDLERS,
    ...SERVER_WEBSITE_HANDLERS,
  });

const PENDING_BLOCKERS: Readonly<Record<string, string>> = Object.freeze({
  "/api/deploy":
    "legacy POST runs runDeployPipeline inside Next after(); still missing createRepoFromTemplate/applyTemplatePlaceholders/deleteFile, Supabase Management createProject+wait+keys+SQL, github/vercel/supabase token refreshers, and the after()/background completion contract (vault helpers alone are insufficient)",
  "/api/sites/[id]/backend":
    "GET is a simple status read, but verified parity needs POST too: Aliyun SWAS RunCommand+waitForCommand+deployBackend, full Railway deployFromGitHub worker, and SSH forward into /backend/deploy — aliyun-swas/platform-host currently stop at provision/OpenSSH ops probes",
  "/api/sites/[id]/backend/deploy":
    "legacy POST needs installPrerequisites/findAvailablePort/deployBackend/setupCaddy/setupWebhookReceiver over SSH plus Cloudflare A-record, GitHub webhook, Vercel BACKEND_URL, and cursor-rules writes; platform-host only exposes test/prereq-check/status/restart/runUserSshCommand",
});

export interface WebsiteHandlerDescriptor {
  readonly route: string;
  readonly methods: readonly PluginMethod[];
  readonly handler?: PluginRouteHandler;
  readonly parity: PluginParity;
  readonly blocker?: string;
}

export const WEBSITE_HANDLER_DESCRIPTORS: readonly WebsiteHandlerDescriptor[] =
  Object.freeze(
    WEBSITE_HANDLER_PATHS.map((route) => {
      const hasHandler = Object.hasOwn(PORTED_HANDLERS, route);
      const handler = hasHandler ? PORTED_HANDLERS[route] : undefined;
      const blocker = PENDING_BLOCKERS[route];
      const methods = WEBSITE_HANDLER_METHODS[route];
      if (!methods) {
        throw new Error(`${route}: missing exact legacy method inventory.`);
      }
      if (!hasHandler && !blocker) {
        throw new Error(`${route}: missing handler or pending blocker.`);
      }
      if (hasHandler && blocker) {
        throw new Error(`${route}: cannot be both ported and blocked.`);
      }
      return Object.freeze({
        route,
        methods: Object.freeze([...methods]),
        handler,
        blocker,
        parity: Object.freeze({
          status: hasHandler ? "verified" : "pending",
          source: `website:front/app${route}/route.ts`,
          evidence: Object.freeze(
            hasHandler
              ? [
                  "packages/migration-website-privileged/src/ported-core.ts",
                  "packages/migration-website-privileged/src/ported-provider.ts",
                  "packages/migration-website-privileged/src/ported-sites.ts",
                  "packages/migration-website-privileged/src/ported-generation.ts",
                  "packages/migration-website-privileged/src/ported-orchestration.ts",
                  "packages/migration-website-privileged/src/ported-servers.ts",
                  "packages/migration-website-privileged/tests/website-privileged.test.ts",
                ]
              : [
                  "packages/migration-website-privileged/src/handlers.ts",
                  "packages/migration-website-privileged/tests/website-privileged.test.ts",
                ],
          ),
        }),
      }) satisfies WebsiteHandlerDescriptor;
    }),
  );

export const WEBSITE_VERIFIED_HANDLER_PATHS = Object.freeze(
  WEBSITE_HANDLER_DESCRIPTORS.filter(
    ({ parity }) => parity.status === "verified",
  ).map(({ route }) => route),
);

export const WEBSITE_PENDING_HANDLER_INVENTORY = Object.freeze(
  WEBSITE_HANDLER_DESCRIPTORS.filter(
    ({ parity }) => parity.status === "pending",
  ).map(({ route, methods, blocker }) =>
    Object.freeze({ route, methods, blocker: blocker! }),
  ),
);

if (
  WEBSITE_VERIFIED_HANDLER_PATHS.length +
    WEBSITE_PENDING_HANDLER_INVENTORY.length !==
  WEBSITE_HANDLER_PATHS.length
) {
  throw new Error("Website handler parity inventory must partition all paths.");
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
