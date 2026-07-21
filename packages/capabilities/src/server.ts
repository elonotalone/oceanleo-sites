import "server-only";

import {
  TENANTS,
  tenantForSiteKey,
  type AppProfile,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

type TrustedManifest = TenantDefinition["manifest"];

export const CAPABILITY_REGISTRY_VERSION = "2026-07-21.1" as const;

export type CapabilityId =
  | "shell:render"
  | "artifact:read"
  | "artifact:write"
  | "workspace:session"
  | "workbench:advanced"
  | "browser:cloud"
  | "website:launch"
  | "website:source-edit"
  | "website:deploy"
  | "website:domain-admin"
  | "website:vault"
  | "website:server-admin"
  | "website:provider-oauth";

const SHARED_CAPABILITIES: readonly CapabilityId[] = Object.freeze([
  "shell:render",
  "artifact:read",
  "artifact:write",
  "workspace:session",
  "workbench:advanced",
  "browser:cloud",
  "website:launch",
]);

const WEBSITE_PRIVILEGED_CAPABILITIES: readonly CapabilityId[] = Object.freeze([
  ...SHARED_CAPABILITIES,
  "website:source-edit",
  "website:deploy",
  "website:domain-admin",
  "website:vault",
  "website:server-admin",
  "website:provider-oauth",
]);

const grantsBySiteKey = new Map<string, readonly CapabilityId[]>(
  TENANTS.map((tenant) => [
    String(tenant.manifest.siteKey),
    tenant.profile === "website-privileged"
      ? WEBSITE_PRIVILEGED_CAPABILITIES
      : SHARED_CAPABILITIES,
  ]),
);

const AUTHORITY_KEYS = Object.freeze([
  "capabilities",
  "permissions",
  "grants",
  "secrets",
  "secretRefs",
]);

export class CapabilityEscalationError extends Error {
  override name = "CapabilityEscalationError";
}

export class CapabilityDeniedError extends Error {
  override name = "CapabilityDeniedError";
}

function assertedNoAuthorityClaims(manifest: TrustedManifest): void {
  const locations: readonly unknown[] = [
    manifest,
    manifest.appContext,
    ...manifest.adapters,
  ];
  for (const location of locations) {
    if (!location || typeof location !== "object") continue;
    for (const key of AUTHORITY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(location, key)) {
        throw new CapabilityEscalationError(
          `Tenant manifest attempted to claim trusted field "${key}".`,
        );
      }
    }
  }
}

export function capabilitiesForTenant(
  tenant: TenantDefinition,
  manifest: TrustedManifest = tenant.manifest,
): readonly CapabilityId[] {
  assertedNoAuthorityClaims(manifest);
  if (manifest.siteKey !== tenant.manifest.siteKey) {
    throw new CapabilityEscalationError(
      `Manifest identity ${manifest.siteKey} does not match resolved tenant ${tenant.manifest.siteKey}.`,
    );
  }
  const grants = grantsBySiteKey.get(String(tenant.manifest.siteKey));
  if (!grants) {
    throw new CapabilityDeniedError("Resolved tenant has no trusted grant set.");
  }
  return grants;
}

export function assertCapability(
  tenant: TenantDefinition,
  capability: CapabilityId,
  manifest: TrustedManifest = tenant.manifest,
): void {
  if (!capabilitiesForTenant(tenant, manifest).includes(capability)) {
    throw new CapabilityDeniedError(
      `${tenant.manifest.siteKey} is not granted ${capability}.`,
    );
  }
}

export type SecretReferenceId =
  | "website.github-token"
  | "website.vercel-token"
  | "website.cloudflare-token"
  | "website.supabase-management-token"
  | "website.server-ssh-key"
  | "website.railway-token"
  | "website.aliyun-access-key-id"
  | "website.aliyun-access-key-secret";

export interface SecretReference {
  readonly id: SecretReferenceId;
  readonly envName: string;
  readonly profile: "website-privileged";
  readonly capability: CapabilityId;
}

const WEBSITE_SECRET_REFERENCES: readonly SecretReference[] = Object.freeze([
  {
    id: "website.github-token",
    envName: "WEBSITE_GITHUB_TOKEN",
    profile: "website-privileged",
    capability: "website:source-edit",
  },
  {
    id: "website.vercel-token",
    envName: "WEBSITE_VERCEL_TOKEN",
    profile: "website-privileged",
    capability: "website:deploy",
  },
  {
    id: "website.cloudflare-token",
    envName: "WEBSITE_CLOUDFLARE_API_TOKEN",
    profile: "website-privileged",
    capability: "website:domain-admin",
  },
  {
    id: "website.supabase-management-token",
    envName: "WEBSITE_SUPABASE_MANAGEMENT_TOKEN",
    profile: "website-privileged",
    capability: "website:vault",
  },
  {
    id: "website.server-ssh-key",
    envName: "WEBSITE_SERVER_SSH_KEY",
    profile: "website-privileged",
    capability: "website:server-admin",
  },
  {
    id: "website.railway-token",
    envName: "WEBSITE_RAILWAY_TOKEN",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  },
  {
    id: "website.aliyun-access-key-id",
    envName: "WEBSITE_ALIYUN_ACCESS_KEY_ID",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  },
  {
    id: "website.aliyun-access-key-secret",
    envName: "WEBSITE_ALIYUN_ACCESS_KEY_SECRET",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  },
]);

for (const reference of WEBSITE_SECRET_REFERENCES) {
  if (reference.envName.startsWith("NEXT_PUBLIC_")) {
    throw new Error(`Secret reference ${reference.id} is browser-exposed.`);
  }
}

export function secretReferencesForTenant(
  tenant: TenantDefinition,
): readonly SecretReference[] {
  return tenant.profile === "website-privileged"
    ? WEBSITE_SECRET_REFERENCES
    : Object.freeze([]);
}

export function resolveSecretReference(
  reference: SecretReference,
  profile: AppProfile,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (
    profile !== reference.profile ||
    reference.envName.startsWith("NEXT_PUBLIC_")
  ) {
    throw new CapabilityDeniedError(
      `Secret reference ${reference.id} is not available to ${profile}.`,
    );
  }
  const value = environment[reference.envName];
  if (!value) {
    throw new Error(`Required secret reference ${reference.id} is unresolved.`);
  }
  return value;
}

export function trustedTenantForSiteKey(siteKey: string): TenantDefinition {
  const tenant = tenantForSiteKey(siteKey);
  if (!tenant) throw new CapabilityDeniedError(`Unknown tenant ${siteKey}.`);
  return tenant;
}
