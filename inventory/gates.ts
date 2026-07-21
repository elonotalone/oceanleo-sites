import { realpath, stat } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  BatchInventoryDeclaration,
  BatchInventoryEntry,
  PluginBatchDefinition,
  PluginMethod,
  PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";
import type { TenantDefinition } from "@oceanleo/tenant-registry";

import type { InventoryDocument, InventoryEntry } from "./build";
import type { FoundationRoute, InventoryKind } from "./source";

const API_METHODS: readonly Exclude<PluginMethod, "*">[] = Object.freeze([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

export type InventoryGateIssueCode =
  | "batch-seam"
  | "duplicate-foundation-ownership"
  | "duplicate-inventory-id"
  | "duplicate-route-ownership"
  | "evidence"
  | "extension-contract"
  | "inventory-summary"
  | "release-parity"
  | "route-contract"
  | "schema"
  | "unreachable-route";

export interface InventoryGateIssue {
  readonly code: InventoryGateIssueCode;
  readonly message: string;
}

function formattedIssues(issues: readonly InventoryGateIssue[]): string {
  const shown = issues
    .slice(0, 25)
    .map((issue) => `- [${issue.code}] ${issue.message}`);
  if (issues.length > shown.length) {
    shown.push(`- ... ${issues.length - shown.length} more issue(s)`);
  }
  return shown.join("\n");
}

export class InventoryGateError extends Error {
  override readonly name = "InventoryGateError";
  readonly issues!: readonly InventoryGateIssue[];

  constructor(scope: string, issues: readonly InventoryGateIssue[]) {
    super(
      `${scope} failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${formattedIssues(issues)}`,
    );
    Object.defineProperty(this, "issues", {
      configurable: false,
      enumerable: false,
      value: Object.freeze([...issues]),
      writable: false,
    });
  }
}

export interface InventoryReconciliationInput {
  readonly batches: readonly PluginBatchDefinition[];
  readonly inventories: readonly BatchInventoryDeclaration[];
  readonly tenants: readonly TenantDefinition[];
  readonly foundationRoutes: readonly FoundationRoute[];
}

export interface InventoryReconciliationReport {
  readonly pluginExtensions: number;
  readonly pluginRoutes: number;
  readonly routeContracts: number;
  readonly issues: readonly InventoryGateIssue[];
}

interface ProjectedRouteContract {
  readonly batchId: string;
  readonly migrationBatch: number;
  readonly profile: string;
  readonly tenantKey: string;
  readonly extensionId: string;
  readonly routeId: string;
  readonly route: string;
  readonly kind: Exclude<InventoryKind, "metadata" | "plugin-extension">;
  readonly surface: "api" | "page";
  readonly methods: readonly string[];
  readonly capabilities: readonly string[];
  readonly parity: BatchInventoryEntry["parity"];
  readonly hosts: readonly string[];
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return sorted(left).join("\0") === sorted(right).join("\0");
}

function parityKey(parity: BatchInventoryEntry["parity"]): string {
  return JSON.stringify([
    parity.status,
    parity.source,
    sorted(parity.evidence),
  ]);
}

function routeContractKey(
  contract: Readonly<{
    profile: string;
    tenantKey: string;
    route: string | null;
    kind: InventoryKind;
    methods: readonly string[];
    capabilities: readonly string[];
    extensionId: string | null;
    parity: BatchInventoryEntry["parity"];
  }>,
): string {
  return JSON.stringify([
    contract.profile,
    contract.tenantKey,
    contract.route,
    contract.kind,
    sorted(contract.methods),
    sorted(contract.capabilities),
    contract.extensionId,
    parityKey(contract.parity),
  ]);
}

function extensionKey(
  profile: string,
  tenantKey: string,
  extensionId: string | null,
): string {
  return JSON.stringify([profile, tenantKey, extensionId]);
}

function extensionParity(
  routes: readonly PluginRouteDeclaration[],
): BatchInventoryEntry["parity"]["status"] | null {
  if (routes.length === 0) return null;
  if (routes.some((route) => route.parity.status === "pending")) {
    return "pending";
  }
  if (routes.some((route) => route.parity.status === "partial")) {
    return "partial";
  }
  if (routes.some((route) => route.parity.status === "verified")) {
    return "verified";
  }
  return "retired";
}

function routeSurfaces(
  route: PluginRouteDeclaration,
): readonly ("api" | "page")[] {
  const surfaces: ("api" | "page")[] = [];
  if (
    (route.surface === "page" || route.surface === "both") &&
    (route.kind === "page" || route.kind === "redirect")
  ) {
    surfaces.push("page");
  }
  if (
    (route.surface === "api" || route.surface === "both") &&
    route.kind !== "page"
  ) {
    surfaces.push("api");
  }
  return surfaces;
}

function patternSegments(pattern: string): readonly string[] | null {
  if (!pattern.startsWith("/") || pattern.includes("\\") || pattern.includes("//")) {
    return null;
  }
  if (pattern === "/") return Object.freeze([]);
  const segments = pattern.slice(1).split("/");
  if (
    segments.some(
      (segment, index) =>
        segment.length === 0 ||
        (segment.includes("*") &&
          (!/^:[A-Za-z][A-Za-z0-9_]*\*$/.test(segment) ||
            index !== segments.length - 1)) ||
        (segment.startsWith(":") &&
          !/^:[A-Za-z][A-Za-z0-9_]*\*?$/.test(segment)),
    )
  ) {
    return null;
  }
  return segments;
}

function patternMatchesPath(pattern: string, pathname: string): boolean {
  const patternParts = patternSegments(pattern);
  const pathParts = patternSegments(pathname);
  if (!patternParts || !pathParts) return false;
  let pathIndex = 0;
  for (const segment of patternParts) {
    if (segment.startsWith(":") && segment.endsWith("*")) {
      return true;
    }
    const pathSegment = pathParts[pathIndex];
    if (pathSegment === undefined) return false;
    if (!segment.startsWith(":") && segment !== pathSegment) return false;
    pathIndex += 1;
  }
  return pathIndex === pathParts.length;
}

function mountedSurfaceCanReach(
  pattern: string,
  surface: "api" | "page",
): boolean {
  const segments = patternSegments(pattern);
  if (!segments || segments.length === 0) return false;
  const first = segments[0]!;
  if (surface === "page") {
    return first.startsWith(":") || first !== "api";
  }
  if (first.startsWith(":") && first.endsWith("*")) return true;
  if (!first.startsWith(":") && first !== "api") return false;
  if (segments.length >= 2) return true;
  return false;
}

function expandedMethods(
  methods: readonly string[],
): readonly string[] {
  return methods.includes("*") ? API_METHODS : sorted(methods);
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function displayContractKey(key: string): string {
  const [
    profile,
    tenantKey,
    route,
    kind,
    methods,
    capabilities,
    extensionId,
    parity,
  ] = JSON.parse(key) as [
    string,
    string,
    string,
    string,
    string[],
    string[],
    string,
    string,
  ];
  const [status] = JSON.parse(parity) as [string];
  return `${profile}/${tenantKey} ${kind} ${route} methods=${methods.join(",")} capability=${capabilities.join(",")} extension=${extensionId} parity=${status}`;
}

function pushIssue(
  issues: InventoryGateIssue[],
  code: InventoryGateIssueCode,
  message: string,
): void {
  issues.push(Object.freeze({ code, message }));
}

export function inspectInventoryReconciliation(
  input: InventoryReconciliationInput,
): InventoryReconciliationReport {
  const issues: InventoryGateIssue[] = [];
  const tenantsByKey = new Map(
    input.tenants.map((tenant) => [
      String(tenant.manifest.siteKey),
      tenant,
    ]),
  );
  const batchesById = new Map<string, PluginBatchDefinition>();
  const inventoriesById = new Map<string, BatchInventoryDeclaration>();

  for (const batch of input.batches) {
    if (batchesById.has(batch.id)) {
      pushIssue(issues, "batch-seam", `Duplicate plugin batch ${batch.id}.`);
    } else {
      batchesById.set(batch.id, batch);
    }
  }
  for (const declaration of input.inventories) {
    if (inventoriesById.has(declaration.batchId)) {
      pushIssue(
        issues,
        "batch-seam",
        `Duplicate inventory batch ${declaration.batchId}.`,
      );
    } else {
      inventoriesById.set(declaration.batchId, declaration);
    }
  }

  const projectedRoutes: ProjectedRouteContract[] = [];
  const expectedExtensions = new Map<string, number>();
  const expectedExtensionParity = new Map<
    string,
    BatchInventoryEntry["parity"]["status"]
  >();
  let pluginRoutes = 0;

  for (const batch of input.batches) {
    const declaration = inventoriesById.get(batch.id);
    if (
      !declaration ||
      declaration.profile !== batch.profile ||
      declaration.migrationBatch !== batch.migrationBatch ||
      declaration.ownerPath !== batch.ownerPath ||
      !sameStrings(
        declaration.tenantKeys,
        batch.plugins.map((plugin) => plugin.siteKey),
      )
    ) {
      pushIssue(
        issues,
        "batch-seam",
        `${batch.id}: plugin and inventory batch metadata do not match.`,
      );
    }

    for (const plugin of batch.plugins) {
      const tenant = tenantsByKey.get(plugin.siteKey);
      if (
        !tenant ||
        tenant.profile !== batch.profile ||
        tenant.migrationBatch !== batch.migrationBatch ||
        tenant.plugin.id !== plugin.id
      ) {
        pushIssue(
          issues,
          "batch-seam",
          `${batch.id}/${plugin.siteKey}: plugin is outside its tenant/profile ownership.`,
        );
        continue;
      }
      const pluginExtensionKey = extensionKey(
        batch.profile,
        plugin.siteKey,
        plugin.id,
      );
      addCount(expectedExtensions, pluginExtensionKey);
      const expectedParity = extensionParity(plugin.routes);
      if (expectedParity) {
        expectedExtensionParity.set(pluginExtensionKey, expectedParity);
      }

      const tenantHosts = tenant.domains.map((domain) => domain.host);
      for (const route of plugin.routes) {
        pluginRoutes += 1;
        const surfaces = routeSurfaces(route);
        const declaredSurfaceCount = route.surface === "both" ? 2 : 1;
        if (surfaces.length !== declaredSurfaceCount) {
          pushIssue(
            issues,
            "unreachable-route",
            `${batch.id}/${plugin.siteKey}/${route.id}: ${route.kind} cannot execute on declared surface ${route.surface}.`,
          );
        }
        if (
          surfaces.includes("page") &&
          !route.methods.includes("*") &&
          (!route.methods.includes("GET") ||
            route.methods.some(
              (method) => method !== "GET" && method !== "HEAD",
            ))
        ) {
          pushIssue(
            issues,
            "unreachable-route",
            `${batch.id}/${plugin.siteKey}/${route.id}: page dispatch requires GET and permits only GET/HEAD methods.`,
          );
        }

        const unknownHosts = (route.hosts ?? []).filter(
          (host) => !tenantHosts.includes(host),
        );
        for (const host of unknownHosts) {
          pushIssue(
            issues,
            "unreachable-route",
            `${batch.id}/${plugin.siteKey}/${route.id}: host ${host} cannot resolve to this tenant.`,
          );
        }
        const hosts =
          route.hosts && route.hosts.length > 0
            ? route.hosts.filter((host) => tenantHosts.includes(host))
            : tenantHosts;
        for (const surface of surfaces) {
          if (!mountedSurfaceCanReach(route.pattern, surface)) {
            pushIssue(
              issues,
              "unreachable-route",
              `${batch.id}/${plugin.siteKey}/${route.id}: pattern ${route.pattern} cannot reach the ${surface} catch-all.`,
            );
          }
          projectedRoutes.push({
            batchId: batch.id,
            migrationBatch: batch.migrationBatch,
            profile: batch.profile,
            tenantKey: plugin.siteKey,
            extensionId: plugin.id,
            routeId: route.id,
            route: route.pattern,
            // Page catch-all inventory kind is "page" only for concrete GET/HEAD
            // page routes. Wildcard method redirects (surface both) inventory as
            // route-handler on every executable surface so schema + contract keys
            // stay consistent.
            kind:
              surface === "page" && !route.methods.includes("*")
                ? "page"
                : "route-handler",
            surface,
            methods: route.methods,
            capabilities: [route.capability],
            parity: route.parity,
            hosts,
          });
        }
      }
    }
  }

  for (const declaration of input.inventories) {
    if (!batchesById.has(declaration.batchId)) {
      pushIssue(
        issues,
        "batch-seam",
        `${declaration.batchId}: inventory has no plugin batch.`,
      );
    }
  }

  const actualExtensions = new Map<string, number>();
  const expectedRouteContracts = new Map<string, number>();
  const actualRouteContracts = new Map<string, number>();
  const inventoryIds = new Map<string, string>();

  for (const contract of projectedRoutes) {
    addCount(expectedRouteContracts, routeContractKey(contract));
  }
  for (const declaration of input.inventories) {
    for (const entry of declaration.entries) {
      const priorBatch = inventoryIds.get(entry.id);
      if (priorBatch) {
        pushIssue(
          issues,
          "duplicate-inventory-id",
          `${entry.id} is declared by both ${priorBatch} and ${declaration.batchId}.`,
        );
      } else {
        inventoryIds.set(entry.id, declaration.batchId);
      }
      if (entry.kind === "plugin-extension") {
        if (
          entry.route !== null ||
          entry.extensionId === null ||
          entry.methods.length !== 0
        ) {
          pushIssue(
            issues,
            "extension-contract",
            `${declaration.batchId}/${entry.id}: plugin extensions require a null route, extension ID, and no methods.`,
          );
        }
        const pluginExtensionKey = extensionKey(
          declaration.profile,
          entry.tenantKey,
          entry.extensionId,
        );
        addCount(actualExtensions, pluginExtensionKey);
        const expectedParity = expectedExtensionParity.get(pluginExtensionKey);
        if (expectedParity && entry.parity.status !== expectedParity) {
          pushIssue(
            issues,
            "extension-contract",
            `${declaration.batchId}/${entry.id}: extension parity ${entry.parity.status} does not summarize route parity ${expectedParity}.`,
          );
        }
      } else {
        addCount(
          actualRouteContracts,
          routeContractKey({
            profile: declaration.profile,
            tenantKey: entry.tenantKey,
            route: entry.route,
            kind: entry.kind,
            methods: entry.methods,
            capabilities: entry.capabilities,
            extensionId: entry.extensionId,
            parity: entry.parity,
          }),
        );
      }
    }
  }

  for (const key of new Set([
    ...expectedExtensions.keys(),
    ...actualExtensions.keys(),
  ])) {
    const expected = expectedExtensions.get(key) ?? 0;
    const actual = actualExtensions.get(key) ?? 0;
    if (expected !== actual) {
      const [profile, tenantKey, extensionId] = JSON.parse(key) as [
        string,
        string,
        string,
      ];
      pushIssue(
        issues,
        "extension-contract",
        `${profile}/${tenantKey}/${extensionId}: expected ${expected} plugin-extension entry, received ${actual}.`,
      );
    }
  }

  for (const key of new Set([
    ...expectedRouteContracts.keys(),
    ...actualRouteContracts.keys(),
  ])) {
    const expected = expectedRouteContracts.get(key) ?? 0;
    const actual = actualRouteContracts.get(key) ?? 0;
    if (actual < expected) {
      pushIssue(
        issues,
        "route-contract",
        `Missing ${expected - actual} inventory projection for ${displayContractKey(key)}.`,
      );
    } else if (actual > expected) {
      pushIssue(
        issues,
        "route-contract",
        `Orphaned ${actual - expected} inventory projection for ${displayContractKey(key)}.`,
      );
    }
  }

  const ownership = new Map<string, string>();
  const reportedOwnership = new Set<string>();
  for (const contract of projectedRoutes) {
    if (contract.parity.status === "retired") continue;
    for (const host of contract.hosts) {
      for (const method of expandedMethods(contract.methods)) {
        const key = JSON.stringify([
          host,
          contract.surface,
          method,
          contract.route,
        ]);
        const owner = `${contract.batchId}/${contract.tenantKey}/${contract.routeId}`;
        const prior = ownership.get(key);
        if (prior && prior !== owner && !reportedOwnership.has(key)) {
          reportedOwnership.add(key);
          pushIssue(
            issues,
            "duplicate-route-ownership",
            `${host} ${contract.surface} ${method} ${contract.route} is owned by both ${prior} and ${owner}.`,
          );
        } else if (!prior) {
          ownership.set(key, owner);
        }
      }
    }
  }

  const reportedFoundation = new Set<string>();
  for (const contract of projectedRoutes) {
    if (contract.parity.status === "retired") continue;
    const segments = patternSegments(contract.route);
    // Pure param/catch-all patterns cannot steal Next.js foundation files
    // (`app/page.tsx`, `app/robots.ts`, `app/api/health/route.ts`, …) because
    // those static mounts outrank `[...segments]`. Only patterns with a
    // literal prefix (for example `/api/:path*`) can truly shadow foundation.
    if (
      segments &&
      segments.length > 0 &&
      segments.every((segment) => segment.startsWith(":"))
    ) {
      continue;
    }
    for (const foundation of input.foundationRoutes) {
      if (!patternMatchesPath(contract.route, foundation.route)) continue;
      const key = JSON.stringify([
        contract.profile,
        contract.tenantKey,
        contract.routeId,
        foundation.route,
      ]);
      if (reportedFoundation.has(key)) continue;
      reportedFoundation.add(key);
      pushIssue(
        issues,
        "duplicate-foundation-ownership",
        `${contract.batchId}/${contract.tenantKey}/${contract.routeId} pattern ${contract.route} shadows foundation route ${foundation.route}.`,
      );
    }
  }

  return Object.freeze({
    pluginExtensions: expectedExtensions.size,
    pluginRoutes,
    routeContracts: projectedRoutes.length,
    issues: Object.freeze(issues),
  });
}

export function assertInventoryReconciliation(
  input: InventoryReconciliationInput,
): InventoryReconciliationReport {
  const report = inspectInventoryReconciliation(input);
  if (report.issues.length > 0) {
    throw new InventoryGateError(
      "Plugin route/inventory reconciliation",
      report.issues,
    );
  }
  return report;
}

function computedParity(
  entries: readonly InventoryEntry[],
): InventoryDocument["summary"]["parity"] {
  const parity: Record<keyof InventoryDocument["summary"]["parity"], number> = {
    foundation: 0,
    pending: 0,
    partial: 0,
    verified: 0,
    retired: 0,
  };
  for (const entry of entries) parity[entry.parity.status] += 1;
  return parity;
}

export function inspectInventorySummary(
  document: InventoryDocument,
): readonly InventoryGateIssue[] {
  const issues: InventoryGateIssue[] = [];
  const parity = computedParity(document.entries);
  if (document.entries.length !== document.summary.entries) {
    pushIssue(
      issues,
      "inventory-summary",
      `summary.entries=${document.summary.entries}, actual=${document.entries.length}.`,
    );
  }
  for (const status of Object.keys(parity) as readonly (keyof typeof parity)[]) {
    if (document.summary.parity[status] !== parity[status]) {
      pushIssue(
        issues,
        "inventory-summary",
        `summary.parity.${status}=${document.summary.parity[status]}, actual=${parity[status]}.`,
      );
    }
  }
  return Object.freeze(issues);
}

export function assertInventorySummary(document: InventoryDocument): void {
  const issues = inspectInventorySummary(document);
  if (issues.length > 0) {
    throw new InventoryGateError("Inventory summary", issues);
  }
}

export interface ReleaseParityStatus {
  readonly pending: number;
  readonly partial: number;
  readonly verified: number;
  readonly retired: number;
  readonly ready: boolean;
}

export function releaseParityStatus(
  document: InventoryDocument,
): ReleaseParityStatus {
  const parity = computedParity(document.entries);
  return Object.freeze({
    pending: parity.pending,
    partial: parity.partial,
    verified: parity.verified,
    retired: parity.retired,
    ready: parity.pending === 0 && parity.partial === 0,
  });
}

export function assertReleaseParity(
  document: InventoryDocument,
): ReleaseParityStatus {
  const status = releaseParityStatus(document);
  const issues = inspectReleaseParity(document);
  if (issues.length > 0) {
    throw new InventoryGateError("Inventory release parity", issues);
  }
  return status;
}

export function inspectReleaseParity(
  document: InventoryDocument,
): readonly InventoryGateIssue[] {
  const status = releaseParityStatus(document);
  if (status.ready) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      code: "release-parity" as const,
      message: `pending=${status.pending}, partial=${status.partial}; release requires pending=0 and partial=0.`,
    }),
  ]);
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

