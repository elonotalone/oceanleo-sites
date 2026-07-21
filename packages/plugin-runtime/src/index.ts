import type { CapabilityId } from "@oceanleo/capabilities/server";
import {
  normalizeHostHeader,
  tenantForSiteKey,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";
import type { ReactNode } from "react";

export type PluginBatchId =
  | "office"
  | "media"
  | "knowledge"
  | "creation"
  | "platform"
  | "website-privileged";

export type MigrationBatchNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type PluginSurface = "page" | "api" | "both";
export type PluginRouteKind = "page" | "api" | "redirect" | "stream";
export type PluginMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "*";
export type PluginParityStatus =
  | "pending"
  | "partial"
  | "verified"
  | "retired";

export interface PluginParity {
  readonly status: PluginParityStatus;
  readonly source: string;
  readonly evidence: readonly string[];
}

export type PluginRouteParams = Readonly<
  Record<string, string | readonly string[]>
>;

export interface PluginPageResult {
  readonly kind: "page";
  readonly node: ReactNode;
}

export interface PluginResponseResult {
  readonly kind: "response";
  readonly response: Response;
}

export interface PluginStreamResult {
  readonly kind: "stream";
  readonly stream: ReadableStream<Uint8Array>;
  readonly status?: number;
  readonly headers?: HeadersInit;
}

export interface PluginRedirectResult {
  readonly kind: "redirect";
  readonly location: string;
  readonly status: 301 | 302 | 307 | 308;
}

export type PluginHandlerResult =
  | PluginPageResult
  | PluginResponseResult
  | PluginStreamResult
  | PluginRedirectResult;

export interface PluginHandlerContext {
  readonly tenant: TenantDefinition;
  readonly request: Request;
  readonly pathname: string;
  readonly params: PluginRouteParams;
  readonly route: PluginRouteDeclaration;
}

export type PluginRouteHandler = (
  context: PluginHandlerContext,
) => PluginHandlerResult | Promise<PluginHandlerResult>;

export interface PluginRedirectTarget {
  readonly protocol: "https";
  readonly host: string;
  readonly path:
    | Readonly<{ readonly mode: "preserve" }>
    | Readonly<{ readonly mode: "fixed"; readonly value: `/${string}` }>;
  readonly status: 301 | 302 | 307 | 308;
}

export interface PluginRouteDeclaration {
  readonly id: string;
  readonly kind: PluginRouteKind;
  readonly surface: PluginSurface;
  readonly pattern: `/${string}`;
  readonly methods: readonly PluginMethod[];
  readonly hosts?: readonly string[];
  readonly capability: CapabilityId;
  readonly priority?: number;
  readonly parity: PluginParity;
  readonly redirect?: PluginRedirectTarget;
  readonly handler?: PluginRouteHandler;
}

export interface TenantPluginDefinition {
  readonly id: string;
  readonly siteKey: string;
  readonly routes: readonly PluginRouteDeclaration[];
}

export interface PluginBatchDefinition {
  readonly id: PluginBatchId;
  readonly migrationBatch: MigrationBatchNumber;
  readonly profile: AppProfile;
  readonly ownerPath: `packages/${string}`;
  readonly plugins: readonly TenantPluginDefinition[];
}

export interface PendingAliasRedirect {
  readonly sourceHost: string;
  readonly destinationHost: string;
  readonly status?: 301 | 302 | 307 | 308;
}

export interface PendingTenantPlugin {
  readonly siteKey: string;
  readonly extensionId: string;
  readonly aliases?: readonly PendingAliasRedirect[];
}

function frozenStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function assertRoute(route: PluginRouteDeclaration): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(route.id)) {
    throw new Error(`Invalid plugin route id: ${route.id}`);
  }
  if (!route.pattern.startsWith("/") || route.pattern.includes("//")) {
    throw new Error(`${route.id}: route pattern must be an absolute path.`);
  }
  if (route.methods.length === 0) {
    throw new Error(`${route.id}: route must declare at least one method.`);
  }
  if (new Set(route.methods).size !== route.methods.length) {
    throw new Error(`${route.id}: duplicate route methods.`);
  }
  if (
    route.hosts?.some(
      (host) => normalizeHostHeader(host) !== host || host.includes(":"),
    ) ||
    (route.hosts && new Set(route.hosts).size !== route.hosts.length)
  ) {
    throw new Error(`${route.id}: route hosts must be unique normalized names.`);
  }
  const patternSegments = route.pattern.split("/").slice(1);
  const params = patternSegments.filter((segment) => segment.startsWith(":"));
  const paramNames = params.map((segment) =>
    segment.replace(/^:/, "").replace(/\*$/, ""),
  );
  if (
    paramNames.some((name) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) ||
    new Set(paramNames).size !== paramNames.length
  ) {
    throw new Error(`${route.id}: invalid or duplicate route parameter.`);
  }
  if (
    patternSegments.some(
      (segment) =>
        segment.includes("*") &&
        !/^:[A-Za-z][A-Za-z0-9_]*\*$/.test(segment),
    )
  ) {
    throw new Error(`${route.id}: invalid catch-all parameter.`);
  }
  const catchAllIndex = patternSegments.findIndex((segment) =>
    segment.endsWith("*"),
  );
  if (catchAllIndex >= 0 && catchAllIndex !== patternSegments.length - 1) {
    throw new Error(`${route.id}: catch-all parameter must be last.`);
  }
  if (route.kind === "redirect" && !route.redirect) {
    throw new Error(`${route.id}: redirect route requires a target.`);
  }
  if (
    route.redirect &&
    (route.redirect.protocol !== "https" ||
      normalizeHostHeader(route.redirect.host) !== route.redirect.host ||
      route.redirect.host.includes(":") ||
      ![301, 302, 307, 308].includes(route.redirect.status) ||
      (route.redirect.path.mode === "fixed" &&
        (!route.redirect.path.value.startsWith("/") ||
          route.redirect.path.value.startsWith("//") ||
          route.redirect.path.value.includes("\\"))))
  ) {
    throw new Error(`${route.id}: redirect target is not an exact safe URL.`);
  }
  if (
    route.kind === "redirect" &&
    route.surface !== "api" &&
    route.redirect &&
    ![307, 308].includes(route.redirect.status)
  ) {
    throw new Error(
      `${route.id}: page redirects must use a Next-compatible 307 or 308 status.`,
    );
  }
  if (route.kind !== "redirect" && route.redirect) {
    throw new Error(`${route.id}: only redirect routes accept a target.`);
  }
  if (route.parity.status === "pending" && route.handler) {
    throw new Error(`${route.id}: pending routes cannot invoke handlers.`);
  }
  if (
    route.parity.status !== "pending" &&
    route.parity.status !== "retired" &&
    route.kind !== "redirect" &&
    !route.handler
  ) {
    throw new Error(`${route.id}: active route requires a handler.`);
  }
}

