import assert from "node:assert/strict";
import test from "node:test";

import { isValidElement } from "react";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import {
  PLATFORM_ELEMENT_EFFECTS,
  PLATFORM_TEMPLATE_COUNT,
  PLATFORM_TEMPLATE_SUBCATEGORIES,
  handleElementDocumentRequest,
  handleFaviconProxyRequest,
  handleTemplateDocumentRequest,
  handleTrialChatRequest,
  resetPlatformApiStateForTests,
  type PlatformFetch,
} from "../src/api-handlers";
import { PLATFORM_INVENTORY } from "../src/inventory";
import {
  legacyRedirectLocation,
  type PlatformPageProps,
} from "../src/platform-page";
import { PLATFORM_PLUGIN_BATCH } from "../src/plugins";
import {
  PLATFORM_ALIAS_CONTRACTS,
  PLATFORM_DECLARED_ROUTE_COUNT,
  PLATFORM_LEGACY_ROOT_COUNT,
  PLATFORM_PARITY_EVIDENCE,
  PLATFORM_TENANT_CONTRACTS,
  type PlatformSiteKey,
} from "../src/source-parity";

const EXPECTED_PATTERNS: Readonly<Record<PlatformSiteKey, readonly string[]>> = {
  agent: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/cost",
    "/database",
    "/explore",
    "/general",
    "/history",
    "/history/:sessionId",
    "/library",
    "/plugins",
    "/settings",
    "/workspace",
    "/workspace/free",
    "/workspace/expert/:id",
    "/workspace/team/:id",
  ],
  chat: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/cost",
    "/database",
    "/explore",
    "/general",
    "/history",
    "/history/:sessionId",
    "/library",
    "/plugins",
    "/settings",
    "/personas",
    "/workspace",
    "/workspace/:appId",
    "/api/trial-chat",
  ],
  music: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/cost",
    "/database",
    "/explore",
    "/general",
    "/history",
    "/history/:sessionId",
    "/library",
    "/plugins",
    "/settings",
    "/lyrics",
    "/mv",
    "/usage",
    "/works",
    "/workspace",
    "/workspace/:appId",
  ],
  search: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/cost",
    "/database",
    "/explore",
    "/general",
    "/history",
    "/history/:sessionId",
    "/library",
    "/plugins",
    "/settings",
    "/search",
    "/workspace",
    "/workspace/:appId",
  ],
  money: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/cost",
    "/database",
    "/explore",
    "/general",
    "/history",
    "/history/:sessionId",
    "/library",
    "/plugins",
    "/settings",
    "/tools",
    "/workspace",
    "/workspace/:appId",
  ],
  aitools: [
    "/advanced",
    "/advanced/:feature",
    "/all",
    "/category/:slug",
    "/api/icon",
  ],
  asset: [
    "/account",
    "/advanced",
    "/advanced/:feature",
    "/developer-api",
    "/api-guide",
    "/collection",
    "/cost",
    "/database",
    "/design",
    "/elements",
    "/general",
    "/licenses",
    "/materials",
    "/open",
    "/plugins",
    "/series",
    "/settings",
    "/templates",
    "/api/elements/:fx",
    "/api/templates/:slug",
  ],
  game: ["/advanced", "/advanced/:feature", "/play/:slug"],
};

const LEGACY_API_GUIDE_REDIRECT_SITES = [
  "agent",
  "chat",
  "music",
  "search",
  "money",
  "asset",
] as const satisfies readonly PlatformSiteKey[];

const HOSTS: Readonly<Record<PlatformSiteKey, string>> = {
  agent: "agent.oceanleo.com",
  chat: "chat.oceanleo.com",
  music: "music.oceanleo.com",
  search: "search.oceanleo.com",
  money: "money.oceanleo.com",
  aitools: "aitools.oceanleo.com",
  asset: "asset.oceanleo.com",
  game: "game.oceanleo.com",
};

const dispatcher = createPluginDispatcher("standard", [PLATFORM_PLUGIN_BATCH]);

async function dispatchPage(
  siteKey: PlatformSiteKey,
  pathname: `/${string}`,
  search = "",
) {
  const tenant = tenantForSiteKey(siteKey);
  assert.ok(tenant);
  return dispatcher.dispatch({
    tenant,
    pathname,
    surface: "page",
    request: new Request(`https://${HOSTS[siteKey]}${pathname}${search}`, {
      headers: { Host: HOSTS[siteKey] },
    }),
  });
}

async function dispatchApi(
  siteKey: PlatformSiteKey,
  pathname: `/${string}`,
) {
  const tenant = tenantForSiteKey(siteKey);
  assert.ok(tenant);
  return dispatcher.dispatch({
    tenant,
    pathname,
    surface: "api",
    request: new Request(`https://${HOSTS[siteKey]}${pathname}`, {
      headers: { Host: HOSTS[siteKey] },
    }),
  });
}

