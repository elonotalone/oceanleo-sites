import {
  definePluginBatch,
  type PluginMethod,
  type PluginParity,
  type PluginRouteDeclaration,
  type PluginRouteHandler,
  type TenantPluginDefinition,
} from "@oceanleo/plugin-runtime";
import type { CapabilityId } from "@oceanleo/capabilities/server";
import { createElement, lazy } from "react";

import {
  handleConverterAudioUpload,
  handleWordDocumentUpload,
} from "./handlers";
import {
  handleExcelSandboxDownload,
  handleExcelSandboxGenerateCode,
  handleExcelSandboxRun,
  handleExcelSandboxSession,
  handleExcelSandboxSource,
  handleExcelSandboxUpload,
} from "./excel-sandbox";
import type { OfficePageKind, OfficeRoutePageProps } from "./pages";

type OfficeSiteKey = OfficeRoutePageProps["siteKey"];
type RouteStatus = PluginParity["status"];

const OFFICE_TEST = "packages/migration-office/tests/office.test.ts";
const OFFICE_PAGES = "packages/migration-office/src/pages.tsx";
const OFFICE_HANDLERS = "packages/migration-office/src/handlers.ts";

const SOURCE_ROOT: Readonly<Record<OfficeSiteKey, string>> = Object.freeze({
  ppt: "ppt-maker:frontend",
  excel: "excel-ai:frontend",
  word: "word-ai:frontend",
  converter: "converter-suite:frontend",
  resume: "resume:.",
});

const CANONICAL_HOST: Readonly<Record<OfficeSiteKey, string>> = Object.freeze({
  ppt: "slide.oceanleo.com",
  excel: "excel.oceanleo.com",
  word: "word.oceanleo.com",
  converter: "converter.oceanleo.com",
  resume: "resume.oceanleo.com",
});

const SOURCE_BRAND = Object.freeze({
  ppt: Object.freeze({ name: "LeoSlides", accent: "#6366f1" }),
  excel: Object.freeze({ name: "LeoSheet", accent: "#279ba6" }),
  word: Object.freeze({ name: "LeoDoc", accent: "#059669" }),
  converter: Object.freeze({ name: "LeoConvert", accent: "#e11d48" }),
  resume: Object.freeze({ name: "LeoResume", accent: "#4f46e5" }),
});

const OfficeRoutePage = lazy(async () => {
  const module = await import("./pages");
  return { default: module.OfficeRoutePage };
});

function sourceFile(siteKey: OfficeSiteKey, relativePath: string): string {
  return `${SOURCE_ROOT[siteKey]}/${relativePath}`;
}

function parity(
  status: RouteStatus,
  source: string,
  implementation: string,
): PluginParity {
  return {
    status,
    source,
    evidence: [...new Set([source, implementation, OFFICE_TEST])],
  };
}

function pageHandler(
  page: OfficePageKind,
  activeParam?: string,
): PluginRouteHandler {
  return ({ tenant, params }) => {
    const active = activeParam ? params[activeParam] : undefined;
    const siteKey = String(tenant.manifest.siteKey) as OfficeSiteKey;
    const brand = SOURCE_BRAND[siteKey];
    return {
      kind: "page",
      node: createElement(OfficeRoutePage, {
        siteKey,
        brandName: brand.name,
        accent: brand.accent,
        pluginId: tenant.plugin.id,
        page,
        activeId: typeof active === "string" ? active : undefined,
      }),
    };
  };
}

function pageRoute(input: Readonly<{
  siteKey: OfficeSiteKey;
  id: string;
  pattern: `/${string}`;
  page: OfficePageKind;
  sourcePath: string;
  implementation: string;
  status?: Extract<RouteStatus, "verified" | "partial">;
  capability?: CapabilityId;
  activeParam?: string;
}>): PluginRouteDeclaration {
  return {
    id: `${input.siteKey}.${input.id}`,
    kind: "page",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: input.capability ?? "shell:render",
    parity: parity(
      input.status ?? "verified",
      sourceFile(input.siteKey, input.sourcePath),
      input.implementation,
    ),
    handler: pageHandler(input.page, input.activeParam),
  };
}

