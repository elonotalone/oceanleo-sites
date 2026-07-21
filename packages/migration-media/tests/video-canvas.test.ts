import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { MEDIA_PLUGIN_BATCH } from "../src/plugins";

const dispatcher = createPluginDispatcher("standard", [MEDIA_PLUGIN_BATCH]);
const TEST_GATEWAY = "https://gateway.canvas.test";

async function dispatchCanvas(
  body: unknown,
  authorization = "Bearer canvas-token",
): Promise<Response> {
  const tenant = tenantForSiteKey("video");
  assert.ok(tenant);
  const headers = new Headers({
    "Content-Type": "application/json",
    Host: tenant.canonicalHost,
  });
  if (authorization) headers.set("Authorization", authorization);
  const result = await dispatcher.dispatch({
    tenant,
    pathname: "/api/canvas",
    surface: "api",
    request: new Request("https://video.oceanleo.com/api/canvas", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  });
  assert.equal(result.kind, "response");
  if (result.kind !== "response") {
    throw new Error("video canvas did not return a response");
  }
  return result.response;
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

test("canvas routes five generation/status actions to authenticated gateway primitives", async () => {
  const seen: Array<Readonly<{ url: string; body: Record<string, unknown> }>> =
    [];
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input, init) => {
        const url = requestUrl(input);
        const body = jsonBody(init);
        seen.push({ url, body });
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer canvas-token",
        );
        assert.equal(body.key_mode, "platform");

        if (url === `${TEST_GATEWAY}/v1/chat`) {
          return Response.json({ text: "generated copy" });
        }
        if (url === `${TEST_GATEWAY}/v1/images/generate`) {
          return Response.json({
            images: ["https://media.example/generated.png"],
          });
        }
        if (url === `${TEST_GATEWAY}/v1/videos/generate`) {
          return Response.json({ task_id: "task-7", status: "PENDING" });
        }
        assert.equal(
          url,
          `${TEST_GATEWAY}/v1/videos/status/task%2F7`,
        );
        return Response.json({
          status: "SUCCEEDED",
          videos: ["https://media.example/generated.mp4"],
          error: "",
        });
      }) as typeof fetch,
      async () => {
        const text = await dispatchCanvas({
          action: "generate_text",
          payload: { prompt: "Write an intro", maxTokens: 321 },
        });
        assert.deepEqual(await text.json(), {
          ok: true,
          data: { text: "generated copy" },
        });

        const script = await dispatchCanvas({
          action: "generate_script",
          payload: { prompt: "Storyboard this" },
        });
        assert.deepEqual(await script.json(), {
          ok: true,
          data: { text: "generated copy" },
        });

        const image = await dispatchCanvas({
          action: "generate_image",
          payload: {
            prompt: "Opening frame",
            ratio: "9:16",
            quality: "4K",
          },
        });
        assert.deepEqual(await image.json(), {
          ok: true,
          data: { images: ["https://media.example/generated.png"] },
        });

        const video = await dispatchCanvas({
          action: "generate_video",
          payload: {
            prompt: "Animate the opening frame",
            imageUrl: "https://media.example/generated.png",
            duration: 8,
          },
        });
        assert.deepEqual(await video.json(), {
          ok: true,
          data: { taskId: "task-7", status: "PENDING" },
        });

        const status = await dispatchCanvas({
          action: "generation_status",
          payload: { taskId: "task/7" },
        });
        assert.deepEqual(await status.json(), {
          ok: true,
          data: {
            status: "SUCCEEDED",
            videos: ["https://media.example/generated.mp4"],
            error: "",
          },
        });
      },
    ),
  );

  assert.equal(seen.length, 5);
  assert.equal(seen[0]!.body.site_id, "video");
  assert.deepEqual(seen[0]!.body.messages, [
    { role: "user", content: "Write an intro" },
  ]);
  assert.equal(seen[0]!.body.max_tokens, 321);
  assert.match(String(seen[1]!.body.system), /资深短视频导演/);
  assert.equal(seen[2]!.body.sharpness, "4K");
  assert.equal(seen[3]!.body.image_url, "https://media.example/generated.png");
});

test("canvas rejects missing auth and unsupported actions without network access", async () => {
  let fetchCalls = 0;
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () => {
        fetchCalls += 1;
        throw new Error("unexpected fetch");
      }) as typeof fetch,
      async () => {
        const unauthorized = await dispatchCanvas(
          {
            action: "generate_text",
            payload: { prompt: "Hello" },
          },
          "",
        );
        assert.equal(unauthorized.status, 500);
        assert.deepEqual(await unauthorized.json(), {
          ok: false,
          error: "请先登录 OceanLeo 账号后再运行节点。",
        });

        const missing = await dispatchCanvas({});
        assert.equal(missing.status, 400);
        assert.deepEqual(await missing.json(), {
          ok: false,
          error: "缺少 action。",
        });

        const unsupported = await dispatchCanvas({ action: "erase_all" });
        assert.equal(unsupported.status, 400);
        assert.deepEqual(await unsupported.json(), {
          ok: false,
          error: "不支持的 action。",
        });
      },
    ),
  );
  assert.equal(fetchCalls, 0);
});

