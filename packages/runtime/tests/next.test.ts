import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { tenantProxyResponse } from "../src/next";

function request(url: string, host: string): NextRequest {
  return new NextRequest(url, { headers: { Host: host } });
}

function assertStandardPptIsolation(response: Response): void {
  assert.equal(
    response.headers.get("Cache-Control"),
    "private, no-store, max-age=0",
  );
  assert.equal(response.headers.get("Vary"), "Host");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(response.headers.get("X-OceanLeo-Tenant"), "ppt");
}

test("root aliases redirect to the canonical host with the raw query intact", () => {
  const response = tenantProxyResponse(
    request(
      "https://edge.internal/?tag=first&tag=second&encoded=%2F%2f&space=a+b&empty=",
      "ppt.oceanleo.com",
    ),
    "standard",
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("Location"),
    "https://slide.oceanleo.com/?tag=first&tag=second&encoded=%2F%2f&space=a+b&empty=",
  );
  assertStandardPptIsolation(response);
});

test("tenant metadata aliases redirect before the foundation handler", () => {
  const response = tenantProxyResponse(
    request(
      "https://edge.internal/api/tenant?view=brand%2Fshell&view=raw+value",
      "ppt.oceanleo.com",
    ),
    "standard",
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("Location"),
    "https://slide.oceanleo.com/api/tenant?view=brand%2Fshell&view=raw+value",
  );
  assertStandardPptIsolation(response);
});

test("canonical hosts continue without redirect and carry isolation headers", () => {
  const response = tenantProxyResponse(
    request(
      "https://edge.internal/workspace/deck-7?mode=edit",
      "slide.oceanleo.com",
    ),
    "standard",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assertStandardPptIsolation(response);
});

test("unknown and wrong-profile hosts remain 404 and 421", async () => {
  const unknown = tenantProxyResponse(
    request("https://edge.internal/workspace", "unknown.oceanleo.com"),
    "standard",
  );
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, "unknown-host");
  assert.equal(unknown.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(unknown.headers.get("X-OceanLeo-Tenant"), null);

  const wrongProfile = tenantProxyResponse(
    request("https://edge.internal/workspace", "website.oceanleo.com"),
    "standard",
  );
  assert.equal(wrongProfile.status, 421);
  assert.equal((await wrongProfile.json()).error, "profile-mismatch");
  assert.equal(wrongProfile.headers.get("X-OceanLeo-App-Profile"), "standard");
  assert.equal(wrongProfile.headers.get("X-OceanLeo-Tenant"), null);
});
