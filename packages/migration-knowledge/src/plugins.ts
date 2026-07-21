import {
  definePluginBatch,
  type PluginRouteDeclaration,
  type PluginRouteHandler,
} from "@oceanleo/plugin-runtime";
import { createElement } from "react";

import type { KnowledgeSiteKey } from "./catalog";
import { meetingUploadHandler, paperFetchUrlHandler } from "./handlers";
import { KnowledgeHistoryPage, KnowledgeWorkspacePage } from "./pages";

const TEST_EVIDENCE = Object.freeze([
  "packages/migration-knowledge/tests/knowledge.test.ts",
]);

function verified(source: string) {
  return {
    status: "verified" as const,
    source,
    evidence: TEST_EVIDENCE,
  };
}

function param(
  value: string | readonly string[] | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 ? normalized : null;
}

function workspaceHandler(
  siteKey: KnowledgeSiteKey,
  fixedWorkflowId?: string,
): PluginRouteHandler {
  return ({ params, request }) => {
    const requestedWorkflowId =
      fixedWorkflowId ??
      param(params.appId) ??
      param(new URL(request.url).searchParams.get("fn") ?? undefined);
    return {
      kind: "page",
      node: createElement(KnowledgeWorkspacePage, {
        siteKey,
        requestedWorkflowId,
      }),
    };
  };
}

function historyHandler(siteKey: KnowledgeSiteKey): PluginRouteHandler {
  return () => ({
    kind: "page",
    node: createElement(KnowledgeHistoryPage, { siteKey }),
  });
}

function pageRoute(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  source: string;
  capability?: "workbench:advanced" | "workspace:session";
  handler: PluginRouteHandler;
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "page",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: input.capability ?? "workbench:advanced",
    parity: verified(input.source),
    handler: input.handler,
  };
}

function commonRoutes(
  siteKey: KnowledgeSiteKey,
  sourceRoot = `${siteKey}:app`,
): readonly PluginRouteDeclaration[] {
  return [
    pageRoute({
      id: `${siteKey}.workspace`,
      pattern: "/workspace",
      source: `${sourceRoot}/workspace/page.tsx`,
      handler: workspaceHandler(siteKey),
    }),
    pageRoute({
      id: `${siteKey}.workspace.app`,
      pattern: "/workspace/:appId",
      source: `${sourceRoot}/workspace/[appId]/page.tsx`,
      handler: workspaceHandler(siteKey),
    }),
    pageRoute({
      id: `${siteKey}.history`,
      pattern: "/history",
      source: `${sourceRoot}/history/page.tsx`,
      capability: "workspace:session",
      handler: historyHandler(siteKey),
    }),
    pageRoute({
      id: `${siteKey}.history.session`,
      pattern: "/history/:sessionId",
      source: `${sourceRoot}/history/[sessionId]/page.tsx`,
      capability: "workspace:session",
      handler: historyHandler(siteKey),
    }),
  ];
}

function bizdevRedirect(
  id: string,
  sourcePath: `/${string}`,
  workflowId: string,
): PluginRouteDeclaration {
  return {
    id: `bizdev.legacy.${id}`,
    kind: "redirect",
    surface: "page",
    pattern: sourcePath,
    methods: ["GET", "HEAD"],
    capability: "shell:render",
    parity: verified("bizdev:next.config.ts#redirects"),
    redirect: {
      protocol: "https",
      host: "bizdev.oceanleo.com",
      path: {
        mode: "fixed",
        value: `/workspace?fn=${workflowId}`,
      },
      status: 308,
    },
  };
}

function fixedWorkflowRoute(input: Readonly<{
  siteKey: KnowledgeSiteKey;
  id: string;
  pattern: `/${string}`;
  workflowId: string;
  source: string;
}>): PluginRouteDeclaration {
  return pageRoute({
    id: `${input.siteKey}.legacy.${input.id}`,
    pattern: input.pattern,
    source: input.source,
    handler: workspaceHandler(input.siteKey, input.workflowId),
  });
}

