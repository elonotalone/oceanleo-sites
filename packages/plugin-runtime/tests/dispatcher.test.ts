import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityDeniedError } from "@oceanleo/capabilities/server";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { createPluginDispatcher } from "../src/dispatcher";
import {
  definePluginBatch,
  type PluginRouteParams,
} from "../src/index";

const encoder = new TextEncoder();
let deniedHandlerCalls = 0;
let capturedParams: PluginRouteParams = {};

const officeTestBatch = definePluginBatch({
  id: "office",
  migrationBatch: 1,
  profile: "standard",
  ownerPath: "packages/migration-office",
  plugins: [
    {
      id: "presentation-workbench",
      siteKey: "ppt",
      routes: [
        {
          id: "ppt.page",
          kind: "page",
          surface: "page",
          pattern: "/workspace/:documentId",
          methods: ["GET"],
          capability: "workbench:advanced",
          parity: {
            status: "verified",
            source: "test",
            evidence: ["tests/dispatcher.test.ts"],
          },
          handler: ({ params }) => {
            capturedParams = params;
            return { kind: "page", node: "presentation" };
          },
        },
        {
          id: "ppt.api",
          kind: "api",
          surface: "api",
          pattern: "/api/presentations/:presentationId",
          methods: ["GET"],
          capability: "artifact:read",
          parity: {
            status: "verified",
            source: "test",
            evidence: ["tests/dispatcher.test.ts"],
          },
          handler: ({ params }) => {
            capturedParams = params;
            return {
              kind: "response",
              response: Response.json(params),
            };
          },
        },
        {
          id: "ppt.stream",
          kind: "stream",
          surface: "api",
          pattern: "/api/presentations/:presentationId/stream/:channel*",
          methods: ["POST"],
          capability: "artifact:read",
          parity: {
            status: "verified",
            source: "test",
            evidence: ["tests/dispatcher.test.ts"],
          },
          handler: ({ params }) => {
            capturedParams = params;
            return {
              kind: "stream",
              stream: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(encoder.encode("chunk"));
                  controller.close();
                },
              }),
              headers: { "Content-Type": "text/plain" },
            };
          },
        },
        {
          id: "ppt.alias",
          kind: "redirect",
          surface: "both",
          pattern: "/:path*",
          methods: ["*"],
          hosts: ["ppt.oceanleo.com"],
          capability: "shell:render",
          priority: 100,
          parity: {
            status: "verified",
            source: "test",
            evidence: ["tests/dispatcher.test.ts"],
          },
          redirect: {
            protocol: "https",
            host: "slide.oceanleo.com",
            path: { mode: "preserve" },
            status: 308,
          },
        },
        {
          id: "ppt.denied",
          kind: "api",
          surface: "api",
          pattern: "/api/denied",
          methods: ["POST"],
          capability: "website:vault",
          parity: {
            status: "verified",
            source: "test",
            evidence: ["tests/dispatcher.test.ts"],
          },
          handler: () => {
            deniedHandlerCalls += 1;
            return { kind: "response", response: new Response("unsafe") };
          },
        },
      ],
    },
  ],
});

const dispatcher = createPluginDispatcher("standard", [officeTestBatch]);
const resolvedTenant = tenantForSiteKey("ppt");
if (!resolvedTenant) throw new Error("ppt test tenant is missing.");
const tenant = resolvedTenant;

function dispatch(
  pathname: `/${string}`,
  options: Readonly<{
    method?: string;
    host?: string;
    search?: string;
    surface?: "page" | "api";
  }> = {},
) {
  return dispatcher.dispatch({
    tenant,
    pathname,
    surface: options.surface ?? "api",
    request: new Request(
      `https://${options.host ?? "slide.oceanleo.com"}${pathname}${options.search ?? ""}`,
      {
        method: options.method ?? "GET",
        headers: { Host: options.host ?? "slide.oceanleo.com" },
      },
    ),
  });
}

test("dispatcher represents page, API, stream, redirect, and route params", async () => {
  const page = await dispatch("/workspace/deck-7", { surface: "page" });
  assert.equal(page.kind, "page");
  assert.deepEqual(capturedParams, { documentId: "deck-7" });

  const api = await dispatch("/api/presentations/deck-7");
  assert.equal(api.kind, "response");
  assert.deepEqual(capturedParams, { presentationId: "deck-7" });

  const stream = await dispatch(
    "/api/presentations/deck-7/stream/live/captions",
    { method: "POST" },
  );
  assert.equal(stream.kind, "stream");
  if (stream.kind === "stream") {
    assert.equal(await new Response(stream.stream).text(), "chunk");
  }
  assert.deepEqual(capturedParams, {
    presentationId: "deck-7",
    channel: ["live", "captions"],
  });

  const redirect = await dispatch("/workspace/deck-7", {
    host: "ppt.oceanleo.com",
    search: "?ignored",
    surface: "page",
  });
  assert.deepEqual(redirect, {
    kind: "redirect",
    location: "https://slide.oceanleo.com/workspace/deck-7?ignored",
    status: 308,
  });
});

test("authorization runs before handlers and unknown routes fail closed", async () => {
  deniedHandlerCalls = 0;
  await assert.rejects(
    dispatch("/api/denied", { method: "POST" }),
    CapabilityDeniedError,
  );
  assert.equal(deniedHandlerCalls, 0);

  assert.deepEqual(await dispatch("/api/not-declared"), {
    kind: "not-found",
    status: 404,
  });
});

test("a dispatcher rejects batches from the other app profile", () => {
  const websiteBatch = definePluginBatch({
    id: "website-privileged",
    migrationBatch: 6,
    profile: "website-privileged",
    ownerPath: "packages/migration-website-privileged",
    plugins: [
      {
        id: "website-source-workbench",
        siteKey: "website",
        routes: [
          {
            id: "website.pending",
            kind: "page",
            surface: "page",
            pattern: "/workspace/:path*",
            methods: ["GET"],
            capability: "website:source-edit",
            parity: { status: "pending", source: "test", evidence: [] },
          },
        ],
      },
    ],
  });
  assert.throws(
    () => createPluginDispatcher("standard", [websiteBatch]),
    /cannot load website-privileged batch/,
  );
});
