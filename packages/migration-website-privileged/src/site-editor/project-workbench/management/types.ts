export type ProjectRole = "owner" | "edit" | "view";

export type DelegatedCapability =
  | "publish"
  | "analytics.read"
  | "database.read"
  | "database.write"
  | "storage.read"
  | "storage.write";

export interface ProjectPermissions {
  role: ProjectRole;
  capabilities: DelegatedCapability[];
  canManageAccess: boolean;
  canPublish: boolean;
  canReadAnalytics: boolean;
  canReadDatabase: boolean;
  canWriteDatabase: boolean;
  canReadStorage: boolean;
  canWriteStorage: boolean;
  canManageDomains: boolean;
  canManageConnectors: boolean;
  canManageSecrets: boolean;
  canManageSchedules: boolean;
  canDeleteProject: boolean;
}

export interface ProjectCapability {
  id: string;
  label: string;
  status: "available" | "degraded" | "unavailable";
  reason?: string | null;
}

export interface RevisionReference {
  id: string;
  number?: number | null;
  createdAt?: string | null;
}

export interface ProjectAccessSummary {
  mode: "owner-only" | "shared" | "organization" | "unknown";
  label: string;
  memberCount?: number | null;
}

export interface PublishedAccessSummary {
  mode: "public" | "protected" | "private" | "unavailable" | "unknown";
  label: string;
  enforced: boolean;
  reason?: string | null;
}

export interface ProjectSummary {
  id: string;
  displayName: string;
  slug: string;
  faviconUrl?: string | null;
  primaryProductionUrl?: string | null;
  documentationUrl?: string | null;
  workingRevision?: RevisionReference | null;
  publishedRevision?: RevisionReference | null;
  capabilities: ProjectCapability[];
  projectAccess: ProjectAccessSummary;
  publishedAccess: PublishedAccessSummary;
  permissions: ProjectPermissions;
  version: string;
}

export type AnalyticsRange =
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "13m"
  | "custom";

export type AnalyticsDimension =
  | "path"
  | "referrer_class"
  | "device_class"
  | "deployment_revision";

export interface AnalyticsQuery {
  range: AnalyticsRange;
  from?: string;
  to?: string;
  filters?: Array<{
    dimension: AnalyticsDimension;
    value: string;
  }>;
}

export type AnalyticsMetricKey =
  | "page_views"
  | "visits"
  | "visitors"
  | "duration_seconds"
  | "bounce_rate";

export interface AnalyticsMetric {
  key: AnalyticsMetricKey;
  label: string;
  value: number | null;
  unit: "count" | "seconds" | "ratio";
  changeRatio?: number | null;
}

export interface AnalyticsSummary {
  from: string;
  to: string;
  timezone: string;
  metrics: AnalyticsMetric[];
  sampled: boolean;
  unavailableReason?: string | null;
}

export interface AnalyticsTimeseriesPoint {
  at: string;
  values: Partial<Record<AnalyticsMetricKey, number>>;
}

export interface AnalyticsTimeseries {
  interval: "hour" | "day" | "month";
  points: AnalyticsTimeseriesPoint[];
}

export interface AnalyticsDimensionValue {
  value: string;
  label?: string | null;
  count: number;
}

export interface AnalyticsDimensions {
  dimensions: Partial<
    Record<AnalyticsDimension, AnalyticsDimensionValue[]>
  >;
}

export type DeploymentStatus =
  | "queued"
  | "building"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled"
  | "unpublished";

export interface WebsiteDeployment {
  id: string;
  status: DeploymentStatus;
  statusLabel: string;
  environment: "production" | "preview";
  revision: RevisionReference;
  commitSha?: string | null;
  providerDeploymentId?: string | null;
  url?: string | null;
  version?: string | null;
  startedAt?: string | null;
  readyAt?: string | null;
  failureReason?: string | null;
  actions: {
    canRetry: boolean;
    canCancel: boolean;
    canUnpublish: boolean;
  };
}

