import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";
import type { ReactElement } from "react";

import { WEBSITE_CATALOG } from "../src/catalog";
import {
  WEBSITE_HANDLER_DESCRIPTORS,
  WEBSITE_HANDLER_PATHS,
  WEBSITE_PENDING_HANDLER_INVENTORY,
  WEBSITE_VERIFIED_HANDLER_PATHS,
  websitePluginPattern,
} from "../src/handlers";
import { WEBSITE_PRIVILEGED_INVENTORY } from "../src/inventory";
import { WEBSITE_PRIVILEGED_PLUGIN_BATCH } from "../src/plugins";
import {
  WEBSITE_PROJECT_API_PATHS,
  WEBSITE_WORKBENCH_VIEWS,
  isCanonicalWebsiteProjectId,
  normalizeWebsitePreviewRoute,
  safeWebsiteSourcePath,
} from "../src/source-editing";

function websiteDispatcher() {
  const tenant = tenantForSiteKey("website");
  assert.ok(tenant);
  return {
    tenant,
    dispatcher: createPluginDispatcher("website-privileged", [
      WEBSITE_PRIVILEGED_PLUGIN_BATCH,
    ]),
  };
}

async function dispatchWorkspace(path: `/${string}`) {
  const { tenant, dispatcher } = websiteDispatcher();
  const url = new URL(path, "https://website.oceanleo.com");
  return dispatcher.dispatch({
    tenant,
    pathname: url.pathname as `/${string}`,
    surface: "page",
    request: new Request(url),
  });
}

function pageProps(
  result: Awaited<ReturnType<typeof dispatchWorkspace>>,
): Record<string, unknown> {
  if (result.kind !== "page") {
    throw new Error(`Expected page result, received ${result.kind}.`);
  }
  const element = result.node as ReactElement<Record<string, unknown>>;
  assert.equal(element.type, "main");
  return element.props;
}

test("website inventory partitions all 47 handlers into verified and blocked paths", () => {
  const handlers = WEBSITE_PRIVILEGED_INVENTORY.entries.filter(
    (entry) => entry.kind === "route-handler",
  );
  assert.equal(WEBSITE_HANDLER_PATHS.length, 47);
  assert.equal(WEBSITE_HANDLER_DESCRIPTORS.length, 47);
  assert.equal(handlers.length, 47);
  assert.equal(WEBSITE_VERIFIED_HANDLER_PATHS.length, 47);
  assert.equal(WEBSITE_PENDING_HANDLER_INVENTORY.length, 0);
  assert.equal(
    handlers.filter((entry) => entry.parity.status === "verified").length,
    47,
  );
  assert.equal(
    handlers.filter((entry) => entry.parity.status === "pending").length,
    0,
  );
  assert.ok(
    WEBSITE_HANDLER_DESCRIPTORS.every(
      (descriptor) =>
        descriptor.methods.length > 0 &&
        descriptor.parity.evidence.length > 0 &&
        (descriptor.parity.status === "verified"
          ? Boolean(descriptor.handler) && !descriptor.blocker
          : !descriptor.handler && Boolean(descriptor.blocker)),
    ),
  );
  assert.ok(
    WEBSITE_PENDING_HANDLER_INVENTORY.every(
      ({ blocker }) => blocker.length >= 40,
    ) || WEBSITE_PENDING_HANDLER_INVENTORY.length === 0,
  );
  for (const entry of handlers) {
    const descriptor = WEBSITE_HANDLER_DESCRIPTORS.find(
      ({ route }) => websitePluginPattern(route) === entry.route,
    );
    assert.ok(descriptor, String(entry.route));
    assert.deepEqual(entry.methods, descriptor.methods);
    assert.deepEqual(entry.parity, descriptor.parity);
    assert.notDeepEqual(entry.methods, ["UNMIGRATED"]);
  }
  assert.deepEqual(WEBSITE_PRIVILEGED_INVENTORY.tenantKeys, ["website"]);
  assert.equal(
    WEBSITE_PRIVILEGED_INVENTORY.ownerPath,
    "packages/migration-website-privileged",
  );
});

