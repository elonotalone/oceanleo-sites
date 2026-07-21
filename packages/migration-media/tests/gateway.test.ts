import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import {
  resolveGatewayBase,
  validateUploadMetadata,
  type UploadContract,
} from "../src/gateway";
import { MEDIA_PLUGIN_BATCH } from "../src/plugins";

const dispatcher = createPluginDispatcher("standard", [MEDIA_PLUGIN_BATCH]);
const TEST_GATEWAY = "https://gateway.media.test";

function tenant(siteKey: string) {
  const resolved = tenantForSiteKey(siteKey);
  assert.ok(resolved);
  return resolved;
}

async function dispatchApi(
  siteKey: string,
  pathname: `/${string}`,
  options: Readonly<{
    method?: string;
    search?: string;
    authorization?: string;
    body?: BodyInit;
    contentType?: string;
  }> = {},
): Promise<Response> {
  const resolved = tenant(siteKey);
  const headers = new Headers({ Host: resolved.canonicalHost });
  if (options.authorization) {
    headers.set("Authorization", options.authorization);
  }
  if (options.contentType) {
    headers.set("Content-Type", options.contentType);
  }
  const result = await dispatcher.dispatch({
    tenant: resolved,
    pathname,
    surface: "api",
    request: new Request(
      `https://${resolved.canonicalHost}${pathname}${options.search ?? ""}`,
      {
        method: options.method ?? "GET",
        headers,
        body: options.body,
      },
    ),
  });
  assert.equal(result.kind, "response");
  if (result.kind !== "response") {
    throw new Error(`${siteKey}${pathname} did not return a response`);
  }
  return result.response;
}

function formWithFile(
  name: string,
  type: string,
  content: BlobPart = "media",
): FormData {
  const form = new FormData();
  form.set("file", new File([content], name, { type }));
  return form;
}

async function withGatewayEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
  process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = TEST_GATEWAY;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
    } else {
      process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = previous;
    }
  }
}

async function withMockedFetch<T>(
  implementation: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

test("gateway selection reads only the approved public gateway setting", async () => {
  const reads: PropertyKey[] = [];
  const environment = new Proxy(
    { NEXT_PUBLIC_OCEANLEO_GATEWAY_URL: "https://custom.gateway.test/" },
    {
      get(target, property, receiver) {
        reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    },
  );
  assert.equal(resolveGatewayBase(environment), "https://custom.gateway.test");
  assert.deepEqual(reads, ["NEXT_PUBLIC_OCEANLEO_GATEWAY_URL"]);
  assert.equal(
    resolveGatewayBase({
      NEXT_PUBLIC_OCEANLEO_GATEWAY_URL: "http://unsafe.gateway.test",
    }),
    "https://api.oceanleo.com",
  );

  const forbidden = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
  const legacyGatewaySetting = ["NEXT", "PUBLIC", "GATEWAY", "URL"].join("_");
  for (const relativePath of [
    "../src/gateway.ts",
    "../src/video-canvas.ts",
    "../src/plugins.ts",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.equal(source.includes(forbidden), false);
    assert.equal(source.includes(legacyGatewaySetting), false);
  }
});

test("scratch upload forwards bearer through init and finalize around signed PUT", async () => {
  const calls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input, init) => {
        const url = requestUrl(input);
        calls.push({ url, init });
        if (url === `${TEST_GATEWAY}/v1/media/upload/init`) {
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer media-token",
          );
          assert.deepEqual(jsonBody(init), {
            filename: "reference.png",
            content_type: "image/png",
            bytes: 5,
            site_id: "image",
            title: "reference.png",
            register_asset: false,
          });
          return Response.json({
            path: "u/user/image/reference.png",
            signed_url: "https://storage.media.test/signed-upload",
          });
        }
        if (url === "https://storage.media.test/signed-upload") {
          const headers = new Headers(init?.headers);
          assert.equal(init?.method, "PUT");
          assert.equal(headers.get("authorization"), null);
          assert.equal(headers.get("content-type"), "image/png");
          assert.equal(headers.get("x-upsert"), "false");
          assert.ok(init?.body instanceof Blob);
          assert.equal(init.body.size, 5);
          return new Response(null, { status: 200 });
        }
        assert.equal(url, `${TEST_GATEWAY}/v1/media/upload/finalize`);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer media-token",
        );
        assert.deepEqual(jsonBody(init), {
          filename: "reference.png",
          content_type: "image/png",
          bytes: 5,
          site_id: "image",
          title: "reference.png",
          register_asset: false,
          path: "u/user/image/reference.png",
        });
        return Response.json({
          file: { url: "https://media.example/reference.png" },
        });
      }) as typeof fetch,
      async () => {
        const response = await dispatchApi("image", "/api/upload", {
          method: "POST",
          authorization: "Bearer media-token",
          body: formWithFile("reference.png", "image/png"),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          url: "https://media.example/reference.png",
        });
      },
    ),
  );
  assert.equal(calls.length, 3);
});

