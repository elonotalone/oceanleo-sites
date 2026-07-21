import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement } from "react";

import { createPluginDispatcher } from "@oceanleo/plugin-runtime/dispatcher";
import { tenantForSiteKey } from "@oceanleo/tenant-registry";

import { KNOWLEDGE_INVENTORY } from "../src/inventory";
import { KNOWLEDGE_PLUGIN_BATCH } from "../src/plugins";

const dispatcher = createPluginDispatcher("standard", [
  KNOWLEDGE_PLUGIN_BATCH,
]);

function knowledgeTenant(siteKey: string) {
  const tenant = tenantForSiteKey(siteKey);
  assert.ok(tenant, `missing knowledge tenant ${siteKey}`);
  return tenant;
}

async function dispatch(
  siteKey: string,
  pathname: `/${string}`,
  options: Readonly<{
    method?: string;
    search?: string;
    surface?: "page" | "api";
    headers?: HeadersInit;
    body?: BodyInit | null;
  }> = {},
) {
  const tenant = knowledgeTenant(siteKey);
  const host = tenant.canonicalHost;
  return dispatcher.dispatch({
    tenant,
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

test("knowledge owns six verified workbench plugins and inventory parity", async () => {
  assert.deepEqual(
    KNOWLEDGE_PLUGIN_BATCH.plugins.map((plugin) => plugin.siteKey),
    ["bizdev", "meeting", "paper", "law", "study", "edu"],
  );
  assert.equal(KNOWLEDGE_INVENTORY.batchId, "knowledge");
  assert.equal(
    KNOWLEDGE_INVENTORY.ownerPath,
    "packages/migration-knowledge",
  );
  assert.deepEqual(KNOWLEDGE_INVENTORY.tenantKeys, [
    "bizdev",
    "meeting",
    "paper",
    "law",
    "study",
    "edu",
  ]);

  const routes = KNOWLEDGE_PLUGIN_BATCH.plugins.flatMap(
    (plugin) => plugin.routes,
  );
  assert.ok(routes.length >= 40);
  assert.equal(
    routes.filter((route) => route.parity.status === "pending").length,
    0,
  );
  assert.ok(
    routes.every(
      (route) =>
        route.parity.status === "verified" &&
        route.parity.evidence.includes(
          "packages/migration-knowledge/tests/knowledge.test.ts",
        ) &&
        (route.kind === "redirect" || typeof route.handler === "function"),
    ),
  );
  assert.ok(
    KNOWLEDGE_INVENTORY.entries.every(
      (entry) => entry.parity.status === "verified",
    ),
  );
});

test("canonical workspace and history routes dispatch active knowledge pages", async () => {
  for (const siteKey of [
    "bizdev",
    "meeting",
    "paper",
    "law",
    "study",
    "edu",
  ]) {
    const result = await dispatch(siteKey, "/workspace/research");
    assert.equal(result.kind, "page", `${siteKey} workspace inactive`);
    if (result.kind === "page") {
      assert.ok(isValidElement(result.node));
    }

    const history = await dispatch(siteKey, "/history/session-1");
    assert.equal(history.kind, "page", `${siteKey} history inactive`);
  }

  assert.deepEqual(await dispatch("paper", "/unowned"), {
    kind: "not-found",
    status: 404,
  });
});

test("bizdev legacy paths redirect and specialized knowledge APIs stay active", async () => {
  assert.deepEqual(await dispatch("bizdev", "/research"), {
    kind: "redirect",
    location: "https://bizdev.oceanleo.com/workspace?fn=research",
    status: 308,
  });

  const meetingUpload = await dispatch("meeting", "/api/upload", {
    method: "POST",
    surface: "api",
    body: new FormData(),
  });
  assert.equal(meetingUpload.kind, "response");
  if (meetingUpload.kind === "response") {
    assert.equal(meetingUpload.response.status, 401);
  }

  const meetingMissingFile = await dispatch("meeting", "/api/upload", {
    method: "POST",
    surface: "api",
    headers: { Authorization: "Bearer test-token" },
    body: new FormData(),
  });
  assert.equal(meetingMissingFile.kind, "response");
  if (meetingMissingFile.kind === "response") {
    assert.equal(meetingMissingFile.response.status, 400);
  }

  const paperFetch = await dispatch("paper", "/api/fetch-url", {
    method: "POST",
    surface: "api",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "not-a-url" }),
  });
  assert.equal(paperFetch.kind, "response");
  if (paperFetch.kind === "response") {
    assert.equal(paperFetch.response.status, 400);
  }

  const law = await dispatch("law", "/consultation");
  assert.equal(law.kind, "page");
  if (law.kind === "page") {
    assert.ok(isValidElement(law.node));
    const node = law.node as ReactElement;
    assert.ok(node);
  }
});
