import "server-only";

import {
  resolveTenantRequest,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";
import {
  tenantIsolationHeaders,
  type TenantIsolationContext,
} from "@oceanleo/runtime/next";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import type { ReactNode } from "react";

import type {
  PluginDispatchResult,
  PluginDispatcher,
} from "./dispatcher";

function pathnameForSegments(segments: readonly string[]): `/${string}` {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export type NextPluginPageSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function createNextPluginPageRequest(input: Readonly<{
  host: string;
  pathname: `/${string}`;
  headers: HeadersInit;
  searchParams?: NextPluginPageSearchParams;
}>): Request {
  const requestUrl = new URL(`https://${input.host}${input.pathname}`);
  for (const [name, value] of Object.entries(input.searchParams ?? {})) {
    if (typeof value === "string") {
      requestUrl.searchParams.append(name, value);
    } else if (value !== undefined) {
      for (const item of value) requestUrl.searchParams.append(name, item);
    }
  }
  return new Request(requestUrl, {
    method: "GET",
    headers: input.headers,
  });
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
  searchParams?: NextPluginPageSearchParams;
}>): Promise<ReactNode> {
  const requestHeaders = await headers();
  const resolution = resolveTenantRequest(
    requestHeaders.get("host"),
    input.profile,
  );
  if (!resolution.ok) {
    const { notFound } = await import("next/navigation");
    return notFound();
  }

  const pathname = pathnameForSegments(input.segments);
  const request = createNextPluginPageRequest({
    host: resolution.host,
    pathname,
    headers: new Headers(requestHeaders),
    searchParams: input.searchParams,
  });
  const result = await input.dispatcher.dispatch({
    tenant: resolution.tenant,
    request,
    pathname,
    surface: "page",
  });

  if (result.kind === "not-found" || result.kind === "misdirected") {
    const { notFound } = await import("next/navigation");
    return notFound();
  }
  if (result.kind === "pending") return pendingPage(result);
  if (result.kind === "page") return result.node;
  if (result.kind === "redirect") {
    const { permanentRedirect, redirect } = await import("next/navigation");
    if (result.status === 308) permanentRedirect(result.location);
    if (result.status === 307) redirect(result.location);
    throw new Error(`Unsupported page redirect status ${result.status}.`);
  }
  throw new Error(`Plugin page returned unsupported result ${result.kind}.`);
}

function jsonError(
  status: 404 | 421,
  error: "plugin-route-not-found" | "plugin-profile-mismatch",
  context: TenantIsolationContext,
): Response {
  return Response.json(
    { error, status },
    {
      status,
      headers: tenantIsolationHeaders(undefined, context),
    },
  );
}

interface PluginResponseContext {
  readonly profile: AppProfile;
  readonly tenant: TenantDefinition;
}

function isolatedPluginResponse(
  response: Response,
  context: PluginResponseContext,
): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: tenantIsolationHeaders(response.headers, context),
  });
}

export function pluginDispatchResponse(
  result: PluginDispatchResult,
  context: PluginResponseContext,
): Response {
  if (result.kind === "not-found") {
    return jsonError(404, "plugin-route-not-found", context);
  }
  if (result.kind === "misdirected") {
    return jsonError(421, "plugin-profile-mismatch", context);
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
        headers: tenantIsolationHeaders(undefined, context),
      },
    );
  }
  if (result.kind === "response") {
    return isolatedPluginResponse(result.response, context);
  }
  if (result.kind === "stream") {
    return new Response(result.stream, {
      status: result.status ?? 200,
      headers: tenantIsolationHeaders(result.headers, context),
    });
  }
  if (result.kind === "redirect") {
    return isolatedPluginResponse(
      Response.redirect(result.location, result.status),
      context,
    );
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
      { profile: input.profile },
    );
  }

  const result = await input.dispatcher.dispatch({
    tenant: resolution.tenant,
    request: input.request,
    pathname: new URL(input.request.url).pathname as `/${string}`,
    surface: "api",
  });
  return pluginDispatchResponse(result, {
    profile: input.profile,
    tenant: resolution.tenant,
  });
}
