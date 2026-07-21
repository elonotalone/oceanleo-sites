import { TENANTS, type AppProfile } from "@oceanleo/tenant-registry";

import {
  FOUNDATION_ROUTES,
  INVENTORY_SCHEMA,
  INVENTORY_SOURCE_REVISION,
  WEBSITE_LEGACY_HANDLERS,
  websiteHandlerCapabilities,
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
  if (WEBSITE_LEGACY_HANDLERS.length !== 47) {
    throw new Error("Website privileged inventory must contain 47 handlers.");
  }

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
    entries.push({
      id: `plugin:${tenant.profile}:${tenantKey}:${tenant.plugin.id}`,
      appProfile: tenant.profile,
      tenantKey,
      route: null,
      kind: "plugin-extension",
      methods: [],
      capabilities: ["workbench:advanced"],
      extensionId: tenant.plugin.id,
      migrationBatch: tenant.migrationBatch,
      parity: {
        status: "pending",
        source: `legacy:${tenantKey}`,
        evidence: [],
      },
    });
  }

  for (const route of sorted(WEBSITE_LEGACY_HANDLERS)) {
    entries.push({
      id: `legacy:website-privileged:website:${route}`,
      appProfile: "website-privileged",
      tenantKey: "website",
      route,
      kind: "route-handler",
      methods: ["UNMIGRATED"],
      capabilities: sorted(websiteHandlerCapabilities(route)),
      extensionId: "website-source-workbench",
      migrationBatch: 6,
      parity: {
        status: "pending",
        source: `website:front/app${route}/route.ts`,
        evidence: [],
      },
    });
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