function redirectRoute(input: Readonly<{
  siteKey: OfficeSiteKey;
  id: string;
  pattern: `/${string}`;
  destination: `/${string}`;
  sourcePath: string;
  status?: 307 | 308;
}>): PluginRouteDeclaration {
  return {
    id: `${input.siteKey}.${input.id}`,
    kind: "redirect",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: "shell:render",
    parity: parity(
      "verified",
      sourceFile(input.siteKey, input.sourcePath),
      OFFICE_TEST,
    ),
    redirect: {
      protocol: "https",
      host: CANONICAL_HOST[input.siteKey],
      path: { mode: "fixed", value: input.destination },
      status: input.status ?? 307,
    },
  };
}

function workspaceRoutes(
  siteKey: OfficeSiteKey,
  dynamicSegment: "appId" | "slug" = "appId",
): PluginRouteDeclaration[] {
  return [
    pageRoute({
      siteKey,
      id: "workspace.item",
      pattern: `/workspace/:${dynamicSegment}`,
      page: "workspace",
      sourcePath: `app/workspace/[${dynamicSegment}]/page.tsx`,
      implementation: OFFICE_PAGES,
      capability: "workbench:advanced",
      activeParam: dynamicSegment,
    }),
    pageRoute({
      siteKey,
      id: "workspace",
      pattern: "/workspace",
      page: "workspace",
      sourcePath: "app/workspace/page.tsx",
      implementation: OFFICE_PAGES,
      capability: "workbench:advanced",
    }),
  ];
}

const COMMON_PAGES = [
  {
    id: "plugins",
    pattern: "/plugins",
    page: "plugins",
    sourcePath: "app/plugins/page.tsx",
    implementation: "@oceanleo/ui/pages:PluginsPage",
  },
  {
    id: "explore",
    pattern: "/explore",
    page: "explore",
    sourcePath: "app/explore/page.tsx",
    implementation: "@oceanleo/ui/shell:ExplorePage",
  },
  {
    id: "library",
    pattern: "/library",
    page: "library",
    sourcePath: "app/library/page.tsx",
    implementation: "@oceanleo/ui/shell:LibraryDetail",
    capability: "artifact:read",
  },
  {
    id: "settings",
    pattern: "/settings",
    page: "settings",
    sourcePath: "app/settings/page.tsx",
    implementation: "@oceanleo/ui/pages:SettingsPage",
  },
  {
    id: "general",
    pattern: "/general",
    page: "general",
    sourcePath: "app/general/page.tsx",
    implementation: "@oceanleo/ui/pages:GeneralPage",
  },
  {
    id: "cost",
    pattern: "/cost",
    page: "cost",
    sourcePath: "app/cost/page.tsx",
    implementation: "@oceanleo/ui/pages:CostPage",
  },
  {
    id: "advanced.feature",
    pattern: "/advanced/:feature",
    page: "advanced-feature",
    sourcePath: "app/advanced/[feature]/page.tsx",
    implementation: "@oceanleo/ui/shell:AdvancedFeatureRoute",
    capability: "workbench:advanced",
    activeParam: "feature",
  },
  {
    id: "advanced",
    pattern: "/advanced",
    page: "advanced",
    sourcePath: "app/advanced/page.tsx",
    implementation: "@oceanleo/ui/shell:AdvancedFeatureCatalog",
    capability: "workbench:advanced",
  },
  {
    id: "account",
    pattern: "/account",
    page: "account",
    sourcePath: "app/account/page.tsx",
    implementation: "@oceanleo/ui/pages:AccountPage",
  },
  {
    id: "history.session",
    pattern: "/history/:sessionId",
    page: "history-session",
    sourcePath: "app/history/[sessionId]/page.tsx",
    implementation: "@oceanleo/ui/shell:HistoryDetail",
    capability: "workbench:advanced",
    activeParam: "sessionId",
  },
  {
    id: "history",
    pattern: "/history",
    page: "history",
    sourcePath: "app/history/page.tsx",
    implementation: "@oceanleo/ui/shell:HistoryDetail",
    capability: "artifact:read",
  },
  {
    id: "api.guide",
    pattern: "/api-guide",
    page: "api-guide",
    sourcePath: "app/api/guide/page.tsx",
    implementation: "@oceanleo/ui/pages:ApiGuidePage",
  },
  {
    id: "api.page",
    pattern: "/developer-api",
    page: "api",
    sourcePath: "app/api/page.tsx",
    implementation: "@oceanleo/ui/pages:ApiPage",
  },
] as const;