export function definePluginBatch(
  batch: PluginBatchDefinition,
): PluginBatchDefinition {
  if (!batch.ownerPath.startsWith("packages/migration-")) {
    throw new Error(`${batch.id}: batch owner must be a migration package.`);
  }
  if (batch.plugins.length === 0) {
    throw new Error(`${batch.id}: batch must own at least one tenant plugin.`);
  }

  const pluginIds = new Set<string>();
  const siteKeys = new Set<string>();
  const frozenPlugins = batch.plugins.map((plugin) => {
    if (pluginIds.has(plugin.id) || siteKeys.has(plugin.siteKey)) {
      throw new Error(`${batch.id}: duplicate plugin id or tenant.`);
    }
    pluginIds.add(plugin.id);
    siteKeys.add(plugin.siteKey);

    const tenant = tenantForSiteKey(plugin.siteKey);
    if (
      !tenant ||
      tenant.profile !== batch.profile ||
      tenant.migrationBatch !== batch.migrationBatch ||
      tenant.plugin.id !== plugin.id
    ) {
      throw new Error(`${batch.id}: ${plugin.siteKey} violates tenant ownership.`);
    }

    const routeIds = new Set<string>();
    const routes = plugin.routes.map((route) => {
      assertRoute(route);
      if (routeIds.has(route.id)) {
        throw new Error(`${batch.id}/${plugin.siteKey}: duplicate route id.`);
      }
      routeIds.add(route.id);
      return Object.freeze({
        ...route,
        methods: Object.freeze([...route.methods]),
        hosts: route.hosts ? frozenStrings(route.hosts) : undefined,
        parity: Object.freeze({
          ...route.parity,
          evidence: frozenStrings(route.parity.evidence),
        }),
        redirect: route.redirect
          ? Object.freeze({
              ...route.redirect,
              path: Object.freeze({ ...route.redirect.path }),
            })
          : undefined,
      });
    });
    return Object.freeze({ ...plugin, routes: Object.freeze(routes) });
  });

  return Object.freeze({ ...batch, plugins: Object.freeze(frozenPlugins) });
}