export interface DeploymentPage {
  items: WebsiteDeployment[];
  nextCursor?: string | null;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface MutationReceipt {
  auditEventId: string;
  resourceVersion?: string | null;
  affectedRows?: number | null;
  message?: string | null;
}

export interface DatabaseBinding {
  status: "ready" | "unbound" | "degraded" | "unavailable";
  label: string;
  provider?: string | null;
  projectLabel?: string | null;
  allowedSchemas: string[];
  reason?: string | null;
  version?: string | null;
}

export type DatabaseColumnKind =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "uuid"
  | "json"
  | "enum"
  | "binary"
  | "unknown";

export interface DatabaseForeignKey {
  schema: string;
  table: string;
  column: string;
}

export interface DatabaseColumn {
  name: string;
  databaseType: string;
  kind: DatabaseColumnKind;
  nullable: boolean;
  hasDefault: boolean;
  defaultExpression?: string | null;
  primaryKey: boolean;
  generated: boolean;
  writable: boolean;
  enumValues?: string[];
  foreignKey?: DatabaseForeignKey | null;
}

export interface DatabaseIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DatabaseTable {
  schema: string;
  name: string;
  displayName?: string | null;
  estimatedRowCount?: number | null;
  writable: boolean;
  readOnlyReason?: string | null;
  columns: DatabaseColumn[];
  primaryKey: string[];
  indexes: DatabaseIndex[];
}

export interface DatabaseSchema {
  version: string;
  tables: DatabaseTable[];
}

export type DatabaseSortDirection = "asc" | "desc";

export interface DatabaseSort {
  column: string;
  direction: DatabaseSortDirection;
}

export type DatabaseFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "is_null";

export interface DatabaseFilterPredicate {
  type: "predicate";
  column: string;
  operator: DatabaseFilterOperator;
  value?: JsonPrimitive;
}

export interface DatabaseFilterGroup {
  type: "group";
  operator: "and" | "or";
  children: Array<DatabaseFilterPredicate | DatabaseFilterGroup>;
}

export interface DatabaseRowsQuery {
  cursor?: string;
  limit: number;
  sort?: DatabaseSort;
  filter?: DatabaseFilterGroup;
}

export interface DatabaseRow {
  key: string;
  values: Record<string, JsonValue>;
  version: string;
}

export interface DatabaseRowsPage {
  tableVersion: string;
  rows: DatabaseRow[];
  rowCount?: number | null;
  nextCursor?: string | null;
}

export interface DatabaseColumnDefinition {
  name: string;
  databaseType: string;
  nullable: boolean;
  defaultExpression?: string | null;
  primaryKey?: boolean;
}

export type DatabaseSchemaOperation =
  | {
      kind: "create_table";
      schema: string;
      table: string;
      columns: DatabaseColumnDefinition[];
    }
  | {
      kind: "rename_table";
      schema: string;
      table: string;
      nextName: string;
    }
  | {
      kind: "drop_table";
      schema: string;
      table: string;
    }
  | {
      kind: "add_column";
      schema: string;
      table: string;
      column: DatabaseColumnDefinition;
    }
  | {
      kind: "alter_column";
      schema: string;
      table: string;
      column: string;
      next: DatabaseColumnDefinition;
    }
  | {
      kind: "rename_column";
      schema: string;
      table: string;
      column: string;
      nextName: string;
    }
  | {
      kind: "drop_column";
      schema: string;
      table: string;
      column: string;
    };

export interface DatabaseSchemaPlan {
  id: string;
  operation: DatabaseSchemaOperation;
  destructive: boolean;
  warnings: string[];
  impactSummary: string;
  expectedSchemaVersion: string;
  expiresAt: string;
  /** Opaque server token; the UI confirmation phrase is never sent as this token. */
  confirmationToken: string;
}

export interface DatabaseAuthUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  createdAt: string;
  lastSignInAt?: string | null;
  status: string;
  providers: string[];
}

export interface DatabaseAuthUsersPage {
  items: DatabaseAuthUser[];
  nextCursor?: string | null;
}

export interface DatabasePolicyExpression {
  field: string;
  operator: string;
  value: JsonValue;
}

export interface DatabasePolicy {
  id: string;
  schema: string;
  table: string;
  name: string;
  command: "select" | "insert" | "update" | "delete" | "all";
  roles: string[];
  using?: DatabasePolicyExpression[];
  check?: DatabasePolicyExpression[];
  enabled: boolean;
  version: string;
}

