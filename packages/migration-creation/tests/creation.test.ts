import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";
import type { ReactElement } from "react";

import { CREATION_INVENTORY } from "../src/inventory";
import { CREATION_PLUGIN_BATCH } from "../src/plugins";
import {
  CREATION_PROTOCOLS,
  type CreationSiteKey,
} from "../src/protocols";

const dispatcher = createPluginDispatcher("standard", [
  CREATION_PLUGIN_BATCH,
]);

function tenant(siteKey: CreationSiteKey) {
  const resolved = tenantForSiteKey(siteKey);
  if (!resolved) throw new Error(`Missing test tenant ${siteKey}.`);
  return resolved;
}

async function dispatchPage(siteKey: CreationSiteKey, path: `/${string}`) {
  const resolved = tenant(siteKey);
  const url = new URL(path, `https://${resolved.canonicalHost}`);
  return dispatcher.dispatch({
    tenant: resolved,
    pathname: url.pathname as `/${string}`,
    surface: "page",
    request: new Request(url),
  });
}

function pageProps(
  result: Awaited<ReturnType<typeof dispatchPage>>,
): Record<string, unknown> {
  if (result.kind !== "page") {
    throw new Error(`Expected page result, received ${result.kind}.`);
  }
  const element = result.node as ReactElement<Record<string, unknown>>;
  assert.equal(element.type, "main");
  return element.props;
}

async function dispatchUpload(request: Request) {
  const resolved = tenant("ecommerce");
  return dispatcher.dispatch({
    tenant: resolved,
    pathname: "/api/upload",
    surface: "api",
    request,
  });
}

function responseFrom(
  result: Awaited<ReturnType<typeof dispatchUpload>>,
): Response {
  if (result.kind !== "response") {
    throw new Error(`Expected response result, received ${result.kind}.`);
  }
  return result.response;
}

function withUploadEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const priorGateway = process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
  process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = "https://gateway.creation.test";
  return callback().finally(() => {
    if (priorGateway === undefined) {
      delete process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
    } else {
      process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = priorGateway;
    }
  });
}

function authUploadRequest(body: BodyInit | null): Request {
  return new Request("https://e-commerce.oceanleo.com/api/upload", {
    method: "POST",
    headers: { Authorization: "Bearer ecommerce-token" },
    body,
  });
}

test("creation owns five executable plugin definitions and 52 verified routes", () => {
  assert.deepEqual(
    CREATION_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["ecommerce", "novel", "script", "design", "make"],
  );
  assert.deepEqual(
    CREATION_PLUGIN_BATCH.plugins.map((plugin) => plugin.id),
    [
      "ecommerce-asset-studio",
      "novel-workbench",
      "script-workbench",
      "design-canvas",
      "custom-commerce-workbench",
    ],
  );
  assert.deepEqual(
    CREATION_PLUGIN_BATCH.plugins.map((plugin) => plugin.routes.length),
    [7, 11, 10, 13, 11],
  );
  const routes = CREATION_PLUGIN_BATCH.plugins.flatMap(
    (plugin) => plugin.routes,
  );
  assert.equal(routes.length, 52);
  assert.ok(
    routes.every(
      (route) =>
        route.parity.status === "verified" &&
        route.parity.evidence.includes(
          "packages/migration-creation/tests/creation.test.ts",
        ) &&
        (route.kind === "redirect" || typeof route.handler === "function"),
    ),
  );

  assert.equal(CREATION_INVENTORY.batchId, "creation");
  assert.equal(CREATION_INVENTORY.ownerPath, "packages/migration-creation");
  assert.equal(CREATION_INVENTORY.entries.length, 57);
  assert.equal(
    CREATION_INVENTORY.entries.filter(
      (entry) => entry.kind === "plugin-extension",
    ).length,
    5,
  );
  assert.equal(
    CREATION_INVENTORY.entries.filter(
      (entry) => entry.kind !== "plugin-extension",
    ).length,
    routes.length,
  );
  assert.ok(
    CREATION_INVENTORY.entries.every(
      (entry) =>
        entry.parity.status === "verified" &&
        entry.parity.evidence.length > 0,
    ),
  );
  assert.equal(
    CREATION_INVENTORY.entries.filter(
      (entry) =>
        entry.parity.status === "pending" ||
        entry.parity.status === "partial",
    ).length,
    0,
  );
});

test("catalog evidence retains source app counts, engines, and artifact types", () => {
  assert.deepEqual(
    Object.values(CREATION_PROTOCOLS).map((protocol) => [
      protocol.siteKey,
      protocol.catalog.length,
    ]),
    [
      ["ecommerce", 20],
      ["novel", 21],
      ["script", 19],
      ["design", 22],
      ["make", 20],
    ],
  );
  assert.equal(
    Object.values(CREATION_PROTOCOLS).reduce(
      (count, protocol) => count + protocol.catalog.length,
      0,
    ),
    102,
  );
  assert.deepEqual(CREATION_PROTOCOLS.ecommerce.artifactTypes, [
    "single_file_image",
    "document",
  ]);
  assert.deepEqual(CREATION_PROTOCOLS.novel.artifactTypes, ["document"]);
  assert.deepEqual(CREATION_PROTOCOLS.script.artifactTypes, ["document"]);
  assert.deepEqual(CREATION_PROTOCOLS.design.artifactTypes, [
    "composite_image",
  ]);
  assert.deepEqual(CREATION_PROTOCOLS.make.artifactTypes, ["workflow"]);
  assert.equal(
    CREATION_PROTOCOLS.design.editor?.projectSchema,
    "oceanleo.design-document.v1",
  );
  assert.equal(
    CREATION_PROTOCOLS.design.template.documentUrlPattern,
    "https://asset.oceanleo.com/design-templates/doc/<templateId>.json",
  );
  assert.equal(CREATION_PROTOCOLS.script.template.id, "script.quick-template.v1");
  assert.equal(CREATION_PROTOCOLS.ecommerce.upload?.maxBytes, 12 * 1024 * 1024);
});

