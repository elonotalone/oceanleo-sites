import "server-only";

import {
  TENANTS,
  tenantForSiteKey,
  type TenantDefinition,
} from "@oceanleo/tenant-registry";

type TrustedManifest = TenantDefinition["manifest"];

export const CAPABILITY_REGISTRY_VERSION = "2026-07-21.2" as const;

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

interface SecretDefinition {
  readonly tenantSiteKey: string;
  readonly envName: string;
  readonly profile: TenantDefinition["profile"];
  readonly capability: CapabilityId;
}

const SECRET_DEFINITIONS = Object.freeze({
  "website.github-token": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_GITHUB_TOKEN",
    profile: "website-privileged",
    capability: "website:source-edit",
  }),
  "website.vercel-token": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_VERCEL_TOKEN",
    profile: "website-privileged",
    capability: "website:deploy",
  }),
  "website.cloudflare-token": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_CLOUDFLARE_API_TOKEN",
    profile: "website-privileged",
    capability: "website:domain-admin",
  }),
  "website.supabase-management-token": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_SUPABASE_MANAGEMENT_TOKEN",
    profile: "website-privileged",
    capability: "website:vault",
  }),
  "website.server-ssh-key": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_SERVER_SSH_KEY",
    profile: "website-privileged",
    capability: "website:server-admin",
  }),
  "website.railway-token": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_RAILWAY_TOKEN",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  }),
  "website.aliyun-access-key-id": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_ALIYUN_ACCESS_KEY_ID",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  }),
  "website.aliyun-access-key-secret": Object.freeze({
    tenantSiteKey: "website",
    envName: "WEBSITE_ALIYUN_ACCESS_KEY_SECRET",
    profile: "website-privileged",
    capability: "website:provider-oauth",
  }),
} satisfies Readonly<Record<string, SecretDefinition>>);

export type SecretReferenceId = keyof typeof SECRET_DEFINITIONS;

export interface SecretReference {
  readonly id: SecretReferenceId;
}

const SECRET_REFERENCE_IDS = Object.freeze(
  Object.keys(SECRET_DEFINITIONS) as SecretReferenceId[],
);
const SECRET_REFERENCES: readonly SecretReference[] = Object.freeze(
  SECRET_REFERENCE_IDS.map((id) => Object.freeze({ id })),
);
const NO_SECRET_REFERENCES: readonly SecretReference[] = Object.freeze([]);

for (const referenceId of SECRET_REFERENCE_IDS) {
  const definition = SECRET_DEFINITIONS[referenceId];
  if (definition.envName.startsWith("NEXT_PUBLIC_")) {
    throw new Error(`Secret reference ${referenceId} is browser-exposed.`);
  }
  const tenant = tenantForSiteKey(definition.tenantSiteKey);
  if (!tenant || tenant.profile !== definition.profile) {
    throw new Error(
      `Secret reference ${referenceId} has no matching trusted tenant profile.`,
    );
  }
  if (!capabilitiesForTenant(tenant).includes(definition.capability)) {
    throw new Error(
      `Secret reference ${referenceId} requires an ungranted capability.`,
    );
  }
}

function assertTrustedTenant(tenant: TenantDefinition): void {
  if (!TENANTS.includes(tenant)) {
    throw new CapabilityDeniedError("Secret resolution requires a trusted tenant.");
  }
}

function secretDefinitionForId(referenceId: unknown): SecretDefinition {
  if (
    typeof referenceId !== "string" ||
    !Object.prototype.hasOwnProperty.call(SECRET_DEFINITIONS, referenceId)
  ) {
    throw new CapabilityDeniedError("Unknown secret reference ID.");
  }
  return SECRET_DEFINITIONS[referenceId as SecretReferenceId];
}

export function secretReferencesForTenant(
  tenant: TenantDefinition,
): readonly SecretReference[] {
  assertTrustedTenant(tenant);
  const references = SECRET_REFERENCES.filter(({ id }) => {
    const definition = SECRET_DEFINITIONS[id];
    return (
      definition.tenantSiteKey === String(tenant.manifest.siteKey) &&
      definition.profile === tenant.profile
    );
  });
  if (references.length === 0) return NO_SECRET_REFERENCES;
  for (const { id } of references) {
    assertCapability(tenant, SECRET_DEFINITIONS[id].capability);
  }
  return Object.freeze(references);
}

export function resolveSecretReference(
  tenant: TenantDefinition,
  referenceId: SecretReferenceId,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  assertTrustedTenant(tenant);
  const definition = secretDefinitionForId(referenceId);
  if (
    definition.tenantSiteKey !== String(tenant.manifest.siteKey) ||
    definition.profile !== tenant.profile ||
    definition.envName.startsWith("NEXT_PUBLIC_")
  ) {
    throw new CapabilityDeniedError(
      `Secret reference ${String(referenceId)} is not available to this tenant profile.`,
    );
  }
  assertCapability(tenant, definition.capability);
  const value = environment[definition.envName];
  if (!value) {
    throw new Error(`Required secret reference ${referenceId} is unresolved.`);
  }
  return value;
}

export function trustedTenantForSiteKey(siteKey: string): TenantDefinition {
  const tenant = tenantForSiteKey(siteKey);
  if (!tenant) throw new CapabilityDeniedError(`Unknown tenant ${siteKey}.`);
  return tenant;
}
