import {
  defineOceanLeoSiteManifest,
  type OceanLeoHostAdapterDeclaration,
  type OceanLeoSiteManifest,
} from "@oceanleo/ui/manifest";

export const TENANT_REGISTRY_VERSION = "2026-07-21.1" as const;

export type AppProfile = "standard" | "website-privileged";
export type DomainKind = "canonical" | "alias";

export interface TenantDomain {
  readonly host: string;
  readonly kind: DomainKind;
}

export interface TenantPluginDeclaration {
  readonly id: string;
  readonly contractVersion: number;
  readonly kind:
    | "specialized-workbench"
    | "specialized-library"
    | "specialized-platform";
}

export interface TenantDefinition {
  readonly profile: AppProfile;
  readonly canonicalHost: string;
  readonly domains: readonly TenantDomain[];
  readonly manifest: OceanLeoSiteManifest<never>;
  readonly plugin: TenantPluginDeclaration;
  readonly migrationBatch: 1 | 2 | 3 | 4 | 5 | 6;
}

interface TenantSeed {
  readonly siteKey: string;
  readonly name: string;
  readonly shortName?: string;
  readonly accent: string;
  readonly canonicalHost: string;
  readonly domainAliases?: readonly string[];
  readonly manifestAliases?: readonly string[];
  readonly profile?: AppProfile;
  readonly shellMode?: "standard" | "utility";
  readonly adapterRole?: OceanLeoHostAdapterDeclaration["role"];
  readonly plugin: TenantPluginDeclaration;
  readonly migrationBatch: TenantDefinition["migrationBatch"];
}

