import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";
import { isValidElement, type ReactElement } from "react";

import { MEDIA_INVENTORY } from "../src/inventory";
import { MEDIA_PLUGIN_BATCH } from "../src/plugins";

const dispatcher = createPluginDispatcher("standard", [MEDIA_PLUGIN_BATCH]);
const AIHUMAN_FEATURE_SLUGS = [
  "ai-script",
  "smart-edit",
  "photo-talk",
  "batch-gen",
  "script-mimic",
] as const;
const INTERIOR_TOOL_SLUGS = [
  "redesign",
  "lookbook",
  "concept",
  "model",
  "decorate",
  "remove-object",
  "cutout",
  "material",
] as const;

function mediaTenant(siteKey: string) {
  const tenant = tenantForSiteKey(siteKey);
  assert.ok(tenant, `missing media tenant ${siteKey}`);
  return tenant;
}

function dispatch(
  siteKey: string,
  pathname: `/${string}`,
  options: Readonly<{
    host?: string;
    method?: string;
    search?: string;
    surface?: "page" | "api";
  }> = {},
) {
  const tenant = mediaTenant(siteKey);
  const host = options.host ?? tenant.canonicalHost;
  return dispatcher.dispatch({
    tenant,
    pathname,
    surface: options.surface ?? "page",
    request: new Request(
      `https://${host}${pathname}${options.search ?? ""}`,
      {
        method: options.method ?? "GET",
        headers: { Host: host },
      },
    ),
  });
}

test("media inventories six specialized plugins and every declared route", () => {
  assert.deepEqual(
    MEDIA_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["aihuman", "image", "video", "logo", "interior", "threed"],
  );
  assert.equal(MEDIA_INVENTORY.batchId, "media");
  assert.equal(MEDIA_INVENTORY.ownerPath, "packages/migration-media");
  assert.deepEqual(MEDIA_INVENTORY.tenantKeys, [
    "aihuman",
    "image",
    "video",
    "logo",
    "interior",
    "threed",
  ]);

  const extensions = MEDIA_INVENTORY.entries.filter(
    (entry) => entry.kind === "plugin-extension",
  );
  const inventoryRoutes = MEDIA_INVENTORY.entries.filter(
    (entry) => entry.route !== null,
  );
  const pluginRoutes = MEDIA_PLUGIN_BATCH.plugins.flatMap((plugin) =>
    plugin.routes.map((route) => ({ plugin, route })),
  );

  assert.equal(extensions.length, 6);
  assert.equal(pluginRoutes.length, 60);
  // surface:"both" aliases emit distinct page+api inventory projections.
  assert.equal(inventoryRoutes.length, 64);
  assert.equal(MEDIA_INVENTORY.entries.length, 70);
  assert.ok(
    extensions.every(
      (entry) =>
        entry.parity.status === "partial" &&
        entry.parity.evidence.includes(
          "packages/migration-media/tests/media.test.ts",
        ),
    ),
  );

  for (const { plugin, route } of pluginRoutes) {
    const prefix = `route:standard:${plugin.siteKey}:${route.id}`;
    const matched = inventoryRoutes.filter(
      (candidate) =>
        candidate.id === prefix ||
        candidate.id === `${prefix}:page` ||
        candidate.id === `${prefix}:api`,
    );
    assert.ok(matched.length > 0, `missing inventory route ${route.id}`);
    for (const entry of matched) {
      assert.equal(entry.extensionId, plugin.id);
      assert.equal(entry.route, route.pattern);
      assert.deepEqual(entry.methods, route.methods);
      assert.deepEqual(entry.capabilities, [route.capability]);
      assert.deepEqual(entry.parity, route.parity);
    }
  }

  const routeStatusCounts = Object.fromEntries(
    ["pending", "partial", "verified"].map((status) => [
      status,
      inventoryRoutes.filter((entry) => entry.parity.status === status).length,
    ]),
  );
  assert.deepEqual(routeStatusCounts, {
    pending: 0,
    partial: 47,
    verified: 17,
  });
  assert.ok(
    inventoryRoutes
      .every((entry) => entry.parity.evidence.length > 0),
  );
  assert.ok(
    MEDIA_PLUGIN_BATCH.plugins
      .flatMap((plugin) => plugin.routes)
      .every(
        (route) =>
          route.parity.status !== "pending" &&
          (route.kind === "redirect" || route.handler !== undefined),
      ),
  );
});

test("all six canonical workspace routes dispatch active media pages", async () => {
  for (const siteKey of [
    "aihuman",
    "image",
    "video",
    "logo",
    "interior",
    "threed",
  ]) {
    const result = await dispatch(siteKey, "/workspace/catalog-item");
    assert.equal(result.kind, "page", `${siteKey} workspace was not active`);
    if (result.kind !== "page") continue;
    assert.ok(isValidElement(result.node));
    const node = result.node as ReactElement<Record<string, unknown>>;
    assert.equal(node.props["data-media-site"], siteKey);
    assert.equal(node.props["data-media-status"], "partial");
    assert.equal(
      node.props["data-route-params"],
      JSON.stringify({ path: ["catalog-item"] }),
    );
  }

  assert.equal(
    (await dispatch("image", "/workspace", { method: "HEAD" })).kind,
    "page",
  );
});