test("canonical workspace routes preserve app and query context", async () => {
  const cases = [
    ["ecommerce", "/workspace/white-bg", "white-bg"],
    ["novel", "/workspace?fn=outline&embed=1", "outline"],
    ["script", "/workspace/screenplay", "screenplay"],
    ["design", "/workspace/canvas-editor", "canvas-editor"],
    ["make", "/workspace/tshirt", "tshirt"],
  ] as const;

  for (const [siteKey, path, appId] of cases) {
    const props = pageProps(await dispatchPage(siteKey, path));
    assert.equal(props["data-site-key"], siteKey);
    assert.equal(props["data-selected-app"], appId);
    assert.equal(props["data-app-known"], "true");
    assert.equal(
      props["data-context-id"],
      `olctx:v1:${siteKey}:app:${appId}`,
    );
  }

  const novel = pageProps(
    await dispatchPage("novel", "/workspace?fn=outline&embed=1"),
  );
  assert.equal(novel["data-query"], "fn=outline&embed=1");
});

test("specialized editor, template, project, and commerce routes dispatch", async () => {
  const ecommerce = pageProps(
    await dispatchPage("ecommerce", "/tools/cutout"),
  );
  assert.equal(ecommerce["data-creation-surface"], "legacy-editor");
  assert.equal(ecommerce["data-selected-app"], "cutout");
  assert.equal(ecommerce["data-artifact-types"], "single_file_image,document");

  const novel = pageProps(
    await dispatchPage("novel", "/novel/editor/novel-1"),
  );
  assert.equal(novel["data-creation-surface"], "legacy-editor");
  assert.equal(novel["data-unmatched-path"], "editor/novel-1");

  const script = pageProps(
    await dispatchPage("script", "/p/project-1/scripts/script-2"),
  );
  assert.equal(script["data-creation-surface"], "project-editor");
  assert.equal(script["data-unmatched-path"], "project-1/scripts/script-2");

  const design = pageProps(
    await dispatchPage("design", "/embed/editor?instanceId=editor-1"),
  );
  assert.equal(design["data-creation-surface"], "design-editor");
  assert.equal(design["data-editor-protocol"], "oceanleo.editor.v1");
  assert.equal(design["data-selected-app"], "canvas-editor");

  const make = pageProps(await dispatchPage("make", "/mall/sku-1"));
  assert.equal(make["data-creation-surface"], "commerce");
  assert.equal(make["data-unmatched-path"], "sku-1");
  assert.equal(make["data-template-protocol"], "asset.design-template-document.v1");
});

test("unowned paths stay 404 and the wrong profile stays 421", async () => {
  assert.deepEqual(await dispatchPage("design", "/unowned"), {
    kind: "not-found",
    status: 404,
  });

  const website = tenantForSiteKey("website");
  assert.ok(website);
  assert.deepEqual(
    await dispatcher.dispatch({
      tenant: website,
      pathname: "/workspace",
      surface: "page",
      request: new Request("https://website.oceanleo.com/workspace"),
    }),
    { kind: "misdirected", status: 421 },
  );
});

test("ecommerce upload keeps missing-file and 12MB limit semantics", async () => {
  await withUploadEnvironment(async () => {
    const missingResponse = responseFrom(
      await dispatchUpload(authUploadRequest(new FormData())),
    );
    assert.equal(missingResponse.status, 400);
    assert.deepEqual(await missingResponse.json(), { error: "缺少文件。" });

    const oversized = new FormData();
    oversized.set(
      "file",
      new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
    );
    const oversizedResponse = responseFrom(
      await dispatchUpload(authUploadRequest(oversized)),
    );
    assert.equal(oversizedResponse.status, 413);
    assert.deepEqual(await oversizedResponse.json(), {
      error: "文件过大（上限 12MB）。",
    });
  });
});

test("ecommerce upload stores through authenticated gateway direct upload", async () => {
  await withUploadEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      seen.push(url);
      if (url === "https://gateway.creation.test/v1/media/upload/init") {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer ecommerce-token",
        );
        return Response.json({
          path: "u/user/ecommerce/product.png",
          signed_url: "https://storage.creation.test/signed-upload",
        });
      }
      if (url === "https://storage.creation.test/signed-upload") {
        assert.equal(init?.method, "PUT");
        return new Response(null, { status: 200 });
      }
      if (url === "https://gateway.creation.test/v1/media/upload/finalize") {
        return Response.json({
          file: {
            url: "https://storage.creation.test/public/media-uploads/leostudio/product.png",
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "product.PNG", {
          type: "image/png",
        }),
      );
      const response = responseFrom(await dispatchUpload(authUploadRequest(form)));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        url: "https://storage.creation.test/public/media-uploads/leostudio/product.png",
      });
      assert.deepEqual(seen, [
        "https://gateway.creation.test/v1/media/upload/init",
        "https://storage.creation.test/signed-upload",
        "https://gateway.creation.test/v1/media/upload/finalize",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("ecommerce upload requires bearer authentication before any network call", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("should not fetch");
  }) as typeof fetch;
  try {
    const response = responseFrom(
      await dispatchUpload(
        new Request("https://e-commerce.oceanleo.com/api/upload", {
          method: "POST",
          body: new FormData(),
        }),
      ),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "请先登录 OceanLeo 账号后再上传。",
    });
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
