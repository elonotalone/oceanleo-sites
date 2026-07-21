import {
  definePluginBatch,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import type { CreationSiteKey } from "./protocols";
import {
  creationPageHandler,
  ecommerceUploadHandler,
  type CreationPageHandlerOptions,
} from "./surfaces";

export const CREATION_PARITY_EVIDENCE = Object.freeze([
  "packages/migration-creation/tests/creation.test.ts",
]);

function pageRoute(input: Readonly<{
  siteKey: CreationSiteKey;
  id: string;
  pattern: `/${string}`;
  source: string;
  options: CreationPageHandlerOptions;
  capability?: PluginRouteDeclaration["capability"];
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "page",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: input.capability ?? "workbench:advanced",
    parity: {
      status: "verified",
      source: input.source,
      evidence: CREATION_PARITY_EVIDENCE,
    },
    handler: creationPageHandler(input.siteKey, input.options),
  };
}

const ecommerceRoutes: readonly PluginRouteDeclaration[] = [
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.workspace",
    pattern: "/workspace",
    source: "ecommerce-assets:frontend/app/workspace/page.tsx",
    options: { mode: "catalog" },
  }),
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.workspace-app",
    pattern: "/workspace/:appId",
    source: "ecommerce-assets:frontend/app/workspace/[appId]/page.tsx",
    options: { mode: "catalog", appParam: "appId" },
  }),
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.assets",
    pattern: "/assets",
    source: "ecommerce-assets:frontend/app/assets/page.tsx",
    options: { mode: "template-catalog", fixedAppId: "assets" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.copy",
    pattern: "/copy",
    source: "ecommerce-assets:frontend/app/copy/page.tsx",
    options: { mode: "legacy-editor", fixedAppId: "copy" },
  }),
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.tools",
    pattern: "/tools/:slug",
    source: "ecommerce-assets:frontend/app/tools/[slug]/page.tsx",
    options: { mode: "legacy-editor", appParam: "slug" },
  }),
  pageRoute({
    siteKey: "ecommerce",
    id: "ecommerce.library",
    pattern: "/library",
    source: "ecommerce-assets:frontend/app/library/page.tsx",
    options: { mode: "library" },
    capability: "artifact:read",
  }),
  {
    id: "ecommerce.upload",
    kind: "api",
    surface: "api",
    pattern: "/api/upload",
    methods: ["POST"],
    capability: "artifact:write",
    parity: {
      status: "verified",
      source: "ecommerce-assets:frontend/app/api/upload/route.ts",
      evidence: CREATION_PARITY_EVIDENCE,
    },
    handler: ecommerceUploadHandler,
  },
];