export interface DatabasePolicies {
  items: DatabasePolicy[];
}

export interface StorageBinding {
  status: "ready" | "unbound" | "degraded" | "unavailable";
  label: string;
  provider?: string | null;
  reason?: string | null;
  allowedPrefixes: Array<{ bucket: string; prefix: string }>;
  maxObjectBytes?: number | null;
  quotaBytes?: number | null;
  usedBytes?: number | null;
}

export interface StorageBucket {
  id: string;
  name: string;
  visibility: "private" | "public";
  objectCount?: number | null;
  bytesUsed?: number | null;
}

export type StorageSpace = "app" | "project-assets";

export interface StorageObject {
  id: string;
  space: StorageSpace;
  bucket?: string | null;
  path: string;
  name: string;
  isFolder: boolean;
  size?: number | null;
  mimeType?: string | null;
  visibility: "private" | "public";
  modifiedAt: string;
  etag: string;
  generation?: string | null;
  version?: string | null;
  previewable: boolean;
}

export interface StorageObjectsPage {
  items: StorageObject[];
  prefix: string;
  nextCursor?: string | null;
}

export interface StorageUploadInit {
  uploadId: string;
  uploadUrl: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  expiresAt: string;
  objectPath: string;
  expectedEtag?: string | null;
}

export interface StorageUploadComplete {
  object: StorageObject;
  receipt: MutationReceipt;
}

export interface SignedObjectUrl {
  url: string;
  expiresAt: string;
}

export interface GeneralSettings {
  version: string;
  displayName: string;
  slug: string;
  faviconUrl?: string | null;
  primaryUrl?: string | null;
  documentationUrl?: string | null;
  capabilities: ProjectCapability[];
  publish: {
    status: string;
    statusLabel: string;
    primaryUrl?: string | null;
    publishedRevision?: RevisionReference | null;
    failureReason?: string | null;
  };
  publishedAccess: PublishedAccessSummary;
  hosting: {
    mode: string;
    label: string;
    supportedModes: Array<{ value: string; label: string }>;
  };
  permissions: ProjectPermissions;
}

export interface GeneralSettingsUpdate {
  display_name: string;
  slug: string;
  favicon_url: string | null;
  hosting_mode: string;
}

export interface DomainRecord {
  id: string;
  hostname: string;
  primary: boolean;
  platform: boolean;
  status: string;
  statusLabel: string;
  certificateStatus?: string | null;
  certificateStatusLabel?: string | null;
  verification?: {
    type: "CNAME" | "A" | "AAAA" | "TXT";
    name: string;
    value: string;
    verified: boolean;
  }[];
  providerResourceId?: string | null;
}

export interface DomainsSettings {
  version: string;
  domains: DomainRecord[];
  canManage: boolean;
}

export interface NotificationChannel {
  id: string;
  type: "email" | "webhook" | "slack" | string;
  label: string;
  recipient: string;
  verified: boolean;
  enabled: boolean;
}

export interface NotificationRule {
  event:
    | "deploy_success"
    | "deploy_failure"
    | "domain_failure"
    | "schedule_success"
    | "schedule_failure"
    | "usage_threshold";
  label: string;
  enabled: boolean;
  channelIds: string[];
  threshold?: number | null;
}

export interface NotificationDelivery {
  id: string;
  event: string;
  channelLabel: string;
  status: string;
  statusLabel: string;
  attemptedAt: string;
  failureReason?: string | null;
}

export interface NotificationsSettings {
  version: string;
  channels: NotificationChannel[];
  rules: NotificationRule[];
  deliveries: NotificationDelivery[];
  workerAvailable: boolean;
  unavailableReason?: string | null;
  canManage: boolean;
}

export interface NotificationsSettingsUpdate {
  channels: Array<{
    id: string;
    recipient: string;
    enabled: boolean;
  }>;
  rules: Array<{
    event: NotificationRule["event"];
    enabled: boolean;
    channel_ids: string[];
    threshold?: number | null;
  }>;
}