const lawWorkflowRoutes: readonly PluginRouteDeclaration[] = [
  fixedWorkflowRoute({
    siteKey: "law",
    id: "consultation",
    pattern: "/consultation",
    workflowId: "general-consult",
    source: "law:app/(main)/consultation/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "consultation.domain",
    pattern: "/consultation/:domain",
    workflowId: "general-consult",
    source: "law:app/(main)/consultation/[domain]/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "cases",
    pattern: "/cases",
    workflowId: "case-search",
    source: "law:app/(main)/cases/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "regulations",
    pattern: "/regulations",
    workflowId: "law-search",
    source: "law:app/(main)/regulations/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "advice",
    pattern: "/tools/advice",
    workflowId: "legal-opinion",
    source: "law:app/(main)/tools/advice/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "advice.template",
    pattern: "/tools/advice/:templateId",
    workflowId: "legal-opinion",
    source: "law:app/(main)/tools/advice/[templateId]/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "calculator",
    pattern: "/tools/calculator",
    workflowId: "severance-calc",
    source: "law:app/(main)/tools/calculator/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "documents",
    pattern: "/tools/documents",
    workflowId: "complaint-doc",
    source: "law:app/(main)/tools/documents/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "documents.template",
    pattern: "/tools/documents/:templateId",
    workflowId: "complaint-doc",
    source: "law:app/(main)/tools/documents/[templateId]/page.tsx",
  }),
  fixedWorkflowRoute({
    siteKey: "law",
    id: "review",
    pattern: "/tools/review",
    workflowId: "contract-review",
    source: "law:app/(main)/tools/review/page.tsx",
  }),
];

const studyToolIds = Object.freeze([
  "ai-answer-generator",
  "ai-detector",
  "ai-flashcard-maker",
  "ai-humanizer",
  "ai-lecture-note-taker",
  "ai-note-taker",
  "ai-paraphraser",
  "ai-pdf-summarizer",
  "ai-quiz-generator",
  "ai-tutor",
  "ai-video-summarizer",
  "citation-generator",
  "homework-helper",
  "math-solver",
  "plagiarism-checker",
  "writing-templates",
]);

const studyToolRoutes = studyToolIds.map(
  (toolId): PluginRouteDeclaration =>
    fixedWorkflowRoute({
      siteKey: "study",
      id: toolId,
      pattern: `/${toolId}`,
      workflowId: toolId,
      source: `study:app/(tools)/${toolId}/page.tsx`,
    }),
);

export const KNOWLEDGE_PLUGIN_BATCH = definePluginBatch({
  id: "knowledge",
  migrationBatch: 3,
  profile: "standard",
  ownerPath: "packages/migration-knowledge",
  plugins: [
    {
      id: "business-development-workbench",
      siteKey: "bizdev",
      routes: [
        ...commonRoutes("bizdev"),
        bizdevRedirect("reply", "/reply", "reply"),
        bizdevRedirect("research", "/research", "research"),
        bizdevRedirect("competition", "/competition", "competition"),
        bizdevRedirect("dev-letter", "/dev-letter", "dev-letter"),
        bizdevRedirect("trade-talk", "/trade-talk", "trade-talk"),
      ],
    },
    {
      id: "meeting-workbench",
      siteKey: "meeting",
      routes: [
        ...commonRoutes("meeting"),
        {
          id: "meeting.api.upload",
          kind: "api",
          surface: "api",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          parity: verified("meeting:app/api/upload/route.ts"),
          handler: meetingUploadHandler,
        },
      ],
    },
    {
      id: "paper-workbench",
      siteKey: "paper",
      routes: [
        ...commonRoutes("paper"),
        fixedWorkflowRoute({
          siteKey: "paper",
          id: "summarize",
          pattern: "/summarize",
          workflowId: "summarize",
          source: "paper:app/summarize/page.tsx",
        }),
        {
          id: "paper.api.fetch-url",
          kind: "api",
          surface: "api",
          pattern: "/api/fetch-url",
          methods: ["POST"],
          capability: "browser:cloud",
          parity: verified("paper:app/api/fetch-url/route.ts"),
          handler: paperFetchUrlHandler,
        },
      ],
    },
    {
      id: "law-workbench",
      siteKey: "law",
      routes: [
        ...commonRoutes("law", "law:app/(main)"),
        ...lawWorkflowRoutes,
      ],
    },
    {
      id: "study-workbench",
      siteKey: "study",
      routes: [...commonRoutes("study"), ...studyToolRoutes],
    },
    {
      id: "education-workbench",
      siteKey: "edu",
      routes: [...commonRoutes("edu")],
    },
  ],
});