const novelRoutes: readonly PluginRouteDeclaration[] = [
  pageRoute({
    siteKey: "novel",
    id: "novel.workspace",
    pattern: "/workspace",
    source: "novel:app/(app)/workspace/page.tsx",
    options: { mode: "catalog" },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.workspace-app",
    pattern: "/workspace/:appId",
    source: "novel:app/(app)/workspace/[appId]/page.tsx",
    options: { mode: "catalog", appParam: "appId" },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.history",
    pattern: "/history/:sessionId",
    source: "novel:app/(app)/history/[sessionId]/page.tsx",
    options: { mode: "catalog", catchAllParam: "sessionId" },
    capability: "workspace:session",
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.library",
    pattern: "/library",
    source: "novel:app/(app)/library/page.tsx",
    options: { mode: "library" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.novel-editor",
    pattern: "/novel/:path*",
    source: "novel:app/(app)/novel/**/page.tsx",
    options: {
      mode: "legacy-editor",
      fixedAppId: "novel",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.script-editor",
    pattern: "/script-write/:path*",
    source: "novel:app/(app)/script-write/**/page.tsx",
    options: {
      mode: "legacy-editor",
      fixedAppId: "script",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.write-tools",
    pattern: "/write/:path*",
    source: "novel:app/(app)/write/**/page.tsx",
    options: {
      mode: "template-catalog",
      fixedAppId: "write",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.ai-tools",
    pattern: "/ai-tools/:path*",
    source: "novel:app/(app)/ai-tools/**/page.tsx",
    options: {
      mode: "template-catalog",
      fixedAppId: "ai-tools",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.workflows",
    pattern: "/workflows/:path*",
    source: "novel:app/(app)/workflows/**/page.tsx",
    options: {
      mode: "project-editor",
      fixedAppId: "workflows",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.classroom",
    pattern: "/classroom/:path*",
    source: "novel:app/(app)/classroom/**/page.tsx",
    options: {
      mode: "template-catalog",
      fixedAppId: "classroom",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "novel",
    id: "novel.works",
    pattern: "/works/:path*",
    source: "novel:app/(app)/works/**/page.tsx",
    options: {
      mode: "library",
      fixedAppId: "works",
      catchAllParam: "path",
    },
    capability: "artifact:read",
  }),
];

const scriptRoutes: readonly PluginRouteDeclaration[] = [
  pageRoute({
    siteKey: "script",
    id: "script.workspace",
    pattern: "/workspace",
    source: "script:app/(main)/workspace/page.tsx",
    options: { mode: "catalog" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.workspace-app",
    pattern: "/workspace/:appId",
    source: "script:app/(main)/workspace/[appId]/page.tsx",
    options: { mode: "catalog", appParam: "appId" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.history",
    pattern: "/history/:sessionId",
    source: "script:app/(main)/history/[sessionId]/page.tsx",
    options: { mode: "catalog", catchAllParam: "sessionId" },
    capability: "workspace:session",
  }),
  pageRoute({
    siteKey: "script",
    id: "script.library",
    pattern: "/library",
    source: "script:app/(main)/library/page.tsx",
    options: { mode: "library" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "script",
    id: "script.quick-templates",
    pattern: "/quick",
    source: "script:app/(main)/quick/page.tsx",
    options: { mode: "template-catalog", fixedAppId: "quick" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.projects",
    pattern: "/projects",
    source: "script:app/(main)/projects/page.tsx",
    options: { mode: "project-editor", fixedAppId: "projects" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.project-editor",
    pattern: "/p/:path*",
    source: "script:app/(main)/p/**/page.tsx",
    options: { mode: "project-editor", catchAllParam: "path" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.import",
    pattern: "/import",
    source: "script:app/(main)/import/page.tsx",
    options: { mode: "project-editor", fixedAppId: "import" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.adaptation",
    pattern: "/adaptation",
    source: "script:app/(main)/adaptation/page.tsx",
    options: { mode: "project-editor", fixedAppId: "adaptation" },
  }),
  pageRoute({
    siteKey: "script",
    id: "script.doctor",
    pattern: "/doctor",
    source: "script:app/(main)/doctor/page.tsx",
    options: { mode: "project-editor", fixedAppId: "doctor" },
  }),
];

const designRoutes: readonly PluginRouteDeclaration[] = [
  pageRoute({
    siteKey: "design",
    id: "design.workspace",
    pattern: "/workspace",
    source: "design:app/(app)/workspace/page.tsx",
    options: { mode: "catalog" },
  }),
  pageRoute({
    siteKey: "design",
    id: "design.workspace-app",
    pattern: "/workspace/:appId",
    source: "design:app/(app)/workspace/[appId]/page.tsx",
    options: { mode: "catalog", appParam: "appId" },
  }),
  pageRoute({
    siteKey: "design",
    id: "design.history",
    pattern: "/history/:sessionId",
    source: "design:app/(app)/history/[sessionId]/page.tsx",
    options: { mode: "catalog", catchAllParam: "sessionId" },
    capability: "workspace:session",
  }),
  pageRoute({
    siteKey: "design",
    id: "design.library",
    pattern: "/library",
    source: "design:app/(app)/library/page.tsx",
    options: { mode: "library" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "design",
    id: "design.embed-editor",
    pattern: "/embed/editor",
    source: "design:app/embed/editor/page.tsx",
    options: { mode: "design-editor", fixedAppId: "canvas-editor" },
    capability: "artifact:write",
  }),
  pageRoute({
    siteKey: "design",
    id: "design.editor",
    pattern: "/editor",
    source: "design:app/editor/page.tsx",
    options: { mode: "design-editor", fixedAppId: "canvas-editor" },
    capability: "artifact:write",
  }),
  ...[
    ["templates", "templates", "template-catalog"],
    ["ai-suite", "ai-suite", "catalog"],
    ["batch", "batch", "catalog"],
    ["brand", "brand", "catalog"],
    ["discover", "generate", "template-catalog"],
    ["my", "generate", "library"],
    ["dashboard", "generate", "catalog"],
  ].map(
    ([path, appId, mode]): PluginRouteDeclaration =>
      pageRoute({
        siteKey: "design",
        id: `design.${path}`,
        pattern: `/${path}` as `/${string}`,
        source: `design:app/(app)/${path}/page.tsx`,
        options: {
          mode: mode as CreationPageHandlerOptions["mode"],
          fixedAppId: appId,
        },
        capability: mode === "library" ? "artifact:read" : undefined,
      }),
  ),
];

const makeRoutes: readonly PluginRouteDeclaration[] = [
  pageRoute({
    siteKey: "make",
    id: "make.workspace",
    pattern: "/workspace",
    source: "make:app/(app)/workspace/page.tsx",
    options: { mode: "catalog" },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.workspace-app",
    pattern: "/workspace/:appId",
    source: "make:app/(app)/workspace/[appId]/page.tsx",
    options: { mode: "catalog", appParam: "appId" },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.history",
    pattern: "/history/:sessionId",
    source: "make:app/(app)/history/[sessionId]/page.tsx",
    options: { mode: "catalog", catchAllParam: "sessionId" },
    capability: "workspace:session",
  }),
  pageRoute({
    siteKey: "make",
    id: "make.library",
    pattern: "/library",
    source: "make:app/(app)/library/page.tsx",
    options: { mode: "library" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "make",
    id: "make.design",
    pattern: "/design/:path*",
    source: "make:app/(app)/design/**/page.tsx",
    options: {
      mode: "design-editor",
      fixedAppId: "make",
      catchAllParam: "path",
    },
    capability: "artifact:write",
  }),
  pageRoute({
    siteKey: "make",
    id: "make.drafts",
    pattern: "/drafts",
    source: "make:app/(app)/drafts/page.tsx",
    options: { mode: "library", fixedAppId: "drafts" },
    capability: "artifact:read",
  }),
  pageRoute({
    siteKey: "make",
    id: "make.suite",
    pattern: "/suite/:path*",
    source: "make:app/(app)/suite/**/page.tsx",
    options: {
      mode: "commerce",
      fixedAppId: "suite",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.mall",
    pattern: "/mall/:path*",
    source: "make:app/(app)/mall/**/page.tsx",
    options: {
      mode: "commerce",
      fixedAppId: "mall",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.orders",
    pattern: "/orders/:path*",
    source: "make:app/(app)/orders/**/page.tsx",
    options: {
      mode: "commerce",
      fixedAppId: "orders",
      catchAllParam: "path",
    },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.search",
    pattern: "/search",
    source: "make:app/(app)/search/page.tsx",
    options: { mode: "commerce", fixedAppId: "search" },
  }),
  pageRoute({
    siteKey: "make",
    id: "make.dashboard",
    pattern: "/dashboard",
    source: "make:app/(app)/dashboard/page.tsx",
    options: { mode: "commerce", fixedAppId: "dashboard" },
  }),
];

export const CREATION_PLUGIN_BATCH = definePluginBatch({
  id: "creation",
  migrationBatch: 4,
  profile: "standard",
  ownerPath: "packages/migration-creation",
  plugins: [
    {
      id: "ecommerce-asset-studio",
      siteKey: "ecommerce",
      routes: ecommerceRoutes,
    },
    {
      id: "novel-workbench",
      siteKey: "novel",
      routes: novelRoutes,
    },
    {
      id: "script-workbench",
      siteKey: "script",
      routes: scriptRoutes,
    },
    {
      id: "design-canvas",
      siteKey: "design",
      routes: designRoutes,
    },
    {
      id: "custom-commerce-workbench",
      siteKey: "make",
      routes: makeRoutes,
    },
  ],
});