test("verified handlers dispatch while blocked handlers retain exact params", async () => {
  const { tenant, dispatcher } = websiteDispatcher();

  const previousCursorKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const models = await dispatcher.dispatch({
      tenant,
      pathname: "/api/cursor-agent/models",
      surface: "api",
      request: new Request(
        "https://website.oceanleo.com/api/cursor-agent/models",
      ),
    });
    assert.equal(models.kind, "response");
    if (models.kind === "response") {
      assert.equal(models.response.status, 200);
      assert.deepEqual(await models.response.json(), {
        models: [
          "gpt-5.4-fast",
          "claude-4.6-opus-fast",
          "claude-opus-4-6",
        ],
      });
    }

    const status = await dispatcher.dispatch({
      tenant,
      pathname: "/api/cursor-agent/agent-7",
      surface: "api",
      request: new Request(
        "https://website.oceanleo.com/api/cursor-agent/agent-7",
      ),
    });
    assert.equal(status.kind, "response");
    if (status.kind === "response") {
      assert.equal(status.response.status, 500);
      assert.deepEqual(await status.response.json(), {
        error: "CURSOR_API_KEY is not configured on the server.",
      });
    }
  } finally {
    if (previousCursorKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previousCursorKey;
  }

  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/deploy"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/[id]/backend"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes(
      "/api/sites/[id]/backend/deploy",
    ),
  );

  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/servers"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/servers/[id]/test"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/servers/provision"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/[id]/backend/ops"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes(
      "/api/sites/[id]/vibe-code-hosted",
    ),
  );

  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/[id]/toggle"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes(
      "/api/sites/[id]/domain/purchase-and-bind",
    ),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/[id]/vibe-code/pr"),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes(
      "/api/sites/[id]/overrides/sync",
    ),
  );
  assert.ok(
    WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/[id]/transfer-out"),
  );
  assert.ok(WEBSITE_VERIFIED_HANDLER_PATHS.includes("/api/sites/import"));
  assert.equal(WEBSITE_PENDING_HANDLER_INVENTORY.length, 0);
  assert.equal(
    typeof WEBSITE_HANDLER_DESCRIPTORS.find(
      ({ route }) => route === "/api/deploy",
    )?.handler,
    "function",
  );
  assert.equal(
    typeof WEBSITE_HANDLER_DESCRIPTORS.find(
      ({ route }) => route === "/api/sites/[id]/backend",
    )?.handler,
    "function",
  );
  assert.equal(
    typeof WEBSITE_HANDLER_DESCRIPTORS.find(
      ({ route }) => route === "/api/sites/[id]/backend/deploy",
    )?.handler,
    "function",
  );
  assert.equal(
    typeof WEBSITE_HANDLER_DESCRIPTORS.find(
      ({ route }) => route === "/api/sites/[id]/toggle",
    )?.handler,
    "function",
  );

  const previousVercelClient = process.env.VERCEL_CLIENT_ID;
  delete process.env.VERCEL_CLIENT_ID;
  const oauthVercel = await dispatcher.dispatch({
    tenant,
    pathname: "/api/oauth/vercel",
    surface: "api",
    request: new Request("https://website.oceanleo.com/api/oauth/vercel"),
  });
  assert.equal(oauthVercel.kind, "response");
  if (oauthVercel.kind === "response") {
    assert.equal(oauthVercel.response.status, 500);
    assert.deepEqual(await oauthVercel.response.json(), {
      error: "VERCEL_CLIENT_ID not configured",
    });
  }
  if (previousVercelClient === undefined) delete process.env.VERCEL_CLIENT_ID;
  else process.env.VERCEL_CLIENT_ID = previousVercelClient;

  const diagnoseBadPlatform = await dispatcher.dispatch({
    tenant,
    pathname: "/api/vault/diagnose",
    surface: "api",
    request: new Request(
      "https://website.oceanleo.com/api/vault/diagnose?platform=github",
    ),
  });
  assert.equal(diagnoseBadPlatform.kind, "response");
  if (diagnoseBadPlatform.kind === "response") {
    assert.equal(diagnoseBadPlatform.response.status, 400);
    assert.deepEqual(await diagnoseBadPlatform.response.json(), {
      error: "Only ?platform=supabase|vercel is supported",
    });
  }

  const previousOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const generate = await dispatcher.dispatch({
      tenant,
      pathname: "/api/generate-site",
      surface: "api",
      request: new Request("https://website.oceanleo.com/api/generate-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build a landing page" }),
      }),
    });
    assert.equal(generate.kind, "response");
    if (generate.kind === "response") {
      assert.equal(generate.response.status, 500);
      assert.deepEqual(await generate.response.json(), {
        error: "OPENAI_API_KEY is not configured on the server.",
      });
    }
  } finally {
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
  }

  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/api/not-declared",
      surface: "api",
      request: new Request(
        "https://website.oceanleo.com/api/not-declared",
      ),
    }),
    { kind: "not-found", status: 404 },
  );
});

test("privileged batch cannot load into the standard profile", () => {
  assert.equal(WEBSITE_PRIVILEGED_PLUGIN_BATCH.profile, "website-privileged");
  assert.throws(
    () =>
      createPluginDispatcher("standard", [
        WEBSITE_PRIVILEGED_PLUGIN_BATCH,
      ]),
    /standard dispatcher cannot load website-privileged batch/,
  );
});

