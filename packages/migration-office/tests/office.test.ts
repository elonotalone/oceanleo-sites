import assert from "node:assert/strict";
import test from "node:test";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import {
  tenantForSiteKey,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

import {
  CONVERTER_AUDIO_MAX_BYTES,
  EXCEL_SANDBOX_LIMITS,
  MEBIBYTE,
  WORD_DOCUMENT_EXTENSIONS,
} from "../src/contracts";
import { OFFICE_INVENTORY } from "../src/inventory";
import { OFFICE_PLUGIN_BATCH } from "../src/plugins";

const dispatcher = createPluginDispatcher("standard", [OFFICE_PLUGIN_BATCH]);
const HOSTS = {
  ppt: "slide.oceanleo.com",
  excel: "excel.oceanleo.com",
  word: "word.oceanleo.com",
  converter: "converter.oceanleo.com",
  resume: "resume.oceanleo.com",
} as const;

type OfficeSiteKey = keyof typeof HOSTS;

function tenant(siteKey: OfficeSiteKey): TenantDefinition {
  const resolved = tenantForSiteKey(siteKey);
  assert.ok(resolved);
  return resolved;
}

function dispatch(
  siteKey: OfficeSiteKey,
  pathname: `/${string}`,
  options: Readonly<{
    method?: string;
    host?: string;
    search?: string;
    surface?: "page" | "api";
    body?: BodyInit;
    headers?: Record<string, string>;
  }> = {},
) {
  const host = options.host ?? HOSTS[siteKey];
  return dispatcher.dispatch({
    tenant: tenant(siteKey),
    pathname,
    surface: options.surface ?? "page",
    request: new Request(
      `https://${host}${pathname}${options.search ?? ""}`,
      {
        method: options.method ?? "GET",
        headers: { Host: host, ...(options.headers ?? {}) },
        body: options.body,
      },
    ),
  });
}

test("office declares the complete five-tenant route inventory", () => {
  assert.deepEqual(
    OFFICE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["ppt", "excel", "word", "converter", "resume"],
  );
  assert.deepEqual(
    Object.fromEntries(
      OFFICE_PLUGIN_BATCH.plugins.map((plugin) => [
        plugin.siteKey,
        plugin.routes.length,
      ]),
    ),
    {
      ppt: 21,
      excel: 29,
      word: 23,
      converter: 26,
      resume: 22,
    },
  );

  const routes = OFFICE_PLUGIN_BATCH.plugins.flatMap(
    (plugin) => plugin.routes,
  );
  assert.equal(routes.length, 121);
  const statusCounts = routes.reduce<Record<string, number>>((counts, route) => {
    counts[route.parity.status] = (counts[route.parity.status] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(
    {
      verified: statusCounts.verified ?? 0,
      partial: statusCounts.partial ?? 0,
      pending: statusCounts.pending ?? 0,
    },
    {
      verified: 88,
      partial: 33,
      pending: 0,
    },
  );
  assert.deepEqual(
    routes
      .filter((route) => route.parity.status === "pending")
      .map((route) => route.id)
      .sort(),
    [],
  );
  assert.ok(
    routes.every(
      (route) =>
        route.parity.evidence.length > 0 &&
        (route.parity.status === "pending" ||
          route.kind === "redirect" ||
          typeof route.handler === "function"),
    ),
  );
});

test("inventory mirrors route parity and keeps extension seams partial", () => {
  assert.equal(OFFICE_INVENTORY.batchId, "office");
  assert.equal(OFFICE_INVENTORY.ownerPath, "packages/migration-office");
  assert.equal(OFFICE_INVENTORY.entries.length, 127);

  const extensionEntries = OFFICE_INVENTORY.entries.filter(
    (entry) => entry.kind === "plugin-extension",
  );
  assert.equal(extensionEntries.length, 5);
  assert.ok(
    extensionEntries.every((entry) => entry.parity.status === "partial"),
  );

  const routeEntries = OFFICE_INVENTORY.entries.filter(
    (entry) => entry.kind !== "plugin-extension",
  );
  assert.equal(routeEntries.length, 122);
  const routeStatusCounts = routeEntries.reduce<Record<string, number>>(
    (counts, entry) => {
      counts[entry.parity.status] = (counts[entry.parity.status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  assert.deepEqual(
    {
      verified: routeStatusCounts.verified ?? 0,
      partial: routeStatusCounts.partial ?? 0,
      pending: routeStatusCounts.pending ?? 0,
    },
    {
      verified: 89,
      partial: 33,
      pending: 0,
    },
  );
  assert.ok(
    routeEntries
      .filter(
        (entry) =>
          entry.route === "/api/guide" && entry.methods.includes("*"),
      )
      .every((entry) => entry.kind === "route-handler"),
  );
  assert.ok(
    routeEntries.some(
      (entry) =>
        entry.route === "/:path*" &&
        entry.methods.includes("*") &&
        entry.kind === "route-handler",
    ),
  );
});

test("active pages dispatch while undeclared routes fail closed", async () => {
  assert.equal((await dispatch("ppt", "/library")).kind, "page");
  assert.equal((await dispatch("ppt", "/workspace/deck-7")).kind, "page");
  assert.equal((await dispatch("word", "/advanced/document")).kind, "page");
  assert.equal((await dispatch("ppt", "/developer-api")).kind, "page");
  assert.equal((await dispatch("excel", "/api-guide")).kind, "page");
  assert.deepEqual(await dispatch("ppt", "/unowned/deep"), {
    kind: "not-found",
    status: 404,
  });
});

test("ppt alias and legacy page redirects preserve canonical routing", async () => {
  assert.deepEqual(
    await dispatch("ppt", "/workspace/deck-7", {
      host: "ppt.oceanleo.com",
      search: "?mode=present",
    }),
    {
      kind: "redirect",
      location:
        "https://slide.oceanleo.com/workspace/deck-7?mode=present",
      status: 308,
    },
  );
  assert.deepEqual(await dispatch("ppt", "/documents"), {
    kind: "redirect",
    location: "https://slide.oceanleo.com/workspace?fn=create",
    status: 307,
  });
  assert.deepEqual(await dispatch("resume", "/builder"), {
    kind: "redirect",
    location: "https://resume.oceanleo.com/",
    status: 308,
  });
  // Bare /api cannot mount on either catch-all; only /api/guide is redirected
  // (API surface) to the moved /api-guide page.
  assert.deepEqual(
    await dispatch("word", "/api/guide", { surface: "api" }),
    {
      kind: "redirect",
      location: "https://word.oceanleo.com/api-guide",
      status: 308,
    },
  );
});

test("converter keeps dynamic tool deep links and exact upload limits", async () => {
  assert.deepEqual(await dispatch("converter", "/pdf-to-word"), {
    kind: "redirect",
    location: "https://converter.oceanleo.com/workspace?fn=pdf-to-word",
    status: 307,
  });
  assert.deepEqual(await dispatch("converter", "/not-a-tool"), {
    kind: "redirect",
    location: "https://converter.oceanleo.com/workspace",
    status: 307,
  });
  assert.equal(CONVERTER_AUDIO_MAX_BYTES, 50 * MEBIBYTE);
});

test("word text uploads are active and structured Word parsing stays explicit", async () => {
  const textForm = new FormData();
  textForm.set(
    "file",
    new Blob(["# Draft"], { type: "text/markdown" }),
    "draft.md",
  );
  const textResult = await dispatch("word", "/api/document-upload", {
    method: "POST",
    surface: "api",
    body: textForm,
  });
  assert.equal(textResult.kind, "response");
  if (textResult.kind === "response") {
    assert.equal(textResult.response.status, 200);
    assert.deepEqual(await textResult.response.json(), {
      fileName: "draft.md",
      extension: ".md",
      text: "# Draft",
      images: [],
    });
  }

  const docxForm = new FormData();
  docxForm.set(
    "file",
    new Blob(["zip"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "draft.docx",
  );
  const docxResult = await dispatch("word", "/api/document-upload", {
    method: "POST",
    surface: "api",
    body: docxForm,
  });
  assert.equal(docxResult.kind, "response");
  if (docxResult.kind === "response") {
    assert.equal(docxResult.response.status, 501);
    assert.equal(
      (await docxResult.response.json() as { code: string }).code,
      "structured-document-parser-pending",
    );
  }
  assert.deepEqual(WORD_DOCUMENT_EXTENSIONS, [
    ".doc",
    ".docx",
    ".txt",
    ".md",
  ]);
});

test("converter uploads require bearer auth and use gateway direct upload", async () => {
  const TEST_GATEWAY = "https://gateway.office.test";
  const previousGateway = process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = TEST_GATEWAY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL;

  const unauthenticated = await dispatch("converter", "/api/upload", {
    method: "POST",
    surface: "api",
    body: new FormData(),
  });
  assert.equal(unauthenticated.kind, "response");
  if (unauthenticated.kind === "response") {
    assert.equal(unauthenticated.response.status, 401);
  }

  const rejectedForm = new FormData();
  rejectedForm.set("purpose", "document");
  rejectedForm.set(
    "file",
    new Blob(["doc"], { type: "application/pdf" }),
    "notes.pdf",
  );
  const rejected = await dispatch("converter", "/api/upload", {
    method: "POST",
    surface: "api",
    headers: { Authorization: "Bearer converter-token" },
    body: rejectedForm,
  });
  assert.equal(rejected.kind, "response");
  if (rejected.kind === "response") {
    assert.equal(rejected.response.status, 400);
    assert.match(
      (await rejected.response.json() as { error: string }).error,
      /ASR/,
    );
  }

  const calls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url === `${TEST_GATEWAY}/v1/media/upload/init`) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer converter-token",
      );
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body, {
        filename: "voice.mp3",
        content_type: "audio/mpeg",
        bytes: 5,
        site_id: "converter",
        title: "voice.mp3",
        register_asset: false,
      });
      return Response.json({
        path: "u/user/converter/voice.mp3",
        signed_url: "https://storage.office.test/signed-upload",
      });
    }
    if (url === "https://storage.office.test/signed-upload") {
      const headers = new Headers(init?.headers);
      assert.equal(init?.method, "PUT");
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("content-type"), "audio/mpeg");
      assert.equal(headers.get("x-upsert"), "false");
      assert.ok(init?.body instanceof Blob);
      return new Response(null, { status: 200 });
    }
    assert.equal(url, `${TEST_GATEWAY}/v1/media/upload/finalize`);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer converter-token",
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.path, "u/user/converter/voice.mp3");
    assert.equal(body.site_id, "converter");
    return Response.json({
      file: { url: "https://cdn.office.test/converter/voice.mp3" },
    });
  }) as typeof fetch;

  try {
    const form = new FormData();
    form.set("purpose", "asr");
    form.set(
      "file",
      new Blob(["audio"], { type: "audio/mpeg" }),
      "voice.mp3",
    );
    const result = await dispatch("converter", "/api/upload", {
      method: "POST",
      surface: "api",
      headers: { Authorization: "Bearer converter-token" },
      body: form,
    });
    assert.equal(result.kind, "response");
    if (result.kind === "response") {
      assert.equal(result.response.status, 200);
      assert.deepEqual(await result.response.json(), {
        url: "https://cdn.office.test/converter/voice.mp3",
      });
    }
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        `${TEST_GATEWAY}/v1/media/upload/init`,
        "https://storage.office.test/signed-upload",
        `${TEST_GATEWAY}/v1/media/upload/finalize`,
      ],
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGateway === undefined) {
      delete process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL;
    } else {
      process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL = previousGateway;
    }
    if (previousSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL = previousSupabaseUrl;
    }
    if (previousServiceKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
    }
  }
});