const seeds: readonly TenantSeed[] = [
  {
    siteKey: "agent",
    name: "LeoAgent",
    accent: "#7c3aed",
    canonicalHost: "agent.oceanleo.com",
    domainAliases: ["skill.oceanleo.com"],
    manifestAliases: ["skill"],
    plugin: {
      id: "agent-orchestration",
      contractVersion: 1,
      kind: "specialized-platform",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "website",
    name: "Website",
    accent: "#ea580c",
    canonicalHost: "website.oceanleo.com",
    profile: "website-privileged",
    plugin: {
      id: "website-source-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 6,
  },
  {
    siteKey: "ecommerce",
    name: "LeoStudio",
    accent: "#d97706",
    canonicalHost: "e-commerce.oceanleo.com",
    manifestAliases: ["e-commerce", "ecommerce-assets"],
    plugin: {
      id: "ecommerce-asset-studio",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 4,
  },
  {
    siteKey: "ppt",
    name: "LeoSlides",
    accent: "#4f46e5",
    canonicalHost: "slide.oceanleo.com",
    domainAliases: ["ppt.oceanleo.com"],
    manifestAliases: ["slide", "ppt-maker"],
    plugin: {
      id: "presentation-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 1,
  },
  {
    siteKey: "excel",
    name: "LeoSheet",
    accent: "#0f766e",
    canonicalHost: "excel.oceanleo.com",
    manifestAliases: ["excel-ai"],
    plugin: {
      id: "spreadsheet-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 1,
  },
  {
    siteKey: "word",
    name: "LeoDoc",
    accent: "#059669",
    canonicalHost: "word.oceanleo.com",
    manifestAliases: ["word-ai"],
    plugin: {
      id: "document-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 1,
  },
  {
    siteKey: "converter",
    name: "LeoConvert",
    accent: "#e11d48",
    canonicalHost: "converter.oceanleo.com",
    manifestAliases: ["converter-suite"],
    plugin: {
      id: "conversion-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 1,
  },
  {
    siteKey: "aihuman",
    name: "LeoHuman",
    accent: "#9333ea",
    canonicalHost: "aihuman.oceanleo.com",
    manifestAliases: ["aihuman-studio"],
    plugin: {
      id: "digital-human-studio",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "image",
    name: "LeoImage",
    accent: "#4f46e5",
    canonicalHost: "image.oceanleo.com",
    domainAliases: ["myselfie.oceanleo.com", "remove.oceanleo.com"],
    plugin: {
      id: "image-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "video",
    name: "LeoVideo",
    accent: "#7c3aed",
    canonicalHost: "video.oceanleo.com",
    domainAliases: ["studio.oceanleo.com"],
    plugin: {
      id: "video-canvas",
      contractVersion: 2,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "resume",
    name: "LeoResume",
    accent: "#6d28d9",
    canonicalHost: "resume.oceanleo.com",
    plugin: {
      id: "resume-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 1,
  },
  {
    siteKey: "bizdev",
    name: "LeoBizDev",
    accent: "#0891b2",
    canonicalHost: "bizdev.oceanleo.com",
    plugin: {
      id: "business-development-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "logo",
    name: "LeoLogo",
    accent: "#ea580c",
    canonicalHost: "logo.oceanleo.com",
    plugin: {
      id: "logo-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "interior",
    name: "LeoInterior",
    accent: "#e11d48",
    canonicalHost: "interior.oceanleo.com",
    plugin: {
      id: "interior-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "chat",
    name: "LeoChat",
    accent: "#2563eb",
    canonicalHost: "chat.oceanleo.com",
    plugin: {
      id: "multi-model-chat",
      contractVersion: 1,
      kind: "specialized-platform",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "threed",
    name: "Leo3D",
    accent: "#0d9488",
    canonicalHost: "3d.oceanleo.com",
    domainAliases: ["threed.oceanleo.com"],
    manifestAliases: ["3d"],
    plugin: {
      id: "three-dimensional-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 2,
  },
  {
    siteKey: "music",
    name: "LeoMusic",
    accent: "#c026d3",
    canonicalHost: "music.oceanleo.com",
    plugin: {
      id: "music-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "meeting",
    name: "LeoMeeting",
    accent: "#2563eb",
    canonicalHost: "meeting.oceanleo.com",
    plugin: {
      id: "meeting-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "paper",
    name: "LeoPaper",
    accent: "#4338ca",
    canonicalHost: "paper.oceanleo.com",
    plugin: {
      id: "paper-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "law",
    name: "LeoLaw",
    accent: "#1d4ed8",
    canonicalHost: "law.oceanleo.com",
    plugin: {
      id: "law-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "study",
    name: "LeoStudy",
    accent: "#7c3aed",
    canonicalHost: "study.oceanleo.com",
    plugin: {
      id: "study-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "edu",
    name: "LeoEdu",
    accent: "#059669",
    canonicalHost: "edu.oceanleo.com",
    plugin: {
      id: "education-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 3,
  },
  {
    siteKey: "novel",
    name: "LeoNovel",
    accent: "#059669",
    canonicalHost: "novel.oceanleo.com",
    plugin: {
      id: "novel-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 4,
  },
  {
    siteKey: "script",
    name: "LeoScript",
    accent: "#0891b2",
    canonicalHost: "script.oceanleo.com",
    plugin: {
      id: "script-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 4,
  },
  {
    siteKey: "design",
    name: "LeoDesign",
    accent: "#db2777",
    canonicalHost: "design.oceanleo.com",
    plugin: {
      id: "design-canvas",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 4,
  },
  {
    siteKey: "make",
    name: "LeoMake",
    accent: "#ea580c",
    canonicalHost: "make.oceanleo.com",
    plugin: {
      id: "custom-commerce-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 4,
  },
  {
    siteKey: "search",
    name: "LeoSearch",
    accent: "#0284c7",
    canonicalHost: "search.oceanleo.com",
    plugin: {
      id: "search-workbench",
      contractVersion: 1,
      kind: "specialized-platform",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "money",
    name: "LeoMoney",
    accent: "#15803d",
    canonicalHost: "money.oceanleo.com",
    plugin: {
      id: "money-workbench",
      contractVersion: 1,
      kind: "specialized-workbench",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "aitools",
    name: "AI 工具导航",
    shortName: "AI 工具",
    accent: "#059669",
    canonicalHost: "aitools.oceanleo.com",
    shellMode: "utility",
    adapterRole: "library",
    plugin: {
      id: "ai-tools-directory",
      contractVersion: 1,
      kind: "specialized-library",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "asset",
    name: "LeoAsset",
    accent: "#65a30d",
    canonicalHost: "asset.oceanleo.com",
    shellMode: "utility",
    adapterRole: "library",
    plugin: {
      id: "asset-library",
      contractVersion: 1,
      kind: "specialized-library",
    },
    migrationBatch: 5,
  },
  {
    siteKey: "game",
    name: "LeoPlay",
    accent: "#f59e0b",
    canonicalHost: "game.oceanleo.com",
    shellMode: "utility",
    plugin: {
      id: "game-platform",
      contractVersion: 1,
      kind: "specialized-platform",
    },
    migrationBatch: 5,
  },
] as const;

function tenantFromSeed(seed: TenantSeed): TenantDefinition {
  const profile = seed.profile ?? "standard";
  const domains = Object.freeze([
    Object.freeze({ host: seed.canonicalHost, kind: "canonical" as const }),
    ...(seed.domainAliases ?? []).map((host) =>
      Object.freeze({ host, kind: "alias" as const }),
    ),
  ]);
  const manifest = defineOceanLeoSiteManifest<never>({
    siteKey: seed.siteKey,
    aliases: seed.manifestAliases,
    brand: {
      name: seed.name,
      shortName: seed.shortName,
      accent: seed.accent,
    },
    shell: {
      mode: seed.shellMode ?? "standard",
      accountRoute: "/account",
      settingsRoute: "/settings",
      showGlobalNavigation: true,
    },
    auth: {
      strategy: "oceanleo-sso",
      required: false,
      gatewayOrigin: "https://api.oceanleo.com",
    },
    credits: {
      scope: seed.shellMode === "utility" ? "disabled" : "shared-account",
      enabled: seed.shellMode !== "utility",
      route: "/cost",
    },
    workspace: {
      canonicalBasePath: "/workspace",
      historyBasePath: "/history",
      legacyQueryKeys: ["fn", "mode"],
    },
    adapters: [
      {
        id: seed.plugin.id,
        role: seed.adapterRole ?? "workbench",
        route: "/workspace",
        version: seed.plugin.contractVersion,
      },
    ],
    appContext: {
      tenantProfile: profile,
      pluginId: seed.plugin.id,
      pluginContractVersion: seed.plugin.contractVersion,
    },
  });
  return Object.freeze({
    profile,
    canonicalHost: seed.canonicalHost,
    domains,
    manifest,
    plugin: Object.freeze({ ...seed.plugin }),
    migrationBatch: seed.migrationBatch,
  });
}

export const TENANTS: readonly TenantDefinition[] = Object.freeze(
  seeds.map(tenantFromSeed),
);

const bySiteKey = new Map(
  TENANTS.map((tenant) => [String(tenant.manifest.siteKey), tenant]),
);
const byHost = new Map<
  string,
  Readonly<{ tenant: TenantDefinition; domain: TenantDomain }>
>();

for (const tenant of TENANTS) {
  for (const domain of tenant.domains) {
    if (byHost.has(domain.host)) {
      throw new Error(`Duplicate OceanLeo host: ${domain.host}`);
    }
    byHost.set(domain.host, Object.freeze({ tenant, domain }));
  }
}

function hasForbiddenManifestAuthority(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["capabilities", "permissions", "secrets", "secretRefs"].some((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

function assertRegistry(): void {
  if (TENANTS.length !== 31) {
    throw new Error(`Expected 31 tenants, received ${TENANTS.length}`);
  }
  const standard = TENANTS.filter((tenant) => tenant.profile === "standard");
  const privileged = TENANTS.filter(
    (tenant) => tenant.profile === "website-privileged",
  );
  if (
    standard.length !== 30 ||
    privileged.length !== 1 ||
    privileged[0]?.manifest.siteKey !== "website"
  ) {
    throw new Error("Tenant profile partition must be 30 standard + website.");
  }
  if (bySiteKey.size !== TENANTS.length || byHost.size !== 37) {
    throw new Error("Tenant keys and exact domains must be collision-free.");
  }
  for (const tenant of TENANTS) {
    if (
      tenant.domains[0]?.kind !== "canonical" ||
      tenant.domains[0]?.host !== tenant.canonicalHost
    ) {
      throw new Error(`${tenant.manifest.siteKey}: canonical domain mismatch`);
    }
    if (hasForbiddenManifestAuthority(tenant.manifest)) {
      throw new Error(`${tenant.manifest.siteKey}: manifest grants authority`);
    }
  }
}

assertRegistry();

export function tenantForSiteKey(siteKey: string): TenantDefinition | null {
  return bySiteKey.get(siteKey) ?? null;
}

export function tenantsForProfile(
  profile: AppProfile,
): readonly TenantDefinition[] {
  return TENANTS.filter((tenant) => tenant.profile === profile);
}

export function normalizeHostHeader(value: string | null): string | null {
  if (!value || value !== value.trim() || value.length > 259) return null;
  if (/[\u0000-\u0020\u007f,/@\\?#\[\]]/.test(value)) return null;

  const match = value.match(/^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/);
  if (!match) return null;
  const host = match[1]?.toLowerCase();
  const port = match[2];
  if (!host || host.length > 253 || host.endsWith(".")) return null;
  if (port && (Number(port) < 1 || Number(port) > 65_535)) return null;
  if (
    host.split(".").some(
      (label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  return host;
}

export type TenantResolution =
  | Readonly<{
      ok: true;
      tenant: TenantDefinition;
      matchedDomain: TenantDomain;
      host: string;
    }>
  | Readonly<{
      ok: false;
      status: 404 | 421;
      reason: "unknown-host" | "profile-mismatch";
      host: string | null;
    }>;

export function resolveTenantRequest(
  hostHeader: string | null,
  profile: AppProfile,
): TenantResolution {
  const host = normalizeHostHeader(hostHeader);
  if (!host) {
    return Object.freeze({
      ok: false,
      status: 404,
      reason: "unknown-host",
      host: null,
    });
  }
  const record = byHost.get(host);
  if (!record) {
    return Object.freeze({
      ok: false,
      status: 404,
      reason: "unknown-host",
      host,
    });
  }
  if (record.tenant.profile !== profile) {
    return Object.freeze({
      ok: false,
      status: 421,
      reason: "profile-mismatch",
      host,
    });
  }
  return Object.freeze({
    ok: true,
    tenant: record.tenant,
    matchedDomain: record.domain,
    host,
  });
}