test("workspace routes dispatch verified page handlers with catalog context", async () => {
  const catalog = pageProps(await dispatchWorkspace("/workspace"));
  assert.equal(catalog["data-site-key"], "website");
  assert.equal(catalog["data-website-surface"], "catalog");
  assert.equal(catalog["data-selected-app"], "");
  assert.equal(catalog["data-app-known"], "false");
  assert.equal(catalog["data-capability"], "website:source-edit");
  assert.equal(catalog["data-agent-id"], "website.build");
  assert.equal(
    catalog["data-workbench-views"],
    WEBSITE_WORKBENCH_VIEWS.join(","),
  );
  assert.equal(
    catalog["data-project-api-base"],
    WEBSITE_PROJECT_API_PATHS.projects,
  );
  assert.equal(WEBSITE_CATALOG.length, 12);

  const app = pageProps(await dispatchWorkspace("/workspace/corp-site"));
  assert.equal(app["data-website-surface"], "workbench");
  assert.equal(app["data-selected-app"], "corp-site");
  assert.equal(app["data-app-known"], "true");
  assert.equal(app["data-context-id"], "olctx:v1:website:app:corp-site");
  assert.equal(app["data-unmatched-path"], "");

  const query = pageProps(
    await dispatchWorkspace("/workspace?fn=landing&embed=1&solo=1"),
  );
  assert.equal(query["data-selected-app"], "landing");
  assert.equal(query["data-app-known"], "true");
  assert.equal(query["data-query"], "fn=landing&embed=1&solo=1");
  assert.equal(query["data-embed"], "true");
  assert.equal(query["data-solo"], "true");

  const workspaceRoute = WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins[0]!.routes.find(
    (route) => route.id === "website.workspace",
  );
  assert.ok(workspaceRoute);
  assert.equal(workspaceRoute.parity.status, "verified");
  assert.equal(typeof workspaceRoute.handler, "function");
});

test("privileged batch page routes have zero pending declarations", () => {
  const pendingPageRoutes = WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins.flatMap(
    (plugin) =>
      plugin.routes.filter(
        (route) =>
          route.kind === "page" && route.parity.status === "pending",
      ),
  );
  assert.deepEqual(pendingPageRoutes, []);
});

test("embed site-editor mounts the ported WebsiteProjectWorkbench", async () => {
  const result = await dispatchWorkspace("/embed/site-editor");
  assert.equal(result.kind, "page");
  if (result.kind !== "page") return;
  const element = result.node as ReactElement;
  assert.equal(typeof element.type, "object");
  assert.ok(
    element.type &&
      typeof element.type === "object" &&
      "$$typeof" in element.type,
  );

  const route = WEBSITE_PRIVILEGED_PLUGIN_BATCH.plugins[0]!.routes.find(
    (entry) => entry.id === "website.embed.site-editor",
  );
  assert.ok(route);
  assert.equal(route.pattern, "/embed/site-editor");
  assert.equal(route.parity.status, "verified");
  assert.equal(typeof route.handler, "function");
  assert.ok(
    WEBSITE_PRIVILEGED_INVENTORY.entries.some(
      (entry) =>
        entry.route === "/embed/site-editor" && entry.kind === "page",
    ),
  );
});

test("legacy product routes permanently redirect to /workspace", async () => {
  const redirects = [
    "/sites",
    "/sites/new",
    "/sites/import",
    "/sites/legacy-1",
    "/sites/legacy-1/domain-purchase",
    "/vault",
    "/templates",
    "/templates/starter/preview",
    "/explore",
    "/library",
    "/projects",
  ] as const;

  for (const path of redirects) {
    const result = await dispatchWorkspace(path);
    assert.equal(result.kind, "redirect", path);
    if (result.kind !== "redirect") continue;
    assert.equal(result.status, 307, path);
    assert.equal(
      result.location,
      "https://website.oceanleo.com/workspace",
      path,
    );
  }
});

test("source-editing contracts preserve canonical project and path safety", () => {
  assert.deepEqual(WEBSITE_WORKBENCH_VIEWS, [
    "preview",
    "code",
    "dashboard",
    "database",
    "storage",
    "settings",
  ]);
  assert.equal(
    isCanonicalWebsiteProjectId("123e4567-e89b-42d3-a456-426614174000"),
    true,
  );
  assert.equal(isCanonicalWebsiteProjectId("legacy-site-7"), false);
  for (const path of [
    ".git/config",
    ".next/server/app.js",
    "node_modules/react/index.js",
    ".env",
    ".env.production",
    "components/oceanleo-dev-bridge.tsx",
    "../secret",
    "/etc/passwd",
  ]) {
    assert.equal(safeWebsiteSourcePath(path), null, path);
  }
  assert.equal(safeWebsiteSourcePath("app/page.tsx"), "app/page.tsx");
  assert.equal(normalizeWebsitePreviewRoute("pricing?plan=pro"), "/pricing?plan=pro");
  assert.equal(normalizeWebsitePreviewRoute("javascript:alert(1)"), null);
  assert.equal(normalizeWebsitePreviewRoute("//evil.example/path"), null);
  assert.equal(
    WEBSITE_PROJECT_API_PATHS.sourceTransactions(
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    "/v1/website-projects/123e4567-e89b-42d3-a456-426614174000/source/transactions",
  );
  assert.equal(
    WEBSITE_PROJECT_API_PATHS.restoreRevision("project/a", "revision/b"),
    "/v1/website-projects/project%2Fa/revisions/revision%2Fb/restore",
  );
  assert.equal(
    WEBSITE_PROJECT_API_PATHS.byArtifact(
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    "/v1/website-projects/by-artifact/123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(
    WEBSITE_PROJECT_API_PATHS.artifactLink(
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    "/v1/website-projects/123e4567-e89b-42d3-a456-426614174000/artifact-link",
  );
});