function commonRoutes(siteKey: OfficeSiteKey): PluginRouteDeclaration[] {
  return [
    ...COMMON_PAGES.map((route) =>
      pageRoute({
        siteKey,
        ...route,
      }),
    ),
    redirectRoute({
      siteKey,
      id: "database.redirect",
      pattern: "/database",
      destination: "/library",
      sourcePath: "app/database/page.tsx",
    }),
    {
      id: `${siteKey}.api.legacy-guide.redirect`,
      kind: "redirect",
      surface: "api",
      pattern: "/api/guide",
      methods: ["*"],
      capability: "shell:render",
      parity: parity(
        "verified",
        sourceFile(siteKey, "app/api/guide/page.tsx"),
        OFFICE_TEST,
      ),
      redirect: {
        protocol: "https",
        host: CANONICAL_HOST[siteKey],
        path: { mode: "fixed", value: "/api-guide" },
        status: 308,
      },
    },
  ];
}

function excelSandboxApiRoute(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  methods: readonly PluginMethod[];
  capability: CapabilityId;
  sourcePath: string;
  evidenceFile: `packages/migration-office/src/excel-sandbox/${string}`;
  handler: PluginRouteHandler;
}>): PluginRouteDeclaration {
  return {
    id: `excel.${input.id}`,
    kind: "api",
    surface: "api",
    pattern: input.pattern,
    methods: input.methods,
    capability: input.capability,
    parity: parity(
      "verified",
      sourceFile("excel", input.sourcePath),
      input.evidenceFile,
    ),
    handler: input.handler,
  };
}

