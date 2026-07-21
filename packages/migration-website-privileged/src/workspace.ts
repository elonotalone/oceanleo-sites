import type {
  PluginHandlerContext,
  PluginRouteHandler,
} from "@oceanleo/plugin-runtime";
import { createElement, type ReactNode } from "react";

import {
  WEBSITE_ACCENT,
  WEBSITE_AGENT_ID,
  WEBSITE_CATALOG,
  WEBSITE_SITE_KEY,
  resolveWebsiteAppId,
  websiteCatalogEntry,
} from "./catalog";
import {
  WEBSITE_PROJECT_API_PATHS,
  WEBSITE_WORKBENCH_VIEWS,
} from "./source-editing";

export const WEBSITE_WORKSPACE_PARITY_EVIDENCE = Object.freeze([
  "packages/migration-website-privileged/src/workspace.ts",
  "packages/migration-website-privileged/src/catalog.ts",
  "packages/migration-website-privileged/src/source-editing.ts",
  "packages/migration-website-privileged/tests/website-privileged.test.ts",
]);

function pathSegments(params: PluginHandlerContext["params"]): readonly string[] {
  const raw = params.path;
  if (typeof raw === "string") return raw ? [raw] : [];
  return raw ?? [];
}

function catalogList(): ReactNode {
  return createElement(
    "ul",
    {
      "data-website-catalog": "true",
      style: {
        display: "grid",
        gap: "0.75rem",
        gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
        listStyle: "none",
        margin: "1.5rem 0 0",
        padding: 0,
      },
    },
    ...WEBSITE_CATALOG.map((app) =>
      createElement(
        "li",
        { key: app.id },
        createElement(
          "a",
          {
            "data-app-id": app.id,
            href: `/workspace/${encodeURIComponent(app.id)}`,
            style: {
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              color: "inherit",
              display: "block",
              padding: "0.875rem",
              textDecoration: "none",
            },
          },
          createElement("strong", null, app.name),
          createElement(
            "small",
            { style: { display: "block", marginTop: "0.25rem" } },
            app.tagline,
          ),
        ),
      ),
    ),
  );
}

function workbenchContract(projectId: string): ReactNode {
  return createElement(
    "dl",
    {
      "data-website-project-contract": "true",
      style: {
        display: "grid",
        gap: "0.5rem",
        gridTemplateColumns: "max-content 1fr",
        margin: "1.5rem 0 0",
      },
    },
    createElement("dt", null, "Workbench views"),
    createElement("dd", null, WEBSITE_WORKBENCH_VIEWS.join(", ")),
    createElement("dt", null, "Projects API"),
    createElement("dd", null, WEBSITE_PROJECT_API_PATHS.projects),
    createElement("dt", null, "Source tree"),
    createElement("dd", null, WEBSITE_PROJECT_API_PATHS.sourceTree(projectId)),
    createElement("dt", null, "Source transactions"),
    createElement(
      "dd",
      null,
      WEBSITE_PROJECT_API_PATHS.sourceTransactions(projectId),
    ),
  );
}

function renderWebsiteWorkspace(context: PluginHandlerContext): ReactNode {
  const requestUrl = new URL(context.request.url);
  const appId = resolveWebsiteAppId({
    pathSegments: pathSegments(context.params),
    fnQuery: requestUrl.searchParams.get("fn"),
  });
  const app = websiteCatalogEntry(appId);
  const embed =
    requestUrl.searchParams.get("embed") === "1" ||
    requestUrl.searchParams.get("solo") === "1";
  const solo = requestUrl.searchParams.get("solo") === "1";
  const surface = app ? "workbench" : "catalog";

  return createElement(
    "main",
    {
      "data-agent-id": WEBSITE_AGENT_ID,
      "data-app-known": app ? "true" : "false",
      "data-capability": "website:source-edit",
      "data-context-id": app ? `olctx:v1:${WEBSITE_SITE_KEY}:app:${app.id}` : "",
      "data-embed": embed ? "true" : "false",
      "data-project-api-base": WEBSITE_PROJECT_API_PATHS.projects,
      "data-query": requestUrl.searchParams.toString(),
      "data-request-path": context.pathname,
      "data-selected-app": appId,
      "data-site-key": WEBSITE_SITE_KEY,
      "data-solo": solo ? "true" : "false",
      "data-unmatched-path": pathSegments(context.params).slice(1).join("/"),
      "data-website-accent": WEBSITE_ACCENT,
      "data-website-surface": surface,
      "data-workbench-views": WEBSITE_WORKBENCH_VIEWS.join(","),
      style: {
        margin: "0 auto",
        maxWidth: "72rem",
        padding: "2rem",
      },
    },
    createElement(
      "header",
      null,
      createElement("p", null, `${WEBSITE_SITE_KEY} · website-privileged migration`),
      createElement("h1", null, app?.name ?? "Website 工作台"),
      createElement(
        "p",
        null,
        app
          ? `${WEBSITE_AGENT_ID} · ${app.tagline}`
          : "选一个成品网站开始——点开后右上角可「返回」换一个。",
      ),
    ),
    surface === "workbench"
      ? workbenchContract("123e4567-e89b-42d3-a456-426614174000")
      : catalogList(),
  );
}

export function websiteWorkspaceHandler(): PluginRouteHandler {
  return (context) => {
    if (context.tenant.manifest.siteKey !== WEBSITE_SITE_KEY) {
      throw new Error(
        `Website workspace handler received tenant ${String(context.tenant.manifest.siteKey)}.`,
      );
    }
    return {
      kind: "page",
      node: renderWebsiteWorkspace(context),
    };
  };
}
