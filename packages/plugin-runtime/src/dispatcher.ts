import "server-only";

import {
  assertCapability,
  type CapabilityId,
} from "@oceanleo/capabilities/server";
import {
  normalizeHostHeader,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

import type {
  PluginBatchDefinition,
  PluginBatchId,
  PluginHandlerResult,
  PluginMethod,
  PluginRouteDeclaration,
  PluginRouteParams,
  PluginSurface,
  TenantPluginDefinition,
} from "./index";

export interface PluginDispatchRequest {
  readonly tenant: TenantDefinition;
  readonly request: Request;
  readonly pathname: `/${string}`;
  readonly surface: Exclude<PluginSurface, "both">;
}

export interface PluginNotFoundResult {
  readonly kind: "not-found";
  readonly status: 404;
}

export interface PluginMisdirectedResult {
  readonly kind: "misdirected";
  readonly status: 421;
}

export interface PluginPendingResult {
  readonly kind: "pending";
  readonly status: 501;
  readonly batchId: PluginBatchId;
  readonly pluginId: string;
  readonly routeId: string;
  readonly params: PluginRouteParams;
  readonly source: string;
}

export type PluginDispatchResult =
  | PluginHandlerResult
  | PluginNotFoundResult
  | PluginMisdirectedResult
  | PluginPendingResult;

export type PluginAuthorizer = (
  tenant: TenantDefinition,
  capability: CapabilityId,
) => void | Promise<void>;

export interface PluginDispatcher {
  readonly profile: AppProfile;
  readonly batchIds: readonly PluginBatchId[];
  readonly tenantKeys: readonly string[];
  dispatch(request: PluginDispatchRequest): Promise<PluginDispatchResult>;
}

interface MatchedRoute {
  readonly batch: PluginBatchDefinition;
  readonly plugin: TenantPluginDefinition;
  readonly route: PluginRouteDeclaration;
  readonly params: PluginRouteParams;
}

function pathSegments(path: string): readonly string[] | null {
  if (!path.startsWith("/") || path.includes("\\")) return null;
  const raw = path.split("/").slice(1);
  if (raw.at(-1) === "") raw.pop();
  try {
    return raw.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function matchPattern(
  pattern: string,
  pathname: string,
): PluginRouteParams | null {
  const patternSegments = pathSegments(pattern);
  const requestSegments = pathSegments(pathname);
  if (!patternSegments || !requestSegments) return null;

  const params: Record<string, string | readonly string[]> = {};
  let requestIndex = 0;
  for (let patternIndex = 0; patternIndex < patternSegments.length; patternIndex += 1) {
    const patternSegment = patternSegments[patternIndex]!;
    if (patternSegment.startsWith(":") && patternSegment.endsWith("*")) {
      params[patternSegment.slice(1, -1)] = Object.freeze(
        requestSegments.slice(requestIndex),
      );
      requestIndex = requestSegments.length;
      break;
    }
    const requestSegment = requestSegments[requestIndex];
    if (requestSegment === undefined) return null;
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = requestSegment;
    } else if (patternSegment !== requestSegment) {
      return null;
    }
    requestIndex += 1;
  }
  return requestIndex === requestSegments.length ? Object.freeze(params) : null;
}

function routeSpecificity(route: PluginRouteDeclaration): number {
  return route.pattern
    .split("/")
    .reduce(
      (score, segment) =>
        score +
        (segment.endsWith("*") ? 0 : segment.startsWith(":") ? 10 : 100) +
        segment.length,
      0,
    );
}

function methodMatches(
  methods: readonly PluginMethod[],
  requestMethod: string,
): boolean {
  const method = requestMethod.toUpperCase();
  return methods.includes("*") || methods.some((candidate) => candidate === method);
}

function surfaceMatches(
  route: PluginRouteDeclaration,
  surface: PluginDispatchRequest["surface"],
): boolean {
  if (route.surface !== "both" && route.surface !== surface) return false;
  if (surface === "page") {
    return route.kind === "page" || route.kind === "redirect";
  }
  return route.kind !== "page";
}

function hostMatches(route: PluginRouteDeclaration, request: Request): boolean {
  if (!route.hosts || route.hosts.length === 0) return true;
  const hostname = normalizeHostHeader(request.headers.get("host"));
  return hostname !== null && route.hosts.includes(hostname);
}

function resultMatchesRoute(
  route: PluginRouteDeclaration,
  result: PluginHandlerResult,
): boolean {
  if (route.kind === "page") return result.kind === "page";
  if (route.kind === "stream") {
    return result.kind === "stream" || result.kind === "response";
  }
  if (route.kind === "api") {
    return result.kind === "response" || result.kind === "redirect";
  }
  return result.kind === "redirect";
}

function redirectResult(
  route: PluginRouteDeclaration,
  request: Request,
  pathname: string,
): PluginHandlerResult {
  if (!route.redirect) {
    throw new Error(`${route.id}: redirect target is missing.`);
  }
  const sourceUrl = new URL(request.url);
  const destinationPath =
    route.redirect.path.mode === "preserve"
      ? pathname
      : route.redirect.path.value;
  const destination = new URL(
    `${destinationPath}${sourceUrl.search}`,
    `${route.redirect.protocol}://${route.redirect.host}`,
  );
  return {
    kind: "redirect",
    location: destination.toString(),
    status: route.redirect.status,
  };
}

export function createPluginDispatcher(
  profile: AppProfile,
  batches: readonly PluginBatchDefinition[],
  options: Readonly<{ authorize?: PluginAuthorizer }> = {},
): PluginDispatcher {
  const batchIds = new Set<PluginBatchId>();
  const pluginsByTenant = new Map<
    string,
    Readonly<{ batch: PluginBatchDefinition; plugin: TenantPluginDefinition }>
  >();

  for (const batch of batches) {
    if (batch.profile !== profile) {
      throw new Error(
        `${profile} dispatcher cannot load ${batch.profile} batch ${batch.id}.`,
      );
    }
    if (batchIds.has(batch.id)) {
      throw new Error(`${profile} dispatcher received duplicate batch ${batch.id}.`);
    }
    batchIds.add(batch.id);
    for (const plugin of batch.plugins) {
      if (pluginsByTenant.has(plugin.siteKey)) {
        throw new Error(`${profile} dispatcher received duplicate tenant ${plugin.siteKey}.`);
      }
      pluginsByTenant.set(plugin.siteKey, Object.freeze({ batch, plugin }));
    }
  }

  const authorize: PluginAuthorizer =
    options.authorize ??
    ((tenant, capability) => {
      assertCapability(tenant, capability);
    });

  return Object.freeze({
    profile,
    batchIds: Object.freeze([...batchIds].sort()),
    tenantKeys: Object.freeze([...pluginsByTenant.keys()].sort()),
    async dispatch(
      request: PluginDispatchRequest,
    ): Promise<PluginDispatchResult> {
      if (request.tenant.profile !== profile) {
        return Object.freeze({ kind: "misdirected", status: 421 });
      }
      const owner = pluginsByTenant.get(String(request.tenant.manifest.siteKey));
      if (!owner) {
        return Object.freeze({ kind: "not-found", status: 404 });
      }

      const candidates: MatchedRoute[] = [];
      for (const route of owner.plugin.routes) {
        if (
          route.parity.status === "retired" ||
          !surfaceMatches(route, request.surface) ||
          !methodMatches(route.methods, request.request.method) ||
          !hostMatches(route, request.request)
        ) {
          continue;
        }
        const params = matchPattern(route.pattern, request.pathname);
        if (params) {
          candidates.push({ ...owner, route, params });
        }
      }
      candidates.sort(
        (left, right) =>
          (right.route.priority ?? 0) - (left.route.priority ?? 0) ||
          routeSpecificity(right.route) - routeSpecificity(left.route) ||
          left.route.id.localeCompare(right.route.id),
      );
      const matched = candidates[0];
      if (!matched) {
        return Object.freeze({ kind: "not-found", status: 404 });
      }
      if (matched.route.parity.status === "pending") {
        return Object.freeze({
          kind: "pending",
          status: 501,
          batchId: matched.batch.id,
          pluginId: matched.plugin.id,
          routeId: matched.route.id,
          params: matched.params,
          source: matched.route.parity.source,
        });
      }

      await authorize(request.tenant, matched.route.capability);
      const result =
        matched.route.kind === "redirect"
          ? redirectResult(matched.route, request.request, request.pathname)
          : await matched.route.handler?.({
              tenant: request.tenant,
              request: request.request,
              pathname: request.pathname,
              params: matched.params,
              route: matched.route,
            });
      if (!result || !resultMatchesRoute(matched.route, result)) {
        throw new Error(
          `${matched.route.id}: handler result does not match ${matched.route.kind}.`,
        );
      }
      return result;
    },
  });
}