function isRepositoryFileEvidence(evidence: string): boolean {
  return /^(?:packages|apps|deploy|inventory|scripts|tests|generated|retirement)\//.test(
    evidence,
  );
}

export async function inspectEvidenceFiles(
  document: InventoryDocument,
  repositoryRoot: string,
): Promise<readonly InventoryGateIssue[]> {
  const issues: InventoryGateIssue[] = [];
  const root = await realpath(repositoryRoot);
  const checked = new Map<string, string | null>();

  for (const entry of document.entries) {
    if (
      (entry.parity.status === "verified" ||
        entry.parity.status === "retired") &&
      entry.parity.evidence.length === 0
    ) {
      pushIssue(
        issues,
        "evidence",
        `${entry.id}: ${entry.parity.status} entries require explicit evidence.`,
      );
    }
    for (const evidence of entry.parity.evidence) {
      let failure = checked.get(evidence);
      if (failure === undefined) {
        failure = null;
        if (
          evidence.length === 0 ||
          evidence !== evidence.trim() ||
          isAbsolute(evidence)
        ) {
          failure = "must be a non-empty repository-relative path";
        } else if (!isRepositoryFileEvidence(evidence)) {
          // Symbolic provenance (legacy repo paths, package exports) stays
          // machine-readable without requiring a file inside this monorepo.
          failure = null;
        } else {
          const candidate = resolve(root, evidence);
          if (!isInside(root, candidate)) {
            failure = "escapes the repository";
          } else {
            try {
              const [resolvedEvidence, evidenceStat] = await Promise.all([
                realpath(candidate),
                stat(candidate),
              ]);
              if (!isInside(root, resolvedEvidence)) {
                failure = "resolves outside the repository";
              } else if (!evidenceStat.isFile()) {
                failure = "is not a file";
              }
            } catch {
              failure = "does not exist";
            }
          }
        }
        checked.set(evidence, failure);
      }
      if (failure) {
        pushIssue(
          issues,
          "evidence",
          `${entry.id}: evidence ${JSON.stringify(evidence)} ${failure}.`,
        );
      }
    }
  }
  return Object.freeze(issues);
}

export async function assertEvidenceFiles(
  document: InventoryDocument,
  repositoryRoot: string,
): Promise<void> {
  const issues = await inspectEvidenceFiles(document, repositoryRoot);
  if (issues.length > 0) {
    throw new InventoryGateError("Inventory evidence", issues);
  }
}