test("all scratch upload routes use route-specific media contracts", async () => {
  const cases = [
    ["aihuman", "/api/upload", "aihuman", "portrait.png", "image/png"],
    ["image", "/api/upload", "image", "source.png", "image/png"],
    ["video", "/api/upload", "video", "first-frame.png", "image/png"],
    ["interior", "/api/upload", "interior", "room.png", "image/png"],
    ["threed", "/api/upload", "threed", "reference.png", "image/png"],
    ["video", "/api/upload-video", "video", "export.mp4", "video/mp4"],
  ] as const;
  let call = 0;

  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input, init) => {
        assert.equal(
          requestUrl(input),
          `${TEST_GATEWAY}/v1/media/upload/init`,
        );
        const body = jsonBody(init);
        const expected = cases[call]!;
        assert.equal(body.site_id, expected[2]);
        assert.equal(body.filename, expected[3]);
        assert.equal(body.content_type, expected[4]);
        assert.equal(body.register_asset, false);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer route-token",
        );
        call += 1;
        return Response.json({
          already_finalized: true,
          file: { url: `https://media.example/${expected[3]}` },
        });
      }) as typeof fetch,
      async () => {
        for (const [siteKey, path, , filename, contentType] of cases) {
          const response = await dispatchApi(siteKey, path, {
            method: "POST",
            authorization: "Bearer route-token",
            body: formWithFile(filename, contentType, "x"),
          });
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {
            url: `https://media.example/${filename}`,
          });
        }
      },
    ),
  );
  assert.equal(call, cases.length);
});

test("uploads enforce authentication, type, and route byte limits before fetch", async () => {
  let fetchCalls = 0;
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () => {
        fetchCalls += 1;
        throw new Error("fetch must not run");
      }) as typeof fetch,
      async () => {
        const unauthorized = await dispatchApi("image", "/api/upload", {
          method: "POST",
          body: formWithFile("source.png", "image/png"),
        });
        assert.equal(unauthorized.status, 401);

        const wrongImageType = await dispatchApi("image", "/api/upload", {
          method: "POST",
          authorization: "Bearer token",
          body: formWithFile("source.mp4", "video/mp4"),
        });
        assert.equal(wrongImageType.status, 415);

        const unsafeSvg = await dispatchApi("threed", "/api/upload", {
          method: "POST",
          authorization: "Bearer token",
          body: formWithFile("source.svg", "image/svg+xml"),
        });
        assert.equal(unsafeSvg.status, 415);

        const wrongVideoType = await dispatchApi(
          "video",
          "/api/upload-video",
          {
            method: "POST",
            authorization: "Bearer token",
            body: formWithFile("export.webm", "video/webm"),
          },
        );
        assert.equal(wrongVideoType.status, 415);
      },
    ),
  );
  assert.equal(fetchCalls, 0);

  const imageContract: UploadContract = {
    siteId: "image",
    mediaKind: "image",
    maxBytes: 12 * 1024 * 1024,
    maxBytesLabel: "12MB",
    registerAsset: false,
  };
  const videoContract: UploadContract = {
    siteId: "video",
    mediaKind: "video",
    maxBytes: 300 * 1024 * 1024,
    maxBytesLabel: "300MB",
    registerAsset: false,
  };
  assert.deepEqual(
    validateUploadMetadata(
      {
        name: "large.png",
        type: "image/png",
        size: 12 * 1024 * 1024 + 1,
      },
      imageContract,
    ),
    { status: 413, error: "文件过大（上限 12MB）。" },
  );
  assert.deepEqual(
    validateUploadMetadata(
      {
        name: "large.mp4",
        type: "video/mp4",
        size: 300 * 1024 * 1024 + 1,
      },
      videoContract,
    ),
    { status: 413, error: "文件过大（上限 300MB）。" },
  );
});