const excelSandboxRoutes: PluginRouteDeclaration[] = [
  excelSandboxApiRoute({
    id: "sandbox.upload",
    pattern: "/api/excel-sandbox/upload",
    methods: ["POST"],
    capability: "artifact:write",
    sourcePath: "app/api/excel-sandbox/upload/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/upload.ts",
    handler: ({ request }) =>
      handleExcelSandboxUpload(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
  excelSandboxApiRoute({
    id: "sandbox.download",
    pattern: "/api/excel-sandbox/download",
    methods: ["GET"],
    capability: "artifact:read",
    sourcePath: "app/api/excel-sandbox/download/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/download.ts",
    handler: ({ request }) =>
      handleExcelSandboxDownload(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
  excelSandboxApiRoute({
    id: "sandbox.generate-code",
    pattern: "/api/excel-sandbox/generate-code",
    methods: ["POST"],
    capability: "workbench:advanced",
    sourcePath: "app/api/excel-sandbox/generate-code/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/generate-code.ts",
    handler: ({ request }) =>
      handleExcelSandboxGenerateCode(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
  excelSandboxApiRoute({
    id: "sandbox.run",
    pattern: "/api/excel-sandbox/run",
    methods: ["POST"],
    capability: "workbench:advanced",
    sourcePath: "app/api/excel-sandbox/run/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/run.ts",
    handler: ({ request }) =>
      handleExcelSandboxRun(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
  excelSandboxApiRoute({
    id: "sandbox.session",
    pattern: "/api/excel-sandbox/session",
    methods: ["GET"],
    capability: "artifact:read",
    sourcePath: "app/api/excel-sandbox/session/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/session.ts",
    handler: ({ request }) =>
      handleExcelSandboxSession(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
  excelSandboxApiRoute({
    id: "sandbox.source",
    pattern: "/api/excel-sandbox/source",
    methods: ["GET"],
    capability: "artifact:read",
    sourcePath: "app/api/excel-sandbox/source/route.ts",
    evidenceFile: "packages/migration-office/src/excel-sandbox/source.ts",
    handler: ({ request }) =>
      handleExcelSandboxSource(request).then((response) => ({
        kind: "response",
        response,
      })),
  }),
];

const converterLegacyToolRoutes: PluginRouteDeclaration[] = [
  "speech-to-text",
  "text-to-speech",
  "pdf-to-word",
  "word-to-pdf",
  "markdown-to-docx",
  "image-format",
].map((slug) =>
  redirectRoute({
    siteKey: "converter",
    id: `legacy-tool.${slug}`,
    pattern: `/${slug}`,
    destination: `/workspace?fn=${slug}`,
    sourcePath: "app/[slug]/page.tsx",
  }),
);
converterLegacyToolRoutes.push(
  redirectRoute({
    siteKey: "converter",
    id: "legacy-tool.fallback",
    pattern: "/:slug",
    destination: "/workspace",
    sourcePath: "app/[slug]/page.tsx",
  }),
);

const pptPlugin: TenantPluginDefinition = {
  id: "presentation-workbench",
  siteKey: "ppt",
  routes: [
    {
      id: "ppt.alias.ppt-oceanleo-com",
      kind: "redirect",
      surface: "both",
      pattern: "/:path*",
      methods: ["*"],
      hosts: ["ppt.oceanleo.com"],
      capability: "shell:render",
      priority: 100,
      parity: parity(
        "verified",
        "oceandino:scripts/oceanleo-sites.tsv#ppt",
        OFFICE_TEST,
      ),
      redirect: {
        protocol: "https",
        host: "slide.oceanleo.com",
        path: { mode: "preserve" },
        status: 308,
      },
    },
    ...commonRoutes("ppt"),
    ...workspaceRoutes("ppt"),
    redirectRoute({
      siteKey: "ppt",
      id: "create.redirect",
      pattern: "/create",
      destination: "/workspace",
      sourcePath: "app/create/page.tsx",
    }),
    redirectRoute({
      siteKey: "ppt",
      id: "documents.redirect",
      pattern: "/documents",
      destination: "/workspace?fn=create",
      sourcePath: "app/documents/page.tsx",
    }),
    redirectRoute({
      siteKey: "ppt",
      id: "scenarios.redirect",
      pattern: "/scenarios",
      destination: "/workspace",
      sourcePath: "app/scenarios/page.tsx",
    }),
  ],
};

const excelPlugin: TenantPluginDefinition = {
  id: "spreadsheet-workbench",
  siteKey: "excel",
  routes: [
    ...commonRoutes("excel"),
    ...workspaceRoutes("excel", "slug"),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.tools.redirect",
      pattern: "/workspace/tools",
      destination: "/workspace?fn=tools",
      sourcePath: "app/workspace/tools/page.tsx",
    }),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.sandbox.redirect",
      pattern: "/workspace/sandbox",
      destination: "/workspace?fn=sandbox",
      sourcePath: "app/workspace/sandbox/page.tsx",
    }),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.files.redirect",
      pattern: "/workspace/files",
      destination: "/library",
      sourcePath: "app/workspace/files/page.tsx",
    }),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.toolbox.redirect",
      pattern: "/workspace/toolbox",
      destination: "/workspace?fn=toolbox",
      sourcePath: "app/workspace/toolbox/page.tsx",
    }),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.history.redirect",
      pattern: "/workspace/history",
      destination: "/history",
      sourcePath: "app/workspace/history/page.tsx",
    }),
    redirectRoute({
      siteKey: "excel",
      id: "workspace.dashboards.redirect",
      pattern: "/workspace/dashboards",
      destination: "/workspace",
      sourcePath: "app/workspace/dashboards/page.tsx",
    }),
    ...excelSandboxRoutes,
  ],
};

const wordPlugin: TenantPluginDefinition = {
  id: "document-workbench",
  siteKey: "word",
  routes: [
    ...commonRoutes("word"),
    ...workspaceRoutes("word"),
    redirectRoute({
      siteKey: "word",
      id: "editor.redirect",
      pattern: "/editor",
      destination: "/workspace?fn=markdown",
      sourcePath: "app/editor/page.tsx",
    }),
    redirectRoute({
      siteKey: "word",
      id: "plaintext.redirect",
      pattern: "/plaintext",
      destination: "/workspace?fn=plaintext",
      sourcePath: "app/plaintext/page.tsx",
    }),
    redirectRoute({
      siteKey: "word",
      id: "polish.redirect",
      pattern: "/polish",
      destination: "/workspace?fn=polish",
      sourcePath: "app/polish/page.tsx",
    }),
    redirectRoute({
      siteKey: "word",
      id: "templates.redirect",
      pattern: "/templates",
      destination: "/workspace?fn=templates",
      sourcePath: "app/templates/page.tsx",
    }),
    redirectRoute({
      siteKey: "word",
      id: "write.redirect",
      pattern: "/write",
      destination: "/workspace?fn=write",
      sourcePath: "app/write/page.tsx",
    }),
    {
      id: "word.document-upload",
      kind: "api",
      surface: "api",
      pattern: "/api/document-upload",
      methods: ["POST"],
      capability: "artifact:write",
      parity: parity(
        "verified",
        sourceFile("word", "app/api/document-upload/route.ts"),
        OFFICE_HANDLERS,
      ),
      handler: ({ request }) =>
        handleWordDocumentUpload(request).then((response) => ({
          kind: "response",
          response,
        })),
    },
  ],
};

const converterPlugin: TenantPluginDefinition = {
  id: "conversion-workbench",
  siteKey: "converter",
  routes: [
    ...commonRoutes("converter"),
    ...workspaceRoutes("converter"),
    redirectRoute({
      siteKey: "converter",
      id: "notes.redirect",
      pattern: "/notes",
      destination: "/workspace?fn=notes",
      sourcePath: "app/notes/page.tsx",
    }),
    ...converterLegacyToolRoutes,
    {
      id: "converter.upload",
      kind: "api",
      surface: "api",
      pattern: "/api/upload",
      methods: ["POST"],
      capability: "artifact:write",
      parity: parity(
        "verified",
        sourceFile("converter", "app/api/upload/route.ts"),
        OFFICE_HANDLERS,
      ),
      handler: ({ request }) =>
        handleConverterAudioUpload(request).then((response) => ({
          kind: "response",
          response,
        })),
    },
  ],
};

const resumePlugin: TenantPluginDefinition = {
  id: "resume-workbench",
  siteKey: "resume",
  routes: [
    ...commonRoutes("resume"),
    ...workspaceRoutes("resume"),
    pageRoute({
      siteKey: "resume",
      id: "workspace-v4",
      pattern: "/workspace-v4",
      page: "workspace",
      sourcePath: "app/workspace-v4/page.tsx",
      implementation: OFFICE_PAGES,
      capability: "workbench:advanced",
    }),
    redirectRoute({
      siteKey: "resume",
      id: "cover-letter.redirect",
      pattern: "/cover-letter",
      destination: "/workspace?fn=cover-letter",
      sourcePath: "app/cover-letter/page.tsx",
    }),
    redirectRoute({
      siteKey: "resume",
      id: "interview.redirect",
      pattern: "/interview",
      destination: "/workspace?fn=interview",
      sourcePath: "app/interview/page.tsx",
    }),
    redirectRoute({
      siteKey: "resume",
      id: "templates.redirect",
      pattern: "/templates",
      destination: "/workspace?fn=resume",
      sourcePath: "app/templates/page.tsx",
    }),
    redirectRoute({
      siteKey: "resume",
      id: "builder.redirect",
      pattern: "/builder",
      destination: "/",
      sourcePath: "next.config.ts",
      status: 308,
    }),
  ],
};

export const OFFICE_PLUGIN_BATCH = definePluginBatch({
  id: "office",
  migrationBatch: 1,
  profile: "standard",
  ownerPath: "packages/migration-office",
  plugins: [
    pptPlugin,
    excelPlugin,
    wordPlugin,
    converterPlugin,
    resumePlugin,
  ],
});