test("platform declares the complete TSV-resolved route surface", () => {
  assert.deepEqual(
    PLATFORM_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["agent", "chat", "music", "search", "money", "aitools", "asset", "game"],
  );
  assert.equal(PLATFORM_LEGACY_ROOT_COUNT, 8);
  assert.equal(PLATFORM_DECLARED_ROUTE_COUNT, 119);
  // Tenant contracts + alias (119) plus legacy /api/guide redirects on the
  // API surface for the six shells that expose /api-guide pages (+6).
  // Bare /api cannot mount on either catch-all, so it is not redirected.
  assert.equal(
    PLATFORM_PLUGIN_BATCH.plugins.reduce(
      (total, plugin) => total + plugin.routes.length,
      0,
    ),
    125,
  );

  for (const tenant of PLATFORM_TENANT_CONTRACTS) {
    assert.equal(tenant.repository, tenant.siteKey);
    assert.equal(tenant.frontend, ".");
    assert.equal(tenant.tsvPush, "git");
    assert.equal(tenant.publicRead, true);
    assert.equal(tenant.rootOwner, "standard-foundation");
    assert.deepEqual(
      tenant.routes.map((route) => route.pattern),
      EXPECTED_PATTERNS[tenant.siteKey],
    );
  }

  assert.deepEqual(
    PLATFORM_ALIAS_CONTRACTS.map((alias) => [
      alias.sourceHost,
      alias.destinationHost,
    ]),
    [["skill.oceanleo.com", "agent.oceanleo.com"]],
  );
});

test("utility shells preserve public-read, SSO, and credit differences", () => {
  const contracts = new Map(
    PLATFORM_TENANT_CONTRACTS.map((tenant) => [tenant.siteKey, tenant]),
  );
  assert.deepEqual(
    PLATFORM_TENANT_CONTRACTS.filter(
      (tenant) => tenant.shellMode === "utility",
    ).map((tenant) => tenant.siteKey),
    ["aitools", "asset", "game"],
  );
  assert.equal(contracts.get("aitools")?.sso, "none");
  assert.equal(contracts.get("aitools")?.actionAuth, "none");
  assert.equal(contracts.get("asset")?.sso, "optional-refresh");
  assert.equal(contracts.get("asset")?.actionAuth, "on-mutating-action");
  assert.equal(contracts.get("game")?.sso, "optional-refresh");
  assert.equal(contracts.get("game")?.actionAuth, "on-mutating-action");
  assert.ok(
    PLATFORM_TENANT_CONTRACTS.filter(
      (tenant) => tenant.shellMode === "utility",
    ).every((tenant) => tenant.credits === "disabled"),
  );
  assert.ok(
    PLATFORM_TENANT_CONTRACTS.filter(
      (tenant) => tenant.shellMode === "standard",
    ).every(
      (tenant) =>
        tenant.sso === "optional-refresh" &&
        tenant.actionAuth === "on-ai-action" &&
        tenant.credits === "shared-account",
    ),
  );
});

test("every plugin route and inventory entry is active and evidenced", () => {
  assert.equal(PLATFORM_INVENTORY.batchId, "platform");
  assert.equal(PLATFORM_INVENTORY.ownerPath, "packages/migration-platform");
  assert.equal(PLATFORM_INVENTORY.entries.length, 134);
  assert.equal(
    PLATFORM_INVENTORY.entries.filter(
      (entry) => entry.kind === "plugin-extension",
    ).length,
    8,
  );
  assert.equal(
    PLATFORM_INVENTORY.entries.filter(
      (entry) => entry.kind !== "plugin-extension",
    ).length,
    126,
  );
  assert.ok(
    PLATFORM_INVENTORY.entries.every(
      (entry) =>
        entry.parity.status === "verified" &&
        entry.parity.evidence.length >= 2 &&
        entry.parity.evidence.every((path) =>
          path.startsWith("packages/migration-platform/"),
        ),
    ),
  );
  assert.equal(
    PLATFORM_INVENTORY.entries.filter(
      (entry) => entry.parity.status === "pending",
    ).length,
    0,
  );
  assert.equal(
    PLATFORM_INVENTORY.entries.filter(
      (entry) => entry.parity.status === "partial",
    ).length,
    0,
  );

  for (const plugin of PLATFORM_PLUGIN_BATCH.plugins) {
    for (const route of plugin.routes) {
      assert.equal(route.parity.status, "verified");
      assert.deepEqual(route.parity.evidence, PLATFORM_PARITY_EVIDENCE);
      if (route.kind === "redirect") assert.ok(route.redirect);
      else assert.equal(typeof route.handler, "function");
    }
  }

  assert.ok(
    PLATFORM_INVENTORY.entries
      .filter(
        (entry) =>
          entry.kind !== "plugin-extension" &&
          entry.route === "/api/guide" &&
          entry.methods.includes("*"),
      )
      .every((entry) => entry.kind === "route-handler"),
  );
  assert.ok(
    PLATFORM_INVENTORY.entries.some(
      (entry) =>
        entry.route === "/:path*" &&
        entry.methods.includes("*") &&
        entry.kind === "route-handler",
    ),
  );
});

