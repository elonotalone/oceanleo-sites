import assert from "node:assert/strict";
import test from "node:test";

import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import {
  createNextPluginPageRequest,
  pluginDispatchResponse,
} from "../src/next";

const tenant = tenantForSiteKey("ppt");
if (!tenant) throw new Error("ppt test tenant is missing.");

const context = {
  profile: "standard",
  tenant,
} as const;

test("page requests preserve scalar, repeated, empty, and encoded search params", () => {
  const request = createNextPluginPageRequest({
    host: "slide.oceanleo.com",
    pathname: "/workspace/deck%2F7",
    headers: { Host: "slide.oceanleo.com" },
    searchParams: {
      q: "hello world",
      tag: ["first", "second"],
      empty: "",
      literal: "a&b=%2F",
      omitted: undefined,
    },
  });

  assert.equal(
    request.url,
    "https://slide.oceanleo.com/workspace/deck%2F7?q=hello+world&tag=first&tag=second&empty=&literal=a%26b%3D%252F",
  );
  assert.deepEqual(new URL(request.url).searchParams.getAll("tag"), [
    "first",
    "second",
  ]);
  assert.equal(new URL(request.url).searchParams.has("omitted"), false);
});

test("handler response headers merge isolation without weakening stronger headers", async () => {
  const cacheControl = "private, no-store, max-age=0, must-revalidate";
  const response = pluginDispatchResponse(
    {
      kind: "response",
      response: new Response("accepted", {
        status: 202,
        headers: {
          "Cache-Control": cacheControl,
          "Content-Security-Policy": "default-src 'none'",
          Vary: "Accept-Encoding",
          "X-Content-Type-Options": "unsafe",
          "X-OceanLeo-App-Profile": "website-privileged",
          "X-OceanLeo-Tenant": "website",
        },
      }),
    },
    context,
  );

  assert.equal(response.status, 202);
  assert.equal(await response.text(), "accepted");
  assert.equal(response.headers.get("Cache-Control"), cacheControl);
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(response.headers.get("Vary"), "Accept-Encoding, Host");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(response.headers.get("X-OceanLeo-Tenant"), "ppt");
});

test("stream and redirect responses receive trusted tenant isolation headers", async () => {
  const encoder = new TextEncoder();
  const streamResponse = pluginDispatchResponse(
    {
      kind: "stream",
      status: 206,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("chunk"));
          controller.close();
        },
      }),
      headers: {
        "Cache-Control": "public, s-maxage=3600",
        "Content-Type": "text/plain",
        Vary: "Accept-Encoding",
      },
    },
    context,
  );

  assert.equal(streamResponse.status, 206);
  assert.equal(await streamResponse.text(), "chunk");
  assert.equal(
    streamResponse.headers.get("Cache-Control"),
    "private, no-store, max-age=0",
  );
  assert.equal(streamResponse.headers.get("Vary"), "Accept-Encoding, Host");
  assert.equal(streamResponse.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(streamResponse.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(streamResponse.headers.get("X-OceanLeo-Tenant"), "ppt");

  const redirectResponse = pluginDispatchResponse(
    {
      kind: "redirect",
      location: "https://slide.oceanleo.com/workspace/deck-7?mode=edit",
      status: 308,
    },
    context,
  );

  assert.equal(redirectResponse.status, 308);
  assert.equal(
    redirectResponse.headers.get("Location"),
    "https://slide.oceanleo.com/workspace/deck-7?mode=edit",
  );
  assert.equal(
    redirectResponse.headers.get("Cache-Control"),
    "private, no-store, max-age=0",
  );
  assert.equal(redirectResponse.headers.get("Vary"), "Host");
  assert.equal(redirectResponse.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(redirectResponse.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(redirectResponse.headers.get("X-OceanLeo-Tenant"), "ppt");
});
