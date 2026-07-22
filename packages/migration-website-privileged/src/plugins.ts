import {
  definePluginBatch,
  type PluginParity,
  type PluginRouteDeclaration,
  type PluginRouteHandler,
} from "@oceanleo/plugin-runtime";
import { createElement, lazy } from "react";

import { WEBSITE_SITE_KEY } from "./catalog";
import {
  WEBSITE_HANDLER_DESCRIPTORS,
  websiteHandlerCapability,
  websitePluginPattern,
} from "./handlers";
import {
  WEBSITE_WORKSPACE_PARITY_EVIDENCE,
  websiteWorkspaceHandler,
} from "./workspace";

const TEST_EVIDENCE =
  "packages/migration-website-privileged/tests/website-privileged.test.ts";
const SITE_EDITOR_SOURCE =
  "website:front/app/embed/site-editor/page.tsx";
const SITE_EDITOR_IMPL =
  "packages/migration-website-privileged/src/site-editor/WebsiteProjectWorkbench.tsx";

const WebsiteProjectWorkbench = lazy(async () => {
  const module = await import("./site-editor/WebsiteProjectWorkbench");
  return { default: module.WebsiteProjectWorkbench };
});

const handlerRoutes = WEBSITE_HANDLER_DESCRIPTORS.map(
  (descriptor, index): PluginRouteDeclaration => ({
    id: `website.handler.${String(index + 1).padStart(2, "0")}`,
    kind: descriptor.route.endsWith("/stream") ? "stream" : "api",
    surface: "api",
    pattern: websitePluginPattern(descriptor.route),
    methods: descriptor.methods,
    capability: websiteHandlerCapability(descriptor.route),
    parity: descriptor.parity,
    handler: descriptor.handler,
  }),
);

function verifiedParity(source: string, ...evidence: string[]): PluginParity {
  return {
    status: "verified",
    source,
    evidence: [...new Set([TEST_EVIDENCE, source, ...evidence])],
  };
}

function siteEditorHandler(): PluginRouteHandler {
  return (context) => {
    if (context.tenant.manifest.siteKey !== WEBSITE_SITE_KEY) {
      throw new Error(
        `Website site-editor handler received tenant ${String(context.tenant.manifest.siteKey)}.`,
      );
    }
    return {
      kind: "page",
      node: createElement(WebsiteProjectWorkbench, {}),
    };
  };
}

function redirectRoute(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  source: string;
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "redirect",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: "shell:render",
    parity: verifiedParity(input.source),
    redirect: {
      protocol: "https",
      host: "website.oceanleo.com",
      path: { mode: "fixed", value: "/workspace" },
      status: 307,
    },
  };
}

const LEGACY_PRODUCT_REDIRECTS: readonly PluginRouteDeclaration[] = [
  redirectRoute({
    id: "website.redirect.sites",
    pattern: "/sites",
    source: "website:front/app/sites/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.sites-new",
    pattern: "/sites/new",
    source: "website:front/app/sites/new/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.sites-import",
    pattern: "/sites/import",
    source: "website:front/app/sites/import/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.sites-id",
    pattern: "/sites/:id",
    source: "website:front/app/sites/[id]/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.sites-domain-purchase",
    pattern: "/sites/:id/domain-purchase",
    source: "website:front/app/sites/[id]/domain-purchase/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.vault",
    pattern: "/vault",
    source: "website:front/app/vault/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.templates",
    pattern: "/templates",
    source: "website:front/app/templates/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.templates-preview",
    pattern: "/templates/:slug/preview",
    source: "website:front/app/templates/[slug]/preview/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.explore",
    pattern: "/explore",
    source: "website:front/app/explore/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.library",
    pattern: "/library",
    source: "website:front/app/library/page.tsx",
  }),
  redirectRoute({
    id: "website.redirect.projects",
    pattern: "/projects",
    source: "website:front/app/projects/page.tsx",
  }),
];

export const WEBSITE_PRIVILEGED_PLUGIN_BATCH = definePluginBatch({
  id: "website-privileged",
  migrationBatch: 6,
  profile: "website-privileged",
  ownerPath: "packages/migration-website-privileged",
  plugins: [
    {
      id: "website-source-workbench",
      siteKey: "website",
      routes: [
        {
          id: "website.workspace",
          kind: "page",
          surface: "page",
          pattern: "/workspace/:path*",
          methods: ["GET", "HEAD"],
          capability: "website:source-edit",
          parity: {
            status: "verified",
            source: "website:front/app/workspace/page.tsx",
            evidence: WEBSITE_WORKSPACE_PARITY_EVIDENCE,
          },
          handler: websiteWorkspaceHandler(),
        },
        {
          id: "website.embed.site-editor",
          kind: "page",
          surface: "page",
          pattern: "/embed/site-editor",
          methods: ["GET", "HEAD"],
          capability: "website:source-edit",
          parity: verifiedParity(
            SITE_EDITOR_SOURCE,
            SITE_EDITOR_IMPL,
            "packages/migration-website-privileged/src/site-editor/DevSiteEditorClient.tsx",
            "packages/migration-website-privileged/src/site-editor/editor-core.ts",
            "packages/migration-website-privileged/src/site-editor/project-workbench/core/project-api.ts",
          ),
          handler: siteEditorHandler(),
        },
        ...LEGACY_PRODUCT_REDIRECTS,
        ...handlerRoutes,
      ],
    },
  ],
});
