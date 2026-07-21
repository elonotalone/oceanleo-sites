import { ALL_BATCH_INVENTORIES } from "@oceanleo/plugin-registry/inventory";
import { TENANTS, type AppProfile } from "@oceanleo/tenant-registry";

import {
  FOUNDATION_ROUTES,
  INVENTORY_SCHEMA,
  INVENTORY_SOURCE_REVISION,
  type InventoryKind,
  type ParityStatus,
} from "./source";

export interface InventoryEntry {
  readonly id: string;
  readonly appProfile: AppProfile;
  readonly tenantKey: string;
  readonly route: string | null;
  readonly kind: InventoryKind;
  readonly methods: readonly string[];
  readonly capabilities: readonly string[];
  readonly extensionId: string | null;
  readonly migrationBatch: number;
  readonly parity: Readonly<{
    status: ParityStatus;
    source: string;
    evidence: readonly string[];
  }>;
}

export interface InventoryDocument {
  readonly schema: typeof INVENTORY_SCHEMA;
  readonly sourceRevision: typeof INVENTORY_SOURCE_REVISION;
  readonly summary: Readonly<{
    tenants: number;
    standardTenants: number;
    privilegedTenants: number;
    domains: number;
    entries: number;
    parity: Readonly<Record<ParityStatus, number>>;
  }>;
  readonly entries: readonly InventoryEntry[];
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function buildInventory(): InventoryDocument {
  const entries: InventoryEntry[] = [];
  const tenants = [...TENANTS].sort((left, right) =>
    String(left.manifest.siteKey).localeCompare(
      String(right.manifest.siteKey),
    ),
  );

  for (const tenant of tenants) {
    const tenantKey = String(tenant.manifest.siteKey);
    for (const foundation of [...FOUNDATION_ROUTES].sort((left, right) =>
      left.route.localeCompare(right.route),
    )) {
      entries.push({
        id: `foundation:${tenant.profile}:${tenantKey}:${foundation.route}`,
        appProfile: tenant.profile,
        tenantKey,
        route: foundation.route,
        kind: foundation.kind,
        methods: sorted(foundation.methods),
        capabilities: sorted(foundation.capabilities),
        extensionId: null,
        migrationBatch: tenant.migrationBatch,
        parity: {
          status: "foundation",
          source: `apps/${tenant.profile === "standard" ? "standard" : "website-privileged"}`,
          evidence: ["tests/app-profiles.test.ts"],
        },
      });
    }
  }

  const tenantsByKey = new Map(
    tenants.map((tenant) => [String(tenant.manifest.siteKey), tenant]),
  );
  for (const declaration of ALL_BATCH_INVENTORIES) {
    for (const tenantKey of declaration.tenantKeys) {
      const tenant = tenantsByKey.get(tenantKey);
      if (
        !tenant ||
        tenant.profile !== declaration.profile ||
        tenant.migrationBatch !== declaration.migrationBatch
      ) {
        throw new Error(
          `${declaration.batchId}: inventory tenant ${tenantKey} violates ownership.`,
        );
      }
    }
    for (const entry of declaration.entries) {
      entries.push({
        id: entry.id,
        appProfile: declaration.profile,
        tenantKey: entry.tenantKey,
        route: entry.route,
        kind: entry.kind,
        methods: sorted(entry.methods),
        capabilities: sorted(entry.capabilities),
        extensionId: entry.extensionId,
        migrationBatch: declaration.migrationBatch,
        parity: {
          status: entry.parity.status,
          source: entry.parity.source,
          evidence: sorted(entry.parity.evidence),
        },
      });
    }
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("Route/handler inventory contains duplicate IDs.");
  }
  if (
    entries.some(
      (entry) =>
        entry.appProfile === "standard" &&
        (entry.tenantKey === "website" ||
          entry.capabilities.some((capability) =>
            capability.startsWith("website:") && capability !== "website:launch"
          )),
    )
  ) {
    throw new Error("Website privileged authority leaked into standard inventory.");
  }

  const parity: Record<ParityStatus, number> = {
    foundation: 0,
    pending: 0,
    partial: 0,
    verified: 0,
    retired: 0,
  };
  for (const entry of entries) parity[entry.parity.status] += 1;

  return {
    schema: INVENTORY_SCHEMA,
    sourceRevision: INVENTORY_SOURCE_REVISION,
    summary: {
      tenants: tenants.length,
      standardTenants: tenants.filter(
        (tenant) => tenant.profile === "standard",
      ).length,
      privilegedTenants: tenants.filter(
        (tenant) => tenant.profile === "website-privileged",
      ).length,
      domains: tenants.reduce(
        (total, tenant) => total + tenant.domains.length,
        0,
      ),
      entries: entries.length,
      parity,
    },
    entries,
  };
}

export function serializeInventory(document = buildInventory()): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