test("image compatibility proxy delegates SSRF checks and preserves response headers", async () => {
  const sourceUrl =
    "https://first-party-storage.example/media-uploads/result.png?version=7";
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input, init) => {
        const url = new URL(requestUrl(input));
        assert.equal(url.origin, TEST_GATEWAY);
        assert.equal(url.pathname, "/v1/media/proxy");
        assert.equal(url.searchParams.get("url"), sourceUrl);
        assert.equal(new Headers(init?.headers).get("authorization"), null);
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Length": "3",
            "Content-Type": "image/png",
          },
        });
      }) as typeof fetch,
      async () => {
        const response = await dispatchApi("image", "/api/fetch-image", {
          search: `?url=${encodeURIComponent(sourceUrl)}`,
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/png");
        assert.equal(
          response.headers.get("cache-control"),
          "private, max-age=300",
        );
        assert.equal(response.headers.get("content-disposition"), null);
        assert.deepEqual(
          [...new Uint8Array(await response.arrayBuffer())],
          [1, 2, 3],
        );
      },
    ),
  );
});

test("logo compatibility proxy emits a safe attachment name", async () => {
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () =>
        new Response(new Uint8Array([9]), {
          headers: { "Content-Type": "image/webp" },
        })) as typeof fetch,
      async () => {
        const response = await dispatchApi("logo", "/api/fetch-image", {
          search:
            "?url=https%3A%2F%2Ffirst-party.example%2Flogo.webp" +
            "&name=my%20logo%22.webp",
        });
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("content-disposition"),
          'attachment; filename="my_logo_.webp"',
        );
      },
    ),
  );
});

test("image proxy never fetches arbitrary sources directly and enforces bounds", async () => {
  const requested: string[] = [];
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input) => {
        requested.push(requestUrl(input));
        return Response.json(
          { detail: "url is not a first-party media source" },
          { status: 400 },
        );
      }) as typeof fetch,
      async () => {
        const response = await dispatchApi("image", "/api/fetch-image", {
          search: "?url=http%3A%2F%2F127.0.0.1%2Fprivate",
        });
        assert.equal(response.status, 502);
      },
    ),
  );
  assert.equal(requested.length, 1);
  assert.equal(new URL(requested[0]!).origin, TEST_GATEWAY);
  assert.equal(new URL(requested[0]!).pathname, "/v1/media/proxy");

  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () =>
        new Response("x", {
          headers: {
            "Content-Length": String(20 * 1024 * 1024 + 1),
            "Content-Type": "image/png",
          },
        })) as typeof fetch,
      async () => {
        const response = await dispatchApi("image", "/api/fetch-image", {
          search: "?url=https%3A%2F%2Ffirst-party.example%2Flarge.png",
        });
        assert.equal(response.status, 413);
        assert.deepEqual(await response.json(), { error: "图片过大。" });
      },
    ),
  );
});