test("media aliases redirect exact hosts to canonical hosts and preserve URLs", async () => {
  const aliases = [
    {
      siteKey: "image",
      host: "myselfie.oceanleo.com",
      destination: "image.oceanleo.com",
    },
    {
      siteKey: "image",
      host: "remove.oceanleo.com",
      destination: "image.oceanleo.com",
    },
    {
      siteKey: "video",
      host: "studio.oceanleo.com",
      destination: "video.oceanleo.com",
    },
    {
      siteKey: "threed",
      host: "threed.oceanleo.com",
      destination: "3d.oceanleo.com",
    },
  ] as const;

  for (const alias of aliases) {
    assert.deepEqual(
      await dispatch(alias.siteKey, "/workspace/project-7", {
        host: alias.host,
        search: "?embed=1",
      }),
      {
        kind: "redirect",
        location: `https://${alias.destination}/workspace/project-7?embed=1`,
        status: 308,
      },
    );
  }

  assert.deepEqual(
    await dispatch("image", "/api/upload", {
      host: "remove.oceanleo.com",
      method: "POST",
      surface: "api",
    }),
    {
      kind: "redirect",
      location: "https://image.oceanleo.com/api/upload",
      status: 308,
    },
  );
});

test("legacy generation and editing paths redirect to canonical workbenches", async () => {
  const redirects = [
    ["aihuman", "/create", "/workspace?fn=create"],
    ["aihuman", "/quick", "/workspace?fn=quick"],
    ["aihuman", "/doc2video", "/workspace?fn=doc2video"],
    ["aihuman", "/customize", "/workspace?fn=customize"],
    ["aihuman", "/avatars", "/workspace?fn=create"],
    ["aihuman", "/voices", "/workspace?fn=create"],
    ["aihuman", "/scenes", "/workspace?fn=create"],
    ["aihuman", "/templates", "/workspace?fn=create"],
    ["aihuman", "/works", "/workspace?fn=create"],
    ["image", "/cutout", "/workspace?fn=cutout"],
    ["image", "/cutout/scenes", "/workspace?fn=cutout"],
    ["image", "/selfie", "/workspace?fn=selfie"],
    ["image", "/selfie/styles", "/workspace?fn=selfie"],
    ["image", "/lora", "/workspace?fn=selfie"],
    ["image", "/scenes", "/workspace?fn=studio"],
    ["video", "/canvas", "/workspace?fn=canvas"],
    ["video", "/workflows", "/workspace?fn=workflows"],
    ["video", "/studio", "/studio-editor"],
    ["logo", "/create", "/workspace?mode=create"],
    ["logo", "/icon", "/workspace?mode=icon"],
    ["logo", "/naming", "/workspace?mode=naming"],
    ["interior", "/inspiration", "/workspace?fn=redesign"],
    ["interior", "/styles", "/workspace?fn=redesign"],
    ["interior", "/tools", "/workspace?fn=redesign"],
    ["threed", "/create", "/"],
  ] as const;

  for (const [siteKey, pathname, destination] of redirects) {
    const tenant = mediaTenant(siteKey);
    assert.deepEqual(await dispatch(siteKey, pathname), {
      kind: "redirect",
      location: new URL(destination, `https://${tenant.canonicalHost}`).toString(),
      status: 307,
    });
  }

  for (const slug of AIHUMAN_FEATURE_SLUGS) {
    assert.deepEqual(await dispatch("aihuman", `/feature/${slug}`), {
      kind: "redirect",
      location: `https://aihuman.oceanleo.com/workspace?fn=${slug}`,
      status: 307,
    });
  }
  for (const slug of INTERIOR_TOOL_SLUGS) {
    assert.deepEqual(await dispatch("interior", `/tools/${slug}`), {
      kind: "redirect",
      location: `https://interior.oceanleo.com/workspace?fn=${slug}`,
      status: 307,
    });
  }
  assert.deepEqual(
    await dispatch("interior", "/tools/retired-tool"),
    {
      kind: "redirect",
      location: "https://interior.oceanleo.com/workspace?fn=redesign",
      status: 307,
    },
  );
  assert.deepEqual(await dispatch("aihuman", "/feature/not-registered"), {
    kind: "not-found",
    status: 404,
  });
});

test("editor-specific pages and all nine API protocols are active", async () => {
  for (const pathname of ["/canvas-board", "/studio-editor"] as const) {
    const result = await dispatch("video", pathname);
    assert.equal(result.kind, "page");
    if (result.kind === "page") assert.ok(isValidElement(result.node));
  }

  const apiRouteIds = MEDIA_PLUGIN_BATCH.plugins
    .flatMap((plugin) => plugin.routes)
    .filter((route) => route.kind === "api")
    .map((route) => route.id)
    .sort();
  assert.deepEqual(apiRouteIds, [
    "aihuman.upload",
    "image.fetch-image",
    "image.upload",
    "interior.upload",
    "logo.fetch-image",
    "threed.upload",
    "video.canvas-api",
    "video.upload",
    "video.upload-video",
  ]);
  assert.ok(
    MEDIA_PLUGIN_BATCH.plugins
      .flatMap((plugin) => plugin.routes)
      .filter((route) => route.kind === "api")
      .every(
        (route) =>
          route.parity.status === "verified" &&
          route.handler !== undefined,
      ),
  );

  assert.deepEqual(
    await dispatch("image", "/api/upload", {
      method: "GET",
      surface: "api",
    }),
    { kind: "not-found", status: 404 },
  );
  assert.deepEqual(
    await dispatch("image", "/unowned"),
    { kind: "not-found", status: 404 },
  );
});