test("representative page routes dispatch real React pages for all tenants", async () => {
  const examples: readonly [
    PlatformSiteKey,
    `/${string}`,
    string,
  ][] = [
    ["agent", "/workspace/expert/senior-engineer", "agent.page.workspace-expert"],
    ["chat", "/workspace/chat", "chat.page.workspace-app"],
    ["music", "/workspace/song", "music.page.workspace-app"],
    ["search", "/workspace/research", "search.page.workspace-app"],
    ["money", "/workspace/calc", "money.page.workspace-app"],
    ["aitools", "/category/library", "aitools.page.category"],
    ["asset", "/materials", "asset.page.materials"],
    ["game", "/play/snake", "game.page.play"],
    ["agent", "/developer-api", "agent.page.api"],
    ["asset", "/api-guide", "asset.page.api-guide"],
  ];

  for (const [siteKey, pathname, routeId] of examples) {
    const result = await dispatchPage(siteKey, pathname);
    assert.equal(result.kind, "page", `${siteKey} ${pathname}`);
    if (result.kind !== "page") continue;
    assert.ok(isValidElement(result.node));
    const props = result.node.props as PlatformPageProps;
    assert.equal(props.tenant.siteKey, siteKey);
    assert.equal(props.route.id, routeId);
    assert.equal(props.requestUrl, `https://${HOSTS[siteKey]}${pathname}`);
  }

  assert.deepEqual(await dispatchPage("agent", "/unowned"), {
    kind: "not-found",
    status: 404,
  });
});

test("legacy /api/guide permanently redirects to /api-guide on the API surface", async () => {
  for (const siteKey of LEGACY_API_GUIDE_REDIRECT_SITES) {
    assert.deepEqual(
      await dispatchApi(siteKey, "/api/guide"),
      {
        kind: "redirect",
        location: `https://${HOSTS[siteKey]}/api-guide`,
        status: 308,
      },
      `${siteKey} /api/guide`,
    );
  }
});

test("skill host alias is exact, permanent, and preserves deep links", async () => {
  const tenant = tenantForSiteKey("agent");
  assert.ok(tenant);
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant,
      pathname: "/workspace/expert/reviewer",
      surface: "page",
      request: new Request(
        "https://skill.oceanleo.com/workspace/expert/reviewer?mode=deep",
        { headers: { Host: "skill.oceanleo.com" } },
      ),
    }),
    {
      kind: "redirect",
      location:
        "https://agent.oceanleo.com/workspace/expert/reviewer?mode=deep",
      status: 308,
    },
  );
});

test("retired platform pages preserve their legacy workspace deep links", () => {
  const byId = new Map(
    PLATFORM_TENANT_CONTRACTS.flatMap((tenant) =>
      tenant.routes
        .filter((route) => route.kind === "page")
        .map((route) => [route.id, route] as const),
    ),
  );
  const lyrics = byId.get("music.page.lyrics");
  const search = byId.get("search.page.legacy-search");
  const tools = byId.get("money.page.tools");
  assert.ok(lyrics?.kind === "page");
  assert.ok(search?.kind === "page");
  assert.ok(tools?.kind === "page");
  assert.equal(
    legacyRedirectLocation(
      lyrics,
      "https://music.oceanleo.com/lyrics?lang=en&share=7",
    ),
    "/workspace?fn=lyrics&lang=en&share=7",
  );
  assert.equal(
    legacyRedirectLocation(
      search,
      "https://search.oceanleo.com/search?q=oceans&depth=advanced&drop=1",
    ),
    "/workspace?q=oceans&depth=advanced",
  );
  assert.equal(
    legacyRedirectLocation(
      search,
      "https://search.oceanleo.com/search?depth=advanced",
    ),
    "/workspace?fn=search",
  );
  assert.equal(
    legacyRedirectLocation(
      tools,
      "https://money.oceanleo.com/tools?ignored=1",
    ),
    "/workspace?fn=calc",
  );
});