export interface IntegrationBinding {
  id: string;
  provider: string;
  label: string;
  accountLabel?: string | null;
  scopes: string[];
  status: string;
  statusLabel: string;
  verifiedAt?: string | null;
  projectResourceLabel?: string | null;
  providerResourceId?: string | null;
  version?: string | null;
  connectUrl?: string | null;
  canConnect: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
}

export interface IntegrationsSettings {
  integrations: IntegrationBinding[];
  canManage: boolean;
}

export interface SeoSettings {
  version: string;
  titleTemplate: string;
  description: string;
  faviconUrl?: string | null;
  openGraphImageUrl?: string | null;
  canonicalUrl?: string | null;
  robots: string;
  sitemapEnabled: boolean;
  indexable: boolean;
  structuredData: JsonValue | null;
  lastAudit?: {
    id: string;
    status: string;
    statusLabel: string;
    createdAt: string;
    findings: Array<{
      severity: "info" | "warning" | "error";
      message: string;
    }>;
  } | null;
  canManage: boolean;
  unavailableReason?: string | null;
}

export interface SeoSettingsUpdate {
  title_template: string;
  description: string;
  favicon_url: string | null;
  open_graph_image_url: string | null;
  canonical_url: string | null;
  robots: string;
  sitemap_enabled: boolean;
  indexable: boolean;
  structured_data: JsonValue | null;
}

export interface SecretMetadata {
  id: string;
  name: string;
  target: string;
  environment: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface SecretsSettings {
  secrets: SecretMetadata[];
  allowedTargets: string[];
  allowedEnvironments: string[];
  canManage: boolean;
}

export interface GitHubSettings {
  version: string;
  bound: boolean;
  repository?: string | null;
  repositoryUrl?: string | null;
  branch?: string | null;
  lastRemoteHead?: string | null;
  lastOceanLeoCommit?: string | null;
  syncStatus?: string | null;
  syncStatusLabel?: string | null;
  conflictReason?: string | null;
  canManage: boolean;
}

export interface ProjectSchedule {
  id: string;
  label: string;
  enabled: boolean;
  timezone: string;
  kind: "cron" | "one_shot";
  expression: string;
  action: "publish";
  revision: RevisionReference;
  nextRunAt?: string | null;
  lastRun?: {
    id: string;
    status: string;
    statusLabel: string;
    startedAt: string;
    failureReason?: string | null;
  } | null;
  version: string;
}

export interface SaveProjectScheduleInput {
  id?: string;
  version?: string;
  label: string;
  timezone: string;
  kind: "cron" | "one_shot";
  expression: string;
  revisionId: string;
  enabled?: boolean;
}

export interface SchedulesSettings {
  schedules: ProjectSchedule[];
  availableTimezones: string[];
  canManage: boolean;
  executionAvailable: boolean;
  unavailableReason?: string | null;
}

export interface UsageMeter {
  key:
    | "ai"
    | "build_minutes"
    | "deployments"
    | "bandwidth"
    | "storage"
    | "database"
    | "analytics_events"
    | string;
  label: string;
  value: number | null;
  unit: string;
  quota?: number | null;
  providerVerified: boolean;
  unavailableReason?: string | null;
}

export interface UsageSettings {
  period: {
    startsAt: string;
    endsAt: string;
    label: string;
  };
  meters: UsageMeter[];
}

export type SettingsSection =
  | "general"
  | "domains"
  | "notifications"
  | "integrations"
  | "seo"
  | "secrets"
  | "github"
  | "schedules"
  | "usage";

export interface SettingsDataMap {
  general: GeneralSettings;
  domains: DomainsSettings;
  notifications: NotificationsSettings;
  integrations: IntegrationsSettings;
  seo: SeoSettings;
  secrets: SecretsSettings;
  github: GitHubSettings;
  schedules: SchedulesSettings;
  usage: UsageSettings;
}

export interface SettingsUpdateMap {
  general: GeneralSettingsUpdate;
  notifications: NotificationsSettingsUpdate;
  seo: SeoSettingsUpdate;
}

export type WritableSettingsSection = keyof SettingsUpdateMap;

export interface WorkspaceBaseProps {
  projectId: string;
  className?: string;
}
