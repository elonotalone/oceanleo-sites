import "server-only";

import {
  resolveTenantRequest,
  type AppProfile,
} from "@oceanleo/tenant-registry";
import { headers } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { ReactNode } from "react";

import type {
  PluginDispatchResult,
  PluginDispatcher,
} from "./dispatcher";

function pathnameForSegments(segments: readonly string[]): `/${string}` {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function pendingPage(result: Extract<PluginDispatchResult, { kind: "pending" }>) {
  return (
    <main
      data-plugin-batch={result.batchId}
      data-plugin-route={result.routeId}
      data-plugin-status="pending"
    >
      <h1>Migration pending</h1>
      <p>
        This route belongs to the {result.batchId} migration package and is not
        active yet.
      </p>
    </main>
  );
}

export async function dispatchNextPluginPage(input: Readonly<{
  dispatcher: PluginDispatcher;
  profile: AppProfile;
  segments: readonly string[];
}>): Promise<ReactNode> {
  const requestHeaders = await headers();
  const resolution = resolveTenantRequest(
    requestHeaders.get("host"),
    input.profile,
  );
  if (!resolution.ok) notFound();

  const pathname = pathnameForSegments(input.segments);
  const request = new Request(`https://${resolution.host}${pathname}`, {
    method: "GET",
    headers: new Headers(requestHeaders),
  });
  const result = await input.dispatcher.dispatch({
    tenant: resolution.tenant,
    request,
    pathname,
    surface: "page",
  });

  if (result.kind === "not-found" || result.kind === "misdirected") notFound();
  if (result.kind === "pending") return pendingPage(result);
  if (result.kind === "page") return result.node;
  if (result.kind === "redirect") {
    if (result.status === 308) permanentRedirect(result.location);
    if (result.status === 307) redirect(result.location);
    throw new Error(`Unsupported page redirect status ${result.status}.`);
  }
  throw new Error(`Plugin page returned unsupported result ${result.kind}.`);
}

function jsonError(
  status: 404 | 421,
  error: "plugin-route-not-found" | "plugin-profile-mismatch",
): Response {
  return Response.json(
    { error, status },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Host",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export function pluginDispatchResponse(result: PluginDispatchResult): Response {
  if (result.kind === "not-found") {
    return jsonError(404, "plugin-route-not-found");
  }
  if (result.kind === "misdirected") {
    return jsonError(421, "plugin-profile-mismatch");
  }
  if (result.kind === "pending") {
    return Response.json(
      {
        error: "plugin-migration-pending",
        status: result.status,
        batchId: result.batchId,
        pluginId: result.pluginId,
        routeId: result.routeId,
      },
      {
        status: result.status,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Host",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  if (result.kind === "response") return result.response;
  if (result.kind === "stream") {
    return new Response(result.stream, {
      status: result.status ?? 200,
      headers: result.headers,
    });
  }
  if (result.kind === "redirect") {
    return Response.redirect(result.location, result.status);
  }
  throw new Error("Page results cannot be returned by an API route.");
}

export async function dispatchNextPluginApi(input: Readonly<{
  dispatcher: PluginDispatcher;
  profile: AppProfile;
  request: NextRequest;
}>): Promise<Response> {
  const resolution = resolveTenantRequest(
    input.request.headers.get("host"),
    input.profile,
  );
  if (!resolution.ok) {
    return jsonError(
      resolution.status,
      resolution.reason === "profile-mismatch"
        ? "plugin-profile-mismatch"
        : "plugin-route-not-found",
    );
  }

  const result = await input.dispatcher.dispatch({
    tenant: resolution.tenant,
    request: input.request,
    pathname: new URL(input.request.url).pathname as `/${string}`,
    surface: "api",
  });
  return pluginDispatchResponse(result);
}
