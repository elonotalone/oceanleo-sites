import type { CapabilityId } from "@oceanleo/capabilities/server";

export const INVENTORY_SCHEMA =
  "oceanleo.route-handler-inventory.v1" as const;
export const INVENTORY_SOURCE_REVISION =
  "migration-seams-2026-07-21.2" as const;

export type ParityStatus =
  | "foundation"
  | "pending"
  | "partial"
  | "verified"
  | "retired";

export type InventoryKind =
  | "page"
  | "route-handler"
  | "metadata"
  | "plugin-extension";

export interface FoundationRoute {
  readonly route: string;
  readonly kind: Exclude<InventoryKind, "plugin-extension">;
  readonly methods: readonly string[];
  readonly capabilities: readonly CapabilityId[];
}

export const FOUNDATION_ROUTES: readonly FoundationRoute[] = Object.freeze([
  {
    route: "/",
    kind: "page",
    methods: ["GET"],
    capabilities: ["shell:render"],
  },
  {
    route: "/api/health",
    kind: "route-handler",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/api/tenant",
    kind: "route-handler",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/robots.txt",
    kind: "metadata",
    methods: ["GET"],
    capabilities: [],
  },
  {
    route: "/sitemap.xml",
    kind: "metadata",
    methods: ["GET"],
    capabilities: [],
  },
]);