test("final render proxies inputs, composes, and persists through signed upload", async () => {
  const sourceVideo = "http://127.0.0.1/should-be-gateway-validated.mp4";
  const sourceAudio = "https://media.example/bgm.mp3";
  const calls: string[] = [];

  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input, init) => {
        const url = requestUrl(input);
        calls.push(url);
        const authorization = new Headers(init?.headers).get("authorization");

        if (url.startsWith(`${TEST_GATEWAY}/v1/media/proxy?`)) {
          const proxied = new URL(url).searchParams.get("url");
          assert.ok(proxied === sourceVideo || proxied === sourceAudio);
          assert.equal(authorization, "Bearer canvas-token");
          return new Response(
            proxied === sourceVideo ? "video-clip" : "audio-track",
            {
              headers: {
                "Content-Type":
                  proxied === sourceVideo ? "video/mp4" : "audio/mpeg",
              },
            },
          );
        }
        if (url === `${TEST_GATEWAY}/v1/convert/compose`) {
          assert.equal(authorization, "Bearer canvas-token");
          assert.ok(init?.body instanceof FormData);
          const clips = init.body.getAll("clips");
          assert.equal(clips.length, 1);
          assert.ok(clips[0] instanceof File);
          assert.equal(clips[0].name, "should-be-gateway-validated.mp4");
          assert.ok(init.body.get("subtitles") instanceof File);
          assert.ok(init.body.get("bgm") instanceof File);
          assert.equal(init.body.get("bgm_volume"), "0.5");
          assert.equal(init.body.get("key_mode"), "platform");
          return new Response("composed-video", {
            headers: { "Content-Type": "video/mp4" },
          });
        }
        if (url === `${TEST_GATEWAY}/v1/media/upload/init`) {
          const body = jsonBody(init);
          assert.equal(authorization, "Bearer canvas-token");
          assert.equal(body.site_id, "video");
          assert.equal(body.content_type, "video/mp4");
          assert.equal(body.register_asset, true);
          assert.equal(body.bytes, 14);
          assert.match(String(body.filename), /^节点画布合成-\d+\.mp4$/);
          return Response.json({
            path: "u/user/video/composed.mp4",
            signed_url: "https://storage.media.test/render-upload",
          });
        }
        if (url === "https://storage.media.test/render-upload") {
          assert.equal(init?.method, "PUT");
          assert.equal(authorization, null);
          assert.ok(init?.body instanceof Blob);
          assert.equal(init.body.size, 14);
          return new Response(null, { status: 200 });
        }
        assert.equal(url, `${TEST_GATEWAY}/v1/media/upload/finalize`);
        const body = jsonBody(init);
        assert.equal(authorization, "Bearer canvas-token");
        assert.equal(body.register_asset, true);
        assert.equal(body.path, "u/user/video/composed.mp4");
        return Response.json({
          file: { url: "https://media.example/composed.mp4" },
        });
      }) as typeof fetch,
      async () => {
        const response = await dispatchCanvas({
          action: "final_render",
          payload: {
            videoUrls: [sourceVideo],
            subtitleText: "1\n00:00:00,000 --> 00:00:01,000\nHello",
            bgmUrl: sourceAudio,
            bgmVolume: 0.5,
          },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          ok: true,
          data: {
            videoUrl: "https://media.example/composed.mp4",
            persisted: true,
          },
        });
      },
    ),
  );

  assert.equal(calls.length, 6);
  assert.equal(
    calls.some((url) => url === sourceVideo || url === sourceAudio),
    false,
  );
});

test("final render enforces clip count and byte bounds before persistence", async () => {
  let fetchCalls = 0;
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () => {
        fetchCalls += 1;
        throw new Error("unexpected fetch");
      }) as typeof fetch,
      async () => {
        const response = await dispatchCanvas({
          action: "final_render",
          payload: {
            videoUrls: Array.from(
              { length: 13 },
              (_, index) => `https://media.example/${index}.mp4`,
            ),
          },
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: "最多支持合成 12 个片段。",
        });
      },
    ),
  );
  assert.equal(fetchCalls, 0);

  let boundedCalls = 0;
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async () => {
        boundedCalls += 1;
        return new Response("x", {
          headers: {
            "Content-Length": String(128 * 1024 * 1024 + 1),
            "Content-Type": "video/mp4",
          },
        });
      }) as typeof fetch,
      async () => {
        const response = await dispatchCanvas({
          action: "final_render",
          payload: { videoUrls: ["https://media.example/oversized.mp4"] },
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: "视频片段过大。",
        });
      },
    ),
  );
  assert.equal(boundedCalls, 1);

  let outputCalls = 0;
  await withGatewayEnvironment(() =>
    withMockedFetch(
      (async (input) => {
        outputCalls += 1;
        const url = requestUrl(input);
        if (url.startsWith(`${TEST_GATEWAY}/v1/media/proxy?`)) {
          return new Response("clip", {
            headers: { "Content-Type": "video/mp4" },
          });
        }
        assert.equal(url, `${TEST_GATEWAY}/v1/convert/compose`);
        return new Response("x", {
          headers: {
            "Content-Length": String(512 * 1024 * 1024 + 1),
            "Content-Type": "video/mp4",
          },
        });
      }) as typeof fetch,
      async () => {
        const response = await dispatchCanvas({
          action: "final_render",
          payload: { videoUrls: ["https://media.example/clip.mp4"] },
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: "合成结果过大。",
        });
      },
    ),
  );
  assert.equal(outputCalls, 2);
});