test("Excel sandbox APIs are active with local session storage and gateway auth", async () => {
  assert.deepEqual(EXCEL_SANDBOX_LIMITS, {
    maxFileBytes: 30 * MEBIBYTE,
    maxTotalBytes: 80 * MEBIBYTE,
    maxFiles: 10,
    allowedExtensions: [
      ".xlsx",
      ".xls",
      ".csv",
      ".tsv",
      ".json",
      ".txt",
      ".md",
      ".pdf",
      ".doc",
      ".docx",
    ],
  });

  const sandboxRoot = `/tmp/office-excel-sandbox-${Date.now()}`;
  const previousRoot = process.env.EXCEL_SANDBOX_SESSION_ROOT;
  process.env.EXCEL_SANDBOX_SESSION_ROOT = sandboxRoot;

  try {
    const form = new FormData();
    form.set(
      "file",
      new Blob(["name,value\nalpha,1\nbeta,2"], { type: "text/csv" }),
      "sample.csv",
    );
    const uploadResult = await dispatch("excel", "/api/excel-sandbox/upload", {
      method: "POST",
      surface: "api",
      body: form,
    });
    assert.equal(uploadResult.kind, "response");
    if (uploadResult.kind !== "response") return;
    assert.equal(uploadResult.response.status, 200);
    const uploadPayload = (await uploadResult.response.json()) as {
      sessionId: string;
      files: Array<{ fileId: string; fileName: string }>;
    };
    assert.match(uploadPayload.sessionId, /^sx_/);
    assert.equal(uploadPayload.files[0]?.fileName, "sample.csv");

    const sessionResult = await dispatch("excel", "/api/excel-sandbox/session", {
      surface: "api",
      search: `?sessionId=${encodeURIComponent(uploadPayload.sessionId)}`,
    });
    assert.equal(sessionResult.kind, "response");
    if (sessionResult.kind === "response") {
      assert.equal(sessionResult.response.status, 200);
    }

    const sourceResult = await dispatch("excel", "/api/excel-sandbox/source", {
      surface: "api",
      search: `?sessionId=${encodeURIComponent(uploadPayload.sessionId)}&fileId=${encodeURIComponent(uploadPayload.files[0].fileId)}`,
    });
    assert.equal(sourceResult.kind, "response");
    if (sourceResult.kind === "response") {
      assert.equal(sourceResult.response.status, 200);
      assert.match(await sourceResult.response.text(), /alpha,1/);
    }

    const unauthGenerate = await dispatch("excel", "/api/excel-sandbox/generate-code", {
      method: "POST",
      surface: "api",
      body: JSON.stringify({
        sessionId: uploadPayload.sessionId,
        requirement: "sum values",
      }),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(unauthGenerate.kind, "response");
    if (unauthGenerate.kind === "response") {
      assert.equal(unauthGenerate.response.status, 401);
    }

    const unauthRun = await dispatch("excel", "/api/excel-sandbox/run", {
      method: "POST",
      surface: "api",
      body: JSON.stringify({
        sessionId: uploadPayload.sessionId,
        pythonCode: "def process(rows, mode, context, files=None):\n    return {'summary':'ok','rows':rows}",
      }),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(unauthRun.kind, "response");
    if (unauthRun.kind === "response") {
      assert.equal(unauthRun.response.status, 401);
    }

    const storageRefUpload = await dispatch("excel", "/api/excel-sandbox/upload", {
      method: "POST",
      surface: "api",
      body: JSON.stringify({
        storageUploads: [
          {
            storagePath: "incoming/test.csv",
            fileName: "test.csv",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(storageRefUpload.kind, "response");
    if (storageRefUpload.kind === "response") {
      assert.equal(storageRefUpload.response.status, 503);
    }
  } finally {
    if (previousRoot === undefined) {
      delete process.env.EXCEL_SANDBOX_SESSION_ROOT;
    } else {
      process.env.EXCEL_SANDBOX_SESSION_ROOT = previousRoot;
    }
  }

  assert.deepEqual(
    await dispatch("excel", "/api/excel-sandbox/upload", {
      method: "GET",
      surface: "api",
    }),
    { kind: "not-found", status: 404 },
  );
});