export function createPendingPluginBatch(input: Readonly<{
  id: PluginBatchId;
  migrationBatch: MigrationBatchNumber;
  profile: AppProfile;
  ownerPath: `packages/${string}`;
  tenants: readonly PendingTenantPlugin[];
}>): PluginBatchDefinition {
  return definePluginBatch({
    id: input.id,
    migrationBatch: input.migrationBatch,
    profile: input.profile,
    ownerPath: input.ownerPath,
    plugins: input.tenants.map((tenant) => ({
      id: tenant.extensionId,
      siteKey: tenant.siteKey,
      routes: [
        ...(tenant.aliases ?? []).map(
          (alias): PluginRouteDeclaration => ({
            id: `${tenant.siteKey}.alias.${alias.sourceHost.replaceAll(".", "-")}`,
            kind: "redirect",
            surface: "both",
            pattern: "/:path*",
            methods: ["*"],
            hosts: [alias.sourceHost],
            capability: "shell:render",
            priority: 100,
            parity: {
              status: "pending",
              source: `legacy:${tenant.siteKey}:host-alias`,
              evidence: [],
            },
            redirect: {
              protocol: "https",
              host: alias.destinationHost,
              path: { mode: "preserve" },
              status: alias.status ?? 308,
            },
          }),
        ),
        {
          id: `${tenant.siteKey}.workspace.pending`,
          kind: "page",
          surface: "page",
          pattern: "/workspace/:path*",
          methods: ["GET", "HEAD"],
          capability: "workbench:advanced",
          parity: {
            status: "pending",
            source: `legacy:${tenant.siteKey}:workspace`,
            evidence: [],
          },
        },
      ],
    })),
  });
}

export type BatchInventoryKind =
  | "page"
  | "route-handler"
  | "metadata"
  | "plugin-extension";

export interface BatchInventoryEntry {
  readonly id: string;
  readonly tenantKey: string;
  readonly route: string | null;
  readonly kind: BatchInventoryKind;
  readonly methods: readonly string[];
  readonly capabilities: readonly string[];
  readonly extensionId: string | null;
  readonly parity: Readonly<{
    readonly status: PluginParityStatus;
    readonly source: string;
    readonly evidence: readonly string[];
  }>;
}

export interface BatchInventoryDeclaration {
  readonly batchId: PluginBatchId;
  readonly migrationBatch: MigrationBatchNumber;
  readonly profile: AppProfile;
  readonly ownerPath: `packages/${string}`;
  readonly testPath: `packages/${string}`;
  readonly tenantKeys: readonly string[];
  readonly entries: readonly BatchInventoryEntry[];
}

export function defineBatchInventory(
  declaration: BatchInventoryDeclaration,
): BatchInventoryDeclaration {
  const tenantKeys = new Set(declaration.tenantKeys);
  if (
    declaration.tenantKeys.length === 0 ||
    tenantKeys.size !== declaration.tenantKeys.length
  ) {
    throw new Error(`${declaration.batchId}: invalid inventory tenant set.`);
  }
  if (
    !declaration.ownerPath.startsWith("packages/migration-") ||
    !declaration.testPath.startsWith(`${declaration.ownerPath}/tests/`)
  ) {
    throw new Error(`${declaration.batchId}: inventory ownership path mismatch.`);
  }
  const entryIds = new Set<string>();
  const entries = declaration.entries.map((entry) => {
    if (!tenantKeys.has(entry.tenantKey) || entryIds.has(entry.id)) {
      throw new Error(`${declaration.batchId}: invalid or duplicate inventory entry.`);
    }
    entryIds.add(entry.id);
    return Object.freeze({
      ...entry,
      methods: frozenStrings(entry.methods),
      capabilities: frozenStrings(entry.capabilities),
      parity: Object.freeze({
        ...entry.parity,
        evidence: frozenStrings(entry.parity.evidence),
      }),
    });
  });
  return Object.freeze({
    ...declaration,
    tenantKeys: frozenStrings(declaration.tenantKeys),
    entries: Object.freeze(entries),
  });
}

export function createPendingBatchInventory(input: Readonly<{
  batch: PluginBatchDefinition;
  testPath: `packages/${string}`;
  extraEntries?: readonly BatchInventoryEntry[];
}>): BatchInventoryDeclaration {
  return defineBatchInventory({
    batchId: input.batch.id,
    migrationBatch: input.batch.migrationBatch,
    profile: input.batch.profile,
    ownerPath: input.batch.ownerPath,
    testPath: input.testPath,
    tenantKeys: input.batch.plugins.map((plugin) => plugin.siteKey),
    entries: [
      ...input.batch.plugins.map(
        (plugin): BatchInventoryEntry => ({
          id: `plugin:${input.batch.profile}:${plugin.siteKey}:${plugin.id}`,
          tenantKey: plugin.siteKey,
          route: null,
          kind: "plugin-extension",
          methods: [],
          capabilities: ["workbench:advanced"],
          extensionId: plugin.id,
          parity: {
            status: "pending",
            source: `legacy:${plugin.siteKey}`,
            evidence: [],
          },
        }),
      ),
      ...(input.extraEntries ?? []),
    ],
  });
}