test("trial chat validates, rate-limits, and streams the constrained gateway envelope", async () => {
  resetPlatformApiStateForTests();
  const missing = await handleTrialChatRequest(
    new Request("https://chat.oceanleo.com/api/trial-chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    { environment: {} },
  );
  assert.equal(missing.status, 503);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: PlatformFetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/auth/v1/token")) {
      return Response.json({ access_token: "test-token", expires_in: 3_600 });
    }
    return new Response("data: ok\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const messages = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `message-${index}`,
  }));
  const streamed = await handleTrialChatRequest(
    new Request("https://chat.oceanleo.com/api/trial-chat", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({
        provider: "unsafe-provider",
        model: "not-allowed",
        messages,
      }),
    }),
    {
      environment: {
        NEXT_PUBLIC_OCEANLEO_ANON_KEY: "anon",
        NEXT_PUBLIC_OCEANLEO_GATEWAY_URL: "https://api.oceanleo.test",
        NEXT_PUBLIC_OCEANLEO_SUPABASE_URL: "https://auth.oceanleo.test",
        TRIAL_CHAT_EMAIL: "trial@example.test",
        TRIAL_CHAT_PASSWORD: "secret",
      },
      fetcher,
      now: () => 1_000,
    },
  );
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get("content-type"), "text/event-stream");
  assert.equal(streamed.headers.get("cache-control"), "no-store");
  assert.equal(await streamed.text(), "data: ok\n\n");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api.oceanleo.test/v1/chat/stream");
  const upstreamBody = JSON.parse(String(calls[1]?.init?.body)) as {
    provider: string;
    model: string;
    messages: Array<{ content: string }>;
    max_tokens: number;
  };
  assert.equal(upstreamBody.provider, "bailian");
  assert.equal(upstreamBody.model, "qwen-plus");
  assert.equal(upstreamBody.max_tokens, 1_024);
  assert.deepEqual(
    upstreamBody.messages.map((message) => message.content),
    messages.slice(-6).map((message) => message.content),
  );
  resetPlatformApiStateForTests();
});

test("AI-tools icon proxy keeps public cache semantics and blocks local hosts", async () => {
  const fetched: string[] = [];
  const hit = await handleFaviconProxyRequest(
    new Request(
      "https://aitools.oceanleo.com/api/icon?domain=docs.example.co.uk",
    ),
    async (input) => {
      fetched.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    },
  );
  assert.equal(hit.status, 200);
  assert.equal(fetched[0], "https://icons.duckduckgo.com/ip3/example.co.uk.ico");
  assert.equal(hit.headers.get("content-type"), "image/png");
  assert.match(hit.headers.get("cache-control") ?? "", /s-maxage=604800/);

  let unsafeFetches = 0;
  const blocked = await handleFaviconProxyRequest(
    new Request("https://aitools.oceanleo.com/api/icon?domain=127.0.0.1"),
    async () => {
      unsafeFetches += 1;
      return new Response();
    },
  );
  assert.equal(blocked.status, 404);
  assert.equal(unsafeFetches, 0);
});

test("asset document handlers preserve exact catalog counts and download envelopes", async () => {
  assert.equal(PLATFORM_ELEMENT_EFFECTS.length, 17);
  assert.equal(PLATFORM_TEMPLATE_SUBCATEGORIES.length, 105);
  assert.equal(PLATFORM_TEMPLATE_COUNT, 500);

  const element = handleElementDocumentRequest(
    new Request(
      "https://asset.oceanleo.com/elements/aurora?lang=en&chrome=0",
    ),
    { fx: "aurora" },
  );
  assert.equal(element.status, 200);
  assert.equal(element.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await element.text(), /aurora effect/);
  assert.equal(
    handleElementDocumentRequest(
      new Request("https://asset.oceanleo.com/elements/not-real"),
      { fx: "not-real" },
    ).status,
    404,
  );

  const template = handleTemplateDocumentRequest(
    new Request(
      "https://asset.oceanleo.com/templates/finance-1?lang=en&download=1",
    ),
    { slug: "finance-1" },
  );
  assert.equal(template.status, 200);
  assert.equal(
    template.headers.get("content-disposition"),
    'attachment; filename="finance-1.html"',
  );
  assert.match(await template.text(), /finance template 1/);
  assert.equal(
    handleTemplateDocumentRequest(
      new Request("https://asset.oceanleo.com/templates/finance-99"),
      { slug: "finance-99" },
    ).status,
    404,
  );
});

test("public API routes dispatch as responses instead of pending stubs", async () => {
  const aitools = tenantForSiteKey("aitools");
  const asset = tenantForSiteKey("asset");
  assert.ok(aitools);
  assert.ok(asset);

  const icon = await dispatcher.dispatch({
    tenant: aitools,
    pathname: "/api/icon",
    surface: "api",
    request: new Request("https://aitools.oceanleo.com/api/icon"),
  });
  assert.equal(icon.kind, "response");
  if (icon.kind === "response") assert.equal(icon.response.status, 404);

  const element = await dispatcher.dispatch({
    tenant: asset,
    pathname: "/api/elements/aurora",
    surface: "api",
    request: new Request("https://asset.oceanleo.com/api/elements/aurora"),
  });
  assert.equal(element.kind, "response");
  if (element.kind === "response") assert.equal(element.response.status, 200);
});
