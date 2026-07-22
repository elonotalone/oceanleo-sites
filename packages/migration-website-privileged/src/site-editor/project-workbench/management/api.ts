"use client";

import { authed } from "@oceanleo/ui/lib";
import type {
  AnalyticsDimensions,
  AnalyticsQuery,
  AnalyticsSummary,
  AnalyticsTimeseries,
  DatabaseAuthUsersPage,
  DatabaseBinding,
  DatabaseFilterGroup,
  DatabasePolicies,
  DatabaseRow,
  DatabaseRowsPage,
  DatabaseRowsQuery,
  DatabaseSchema,
  DatabaseSchemaOperation,
  DatabaseSchemaPlan,
  DatabaseSort,
  DeploymentPage,
  DomainsSettings,
  GitHubSettings,
  IntegrationBinding,
  JsonValue,
  MutationReceipt,
  ProjectCapability,
  ProjectSchedule,
  SaveProjectScheduleInput,
  ProjectSummary,
  SchedulesSettings,
  SecretMetadata,
  SeoSettings,
  SettingsDataMap,
  SettingsSection,
  SettingsUpdateMap,
  SignedObjectUrl,
  StorageBinding,
  StorageBucket,
  StorageObject,
  StorageObjectsPage,
  StorageSpace,
  StorageUploadComplete,
  StorageUploadInit,
  WebsiteDeployment,
  WritableSettingsSection,
} from "./types";

export type ManagementApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "unavailable"
  | "conflict"
  | "validation"
  | "network"
  | "server";

export class ManagementApiError extends Error {
  readonly status: number;
  readonly kind: ManagementApiErrorKind;
  readonly endpoint: string;

  constructor(
    message: string,
    options: {
      status?: number;
      endpoint: string;
      kind?: ManagementApiErrorKind;
    },
  ) {
    super(message);
    this.name = "ManagementApiError";
    this.status = options.status ?? 0;
    this.endpoint = options.endpoint;
    this.kind = options.kind ?? classifyError(this.status);
  }
}

function classifyError(status: number): ManagementApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409 || status === 412) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status === 0) return "network";
  if (status === 404 || status === 405 || status === 501 || status >= 502) {
    return "unavailable";
  }
  return "server";
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `website-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function queryString(
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

function apiBody(
  value: unknown,
  options?: { expectedVersion?: string; idempotent?: boolean },
): RequestInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (options?.expectedVersion) {
    headers["If-Match"] = options.expectedVersion;
  }
  if (options?.idempotent !== false) {
    headers["Idempotency-Key"] = idempotencyKey();
  }
  return {
    headers,
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(20_000),
  };
}

export interface StorageListQuery {
  space: StorageSpace;
  bucket?: string;
  prefix?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface StorageUploadRequest {
  space: StorageSpace;
  bucket?: string;
  path: string;
  file: File;
  expectedEtag?: string;
}

export class ManagementApi {
  private projectPath(projectId: string): string {
    return `/v1/website-projects/${segment(projectId)}`;
  }

  private async request<T>(
    endpoint: string,
    init?: RequestInit,
  ): Promise<T> {
    let result: Awaited<ReturnType<typeof authed<T>>>;
    try {
      result = await authed<T>(endpoint, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (error instanceof ManagementApiError) throw error;
      const message =
        error instanceof Error
          ? error.message
          : "The project API could not be reached.";
      throw new ManagementApiError(message, {
        endpoint,
        kind: "network",
      });
    }
    if (!result.ok || result.data === undefined || result.data === null) {
      const status = result.status ?? 0;
      const unavailable =
        status === 404 || status === 405 || status === 501 || status >= 502;
      const fallback = unavailable
        ? "This management capability is not available from the project API."
        : "The project API request failed.";
      throw new ManagementApiError(result.error || fallback, {
        status,
        endpoint,
      });
    }
    return result.data;
  }

  private capabilitySnapshot(projectId: string): Promise<UnknownRecord> {
    return this.request(`${this.projectPath(projectId)}/capabilities`);
  }

  async getProjectSummary(projectId: string): Promise<ProjectSummary> {
    const [envelope, capability] = await Promise.all([
      this.request<UnknownRecord>(this.projectPath(projectId)),
      this.capabilitySnapshot(projectId),
    ]);
    return normalizeProjectSummary(asRecord(envelope.project), capability);
  }

  async getCapabilities(
    projectId: string,
  ): Promise<{ capabilities: ProjectCapability[] }> {
    return {
      capabilities: normalizeCapabilities(
        await this.capabilitySnapshot(projectId),
      ),
    };
  }

  async getAnalyticsSummary(
    projectId: string,
    analytics: AnalyticsQuery,
  ): Promise<AnalyticsSummary> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/analytics/summary${analyticsQuery(analytics)}`,
    );
    return normalizeAnalyticsSummary(raw);
  }

  async getAnalyticsTimeseries(
    projectId: string,
    analytics: AnalyticsQuery,
  ): Promise<AnalyticsTimeseries> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/analytics/timeseries${analyticsQuery(analytics)}`,
    );
    return normalizeAnalyticsTimeseries(raw);
  }

  async getAnalyticsDimensions(
    projectId: string,
    analytics: Pick<AnalyticsQuery, "range" | "from" | "to">,
  ): Promise<AnalyticsDimensions> {
    const dimensions = [
      "path",
      "referrer",
      "device",
      "deployment",
      "revision",
    ] as const;
    const results = await Promise.all(
      dimensions.map(async (dimension) => ({
        dimension,
        response: await this.request<UnknownRecord>(
          `${this.projectPath(projectId)}/analytics/dimensions${analyticsQuery(
            analytics,
            { dimension },
          )}`,
        ),
      })),
    );
    return normalizeAnalyticsDimensions(results);
  }

  async getDeployments(
    projectId: string,
    cursor?: string,
  ): Promise<DeploymentPage> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/deployments${queryString({
        cursor,
        limit: 20,
      })}`,
    );
    return {
      items: asArray(raw.items).map((item) =>
        normalizeDeployment(asRecord(item)),
      ),
      nextCursor:
        optionalText(raw.nextCursor) || optionalText(raw.next_cursor),
    };
  }

  retryDeployment(
    projectId: string,
    deploymentId: string,
    expectedVersion?: string | null,
  ): Promise<WebsiteDeployment> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/deployments/${segment(deploymentId)}/retry`,
      {
        method: "POST",
        ...apiBody(
          { expected_version: expectedVersion },
          { expectedVersion: expectedVersion || undefined },
        ),
      },
    ).then(normalizeDeployment);
  }

  cancelDeployment(
    projectId: string,
    deploymentId: string,
    expectedVersion?: string | null,
  ): Promise<WebsiteDeployment> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/deployments/${segment(deploymentId)}/cancel`,
      {
        method: "POST",
        ...apiBody(
          { expected_version: expectedVersion },
          { expectedVersion: expectedVersion || undefined },
        ),
      },
    ).then(normalizeDeployment);
  }

  unpublish(projectId: string): Promise<WebsiteDeployment> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/unpublish`,
      {
        method: "POST",
        ...apiBody({}),
      },
    ).then(normalizeDeployment);
  }

  async getDatabaseBinding(projectId: string): Promise<DatabaseBinding> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/binding`,
    );
    return normalizeDatabaseBinding(raw);
  }

  async getDatabaseSchema(projectId: string): Promise<DatabaseSchema> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/schema`,
    );
    return normalizeDatabaseSchema(raw);
  }

  getDatabaseRows(
    projectId: string,
    schema: string,
    table: string,
    rows: DatabaseRowsQuery,
  ): Promise<DatabaseRowsPage> {
    const endpoint =
      `${this.projectPath(projectId)}/database/tables/${segment(table)}/rows` +
      queryString({
        schema,
        cursor: rows.cursor,
        page_size: rows.limit,
        sort: rows.sort ? JSON.stringify(rows.sort) : undefined,
        filter: rows.filter ? JSON.stringify(rows.filter) : undefined,
      });
    return this.request<UnknownRecord>(endpoint).then(normalizeDatabaseRows);
  }

  insertDatabaseRow(
    projectId: string,
    schema: string,
    table: string,
    values: Record<string, JsonValue>,
    tableVersion: string,
  ): Promise<{ row: DatabaseRow; receipt: MutationReceipt }> {
    const endpoint =
      `${this.projectPath(projectId)}/database/tables/${segment(table)}/rows` +
      queryString({ schema });
    return this.request<UnknownRecord>(
      endpoint,
      {
        method: "POST",
        ...apiBody({ values }),
      },
    ).then((raw) => ({
      row: normalizeDatabaseRow(asRecord(raw.row), tableVersion),
      receipt: mutationReceipt(
        "Database row inserted; the API did not return an audit event id.",
        tableVersion,
        1,
      ),
    }));
  }

  updateDatabaseRow(
    projectId: string,
    schema: string,
    table: string,
    row: DatabaseRow,
    values: Record<string, JsonValue>,
  ): Promise<{ row: DatabaseRow; receipt: MutationReceipt }> {
    const endpoint =
      `${this.projectPath(projectId)}/database/tables/${segment(table)}/rows/${segment(row.key)}` +
      queryString({ schema });
    return this.request<UnknownRecord>(
      endpoint,
      {
        method: "PATCH",
        ...apiBody({ values }),
      },
    ).then((raw) => ({
      row: normalizeDatabaseRow(asRecord(raw.row), row.version),
      receipt: mutationReceipt(
        "Database row updated; the API did not return an audit event id.",
        row.version,
        1,
      ),
    }));
  }

  deleteDatabaseRow(
    projectId: string,
    schema: string,
    table: string,
    row: DatabaseRow,
  ): Promise<MutationReceipt> {
    const endpoint =
      `${this.projectPath(projectId)}/database/tables/${segment(table)}/rows/${segment(row.key)}` +
      queryString({ schema });
    return this.request<UnknownRecord>(
      endpoint,
      {
        method: "DELETE",
      },
    ).then(() =>
      mutationReceipt(
        "Database row deleted; the API did not return an audit event id.",
        row.version,
        1,
      ),
    );
  }

  planDatabaseSchema(
    projectId: string,
    operation: DatabaseSchemaOperation,
    expectedSchemaVersion: string,
  ): Promise<DatabaseSchemaPlan> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/schema/plan`,
      {
        method: "POST",
        ...apiBody(
          databaseSchemaOperationRequest(operation, expectedSchemaVersion),
        ),
      },
    ).then((raw) =>
      normalizeDatabasePlan(raw, operation, expectedSchemaVersion),
    );
  }

  applyDatabaseSchemaPlan(
    projectId: string,
    plan: DatabaseSchemaPlan,
    confirmation?: string,
  ): Promise<{ schema: DatabaseSchema; receipt: MutationReceipt }> {
    if (
      plan.destructive &&
      confirmation !== `APPLY ${plan.operation.schema}.${plan.operation.table}`
    ) {
      throw new ManagementApiError("The schema confirmation phrase is invalid.", {
        status: 400,
        endpoint: `${this.projectPath(projectId)}/database/schema/apply`,
        kind: "validation",
      });
    }
    if (!plan.confirmationToken) {
      throw unavailableError(
        `${this.projectPath(projectId)}/database/schema/apply`,
        "The backend did not return an applicable DDL confirmation token.",
      );
    }
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/schema/apply`,
      {
        method: "POST",
        ...apiBody({
          plan_id: plan.id,
          confirmation: plan.confirmationToken,
        }),
      },
    ).then(async () => {
      const schema = await this.getDatabaseSchema(projectId);
      return {
        schema,
        receipt: mutationReceipt(
          "Database schema applied; the API did not return an audit event id.",
          schema.version,
        ),
      };
    });
  }

  getDatabaseAuthUsers(
    projectId: string,
    cursor?: string,
  ): Promise<DatabaseAuthUsersPage> {
    const page = parsePageCursor(cursor) + 1;
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/auth/users${queryString({
        page,
        per_page: 50,
      })}`,
    ).then(normalizeDatabaseAuthUsers);
  }

  getDatabasePolicies(projectId: string): Promise<DatabasePolicies> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/database/policies`,
    ).then(normalizeDatabasePolicies);
  }

  async getStorageBinding(projectId: string): Promise<StorageBinding> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/binding`,
    );
    return normalizeStorageBinding(raw);
  }

  async getStorageBuckets(
    projectId: string,
  ): Promise<{ items: StorageBucket[] }> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/buckets`,
    );
    return {
      items: asArray(raw.items).map((item) =>
        normalizeStorageBucket(asRecord(item)),
      ),
    };
  }

  getStorageObjects(
    projectId: string,
    storage: StorageListQuery,
  ): Promise<StorageObjectsPage> {
    const endpoint = `${this.projectPath(projectId)}/storage/objects`;
    if (storage.space !== "app") {
      throw unavailableError(
        endpoint,
        "Project-assets storage is not exposed by the Website Project provider.",
      );
    }
    if (!storage.bucket) {
      throw new ManagementApiError("A bound storage bucket is required.", {
        status: 400,
        endpoint,
        kind: "validation",
      });
    }
    return this.request<UnknownRecord>(
      `${endpoint}${queryString({
        bucket: storage.bucket,
        prefix: storage.prefix,
        search: storage.search,
        cursor: storage.cursor,
        page_size: storage.limit ?? 50,
      })}`,
    ).then((raw) =>
      normalizeStorageObjects(raw, storage.bucket || "", storage.prefix || ""),
    );
  }

  async uploadStorageObject(
    projectId: string,
    upload: StorageUploadRequest,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<StorageUploadComplete> {
    const endpoint = `${this.projectPath(projectId)}/storage/uploads/init`;
    if (upload.space !== "app") {
      throw unavailableError(
        endpoint,
        "Project-assets upload is not exposed by the Website Project provider.",
      );
    }
    if (!upload.bucket) {
      throw new ManagementApiError("A bound storage bucket is required.", {
        status: 400,
        endpoint,
        kind: "validation",
      });
    }
    const initRaw = await this.request<UnknownRecord>(
      endpoint,
      {
        method: "POST",
        ...apiBody({
          bucket: upload.bucket,
          path: upload.path,
          size: upload.file.size,
          mime_type: upload.file.type || "application/octet-stream",
          overwrite: Boolean(upload.expectedEtag),
          expected_version: upload.expectedEtag || "",
        }),
      },
    );
    const init = normalizeStorageUploadInit(initRaw);

    await putSignedFile(init, upload.file, onProgress);

    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/uploads/finalize`,
      {
        method: "POST",
        ...apiBody({ upload_id: init.uploadId }),
      },
    );
    return {
      object: normalizeStorageObject(
        asRecord(raw.object),
        upload.bucket,
        upload.path,
      ),
      receipt: mutationReceipt(
        "Storage upload finalized; the API did not return an audit event id.",
      ),
    };
  }

  signStorageDownload(
    projectId: string,
    object: StorageObject,
  ): Promise<SignedObjectUrl> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/objects/sign-download`,
      {
        method: "POST",
        ...apiBody(
          {
            bucket: requireStorageBucket(object),
            path: object.path,
            expires_in: 300,
          },
          { idempotent: false },
        ),
      },
    ).then(normalizeSignedObjectUrl);
  }

  moveStorageObject(
    projectId: string,
    object: StorageObject,
    destinationPath: string,
  ): Promise<{ object: StorageObject; receipt: MutationReceipt }> {
    const expectedVersion = storageObjectVersion(object);
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/objects/move`,
      {
        method: "POST",
        ...apiBody({
          bucket: requireStorageBucket(object),
          path: object.path,
          destination: destinationPath,
          expected_version: expectedVersion,
        }),
      },
    ).then((raw) => ({
      object: normalizeStorageObject(
        asRecord(raw.object),
        requireStorageBucket(object),
        destinationPath,
      ),
      receipt: mutationReceipt(
        "Storage object moved; the API did not return an audit event id.",
        expectedVersion,
      ),
    }));
  }

  deleteStorageObject(
    projectId: string,
    object: StorageObject,
  ): Promise<MutationReceipt> {
    const expectedVersion = storageObjectVersion(object);
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/storage/objects`,
      {
        method: "DELETE",
        ...apiBody({
          bucket: requireStorageBucket(object),
          path: object.path,
          expected_version: expectedVersion,
        }),
      },
    ).then(() =>
      mutationReceipt(
        "Storage object deleted; the API did not return an audit event id.",
        expectedVersion,
      ),
    );
  }

  async getSettings<K extends SettingsSection>(
    projectId: string,
    section: K,
  ): Promise<SettingsDataMap[K]> {
    const path = this.projectPath(projectId);
    if (section === "general") {
      return normalizeGeneralSettings(
        await this.getProjectSummary(projectId),
      ) as SettingsDataMap[K];
    }
    const [raw, capability] = await Promise.all([
      this.request<UnknownRecord>(
        `${path}/settings/${segment(section)}`,
      ),
      this.capabilitySnapshot(projectId),
    ]);
    switch (section) {
      case "domains":
        return normalizeDomainsSettings(raw, capability) as SettingsDataMap[K];
      case "notifications":
        return normalizeNotificationsSettings(
          raw,
          capability,
        ) as SettingsDataMap[K];
      case "integrations":
        return normalizeIntegrationsSettings(
          raw,
          capability,
        ) as SettingsDataMap[K];
      case "seo":
        return normalizeSeoSettings(raw, capability) as SettingsDataMap[K];
      case "secrets":
        return normalizeSecretsSettings(raw, capability) as SettingsDataMap[K];
      case "github":
        return normalizeGitHubSettings(raw, capability) as SettingsDataMap[K];
      case "schedules":
        return normalizeSchedulesSettings(
          raw,
          capability,
        ) as SettingsDataMap[K];
      case "usage":
        return normalizeUsageSettings(raw) as SettingsDataMap[K];
      default:
        throw unavailableError(
          `${path}/settings/${segment(section)}`,
          `Unsupported settings section: ${section}`,
        );
    }
  }

  async updateSettings<K extends WritableSettingsSection>(
    projectId: string,
    section: K,
    value: SettingsUpdateMap[K],
    expectedVersion?: string,
  ): Promise<SettingsDataMap[K]> {
    const path = this.projectPath(projectId);
    if (section === "general") {
      const current = await this.getProjectSummary(projectId);
      const update = value as SettingsUpdateMap["general"];
      if (expectedVersion && current.version !== expectedVersion) {
        throw new ManagementApiError("The project changed before it was saved.", {
          status: 409,
          endpoint: path,
          kind: "conflict",
        });
      }
      if (
        update.favicon_url !== (current.faviconUrl || null) ||
        update.hosting_mode !== "oceanleo"
      ) {
        throw unavailableError(
          path,
          "Favicon and hosting-mode updates are unavailable; no partial project update was sent.",
        );
      }
      await this.request<UnknownRecord>(path, {
        method: "PATCH",
        ...apiBody({
          display_name: update.display_name,
          slug: update.slug,
        }),
      });
      return normalizeGeneralSettings(
        await this.getProjectSummary(projectId),
      ) as SettingsDataMap[K];
    }
    if (section === "seo") {
      throw unavailableError(
        `${path}/settings/seo`,
        "SEO source revision persistence is unavailable; no draft or provider state was changed.",
      );
    }
    const update = value as SettingsUpdateMap["notifications"];
    if (update.rules.some((rule) => rule.enabled)) {
      throw unavailableError(
        `${path}/settings/notifications`,
        "Notification delivery is unavailable; no notification preference was changed.",
      );
    }
    for (const rule of update.rules) {
      const channels = rule.channel_ids.flatMap((id) => {
        const channel = update.channels.find((item) => item.id === id);
        return channel ? [channel] : [];
      });
      await this.request<UnknownRecord>(`${path}/settings/notifications`, {
        method: "PUT",
        ...apiBody({
          event_type: notificationEventToBackend(rule.event),
          enabled: rule.enabled,
          channels: [
            ...new Set(
              channels.map((channel) =>
                notificationChannelType(channel.id),
              ),
            ),
          ],
          recipients: [
            ...new Set(
              channels
                .map((channel) => channel.recipient.trim())
                .filter(Boolean),
            ),
          ],
          threshold:
            typeof rule.threshold === "number"
              ? { value: rule.threshold }
              : {},
        }),
      });
    }
    return this.getSettings(
      projectId,
      "notifications",
    ) as Promise<SettingsDataMap[K]>;
  }

  async duplicateProject(
    projectId: string,
    displayName: string,
  ): Promise<ProjectSummary> {
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/duplicate`,
      {
        method: "POST",
        ...apiBody({ display_name: displayName, slug: "" }),
      },
    );
    const duplicatedId = text(asRecord(raw.project).project_id);
    if (!duplicatedId) {
      throw new ManagementApiError(
        "The duplicate response did not contain a project id.",
        {
          status: 500,
          endpoint: `${this.projectPath(projectId)}/duplicate`,
        },
      );
    }
    return this.getProjectSummary(duplicatedId);
  }

  async deleteProject(
    projectId: string,
    expectedVersion: string,
    confirmation: string,
  ): Promise<{ operationId: string; status: string; auditEventId: string }> {
    const current = await this.getProjectSummary(projectId);
    if (current.version !== expectedVersion) {
      throw new ManagementApiError("The project changed before deletion.", {
        status: 409,
        endpoint: this.projectPath(projectId),
        kind: "conflict",
      });
    }
    if (confirmation !== current.displayName) {
      throw new ManagementApiError("The project confirmation is invalid.", {
        status: 400,
        endpoint: this.projectPath(projectId),
        kind: "validation",
      });
    }
    const raw = await this.request<UnknownRecord>(this.projectPath(projectId), {
      method: "DELETE",
    });
    return {
      operationId: text(raw.project_id, projectId),
      status: raw.deleted === true ? "deleted" : "unavailable",
      auditEventId: "unavailable",
    };
  }

  async addDomain(
    projectId: string,
    hostname: string,
    expectedVersion: string,
  ): Promise<DomainsSettings> {
    const current = await this.getSettings(projectId, "domains");
    if (current.version !== expectedVersion) {
      throw new ManagementApiError("The domain list changed.", {
        status: 409,
        endpoint: `${this.projectPath(projectId)}/settings/domains`,
        kind: "conflict",
      });
    }
    await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/domains`,
      {
        method: "POST",
        ...apiBody({ domain: hostname, primary: false }),
      },
    );
    return this.getSettings(projectId, "domains");
  }

  domainAction(
    projectId: string,
    action: "verify" | "set-primary" | "unbind",
    domainId: string,
    expectedVersion: string,
  ): Promise<DomainsSettings> {
    return this.getSettings(projectId, "domains").then(async (settings) => {
      if (settings.version !== expectedVersion) {
        throw new ManagementApiError("The domain list changed.", {
          status: 409,
          endpoint: `${this.projectPath(projectId)}/settings/domains`,
          kind: "conflict",
        });
      }
      const domain = settings.domains.find((item) => item.id === domainId);
      if (!domain) {
        throw new ManagementApiError("The domain no longer exists.", {
          status: 404,
          endpoint: `${this.projectPath(projectId)}/settings/domains`,
        });
      }
      const endpoint = `${this.projectPath(projectId)}/settings/domains/${segment(domain.hostname)}`;
      if (action === "verify") {
        await this.request<UnknownRecord>(`${endpoint}/verify`, {
          method: "POST",
          ...apiBody({}),
        });
      } else if (action === "set-primary") {
        await this.request<UnknownRecord>(`${endpoint}/primary`, {
          method: "PUT",
          ...apiBody({}),
        });
      } else {
        await this.request<UnknownRecord>(endpoint, { method: "DELETE" });
      }
      return this.getSettings(projectId, "domains");
    });
  }

  testNotification(
    projectId: string,
    channelId: string,
  ): Promise<{ deliveryId: string; status: string }> {
    return this.request(
      `${this.projectPath(projectId)}/settings/notifications/test`,
      {
        method: "POST",
        ...apiBody({ channel_id: channelId }),
      },
    );
  }

  async integrationAction(
    projectId: string,
    action: "reconnect" | "disconnect",
    integrationId: string,
    expectedVersion?: string | null,
  ): Promise<IntegrationBinding> {
    const settings = await this.getSettings(projectId, "integrations");
    const integration = settings.integrations.find(
      (item) => item.id === integrationId,
    );
    if (!integration) {
      throw new ManagementApiError("The integration no longer exists.", {
        status: 404,
        endpoint: `${this.projectPath(projectId)}/settings/integrations`,
      });
    }
    if (
      expectedVersion &&
      integration.version &&
      integration.version !== expectedVersion
    ) {
      throw new ManagementApiError("The integration binding changed.", {
        status: 409,
        endpoint: `${this.projectPath(projectId)}/settings/integrations`,
        kind: "conflict",
      });
    }
    const endpoint =
      `${this.projectPath(projectId)}/settings/integrations/` +
      segment(integration.provider);
    if (action === "reconnect") {
      await this.request<UnknownRecord>(endpoint, {
        method: "PUT",
        ...apiBody({
          provider_resource_id: integration.providerResourceId || "",
          metadata: {},
        }),
      });
    } else {
      await this.request<UnknownRecord>(endpoint, { method: "DELETE" });
    }
    const refreshed = await this.getSettings(projectId, "integrations");
    return (
      refreshed.integrations.find(
        (item) => item.provider === integration.provider,
      ) || {
        ...integration,
        status: "disconnected",
        statusLabel: "Disconnected",
        canReconnect: false,
        canDisconnect: false,
      }
    );
  }

  runSeoAudit(
    projectId: string,
  ): Promise<NonNullable<SeoSettings["lastAudit"]>> {
    return this.request(
      `${this.projectPath(projectId)}/settings/seo/audit`,
      {
        method: "POST",
        ...apiBody({}),
      },
    );
  }

  createSecret(
    projectId: string,
    value: {
      name: string;
      target: string;
      environment: string;
      value: string;
    },
  ): Promise<{ secret: SecretMetadata; receipt: MutationReceipt }> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/secrets`,
      {
        method: "PUT",
        ...apiBody({ ...value, expected_version: 0 }),
      },
    ).then((raw) => ({
      secret: normalizeSecret(asRecord(raw.secret)),
      receipt: mutationReceipt(
        "Secret created; the API did not return an audit event id.",
      ),
    }));
  }

  async rotateSecret(
    projectId: string,
    secretId: string,
    value: string,
    expectedVersion: string,
  ): Promise<{ secret: SecretMetadata; receipt: MutationReceipt }> {
    const settings = await this.getSettings(projectId, "secrets");
    const secret = settings.secrets.find((item) => item.id === secretId);
    if (!secret) {
      throw new ManagementApiError("The secret no longer exists.", {
        status: 404,
        endpoint: `${this.projectPath(projectId)}/settings/secrets`,
      });
    }
    const raw = await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/secrets`,
      {
        method: "PUT",
        ...apiBody({
          name: secret.name,
          target: secret.target,
          environment: secret.environment,
          value,
          expected_version: integerVersion(expectedVersion),
        }),
      },
    );
    return {
      secret: normalizeSecret(asRecord(raw.secret)),
      receipt: mutationReceipt(
        "Secret rotated; the API did not return an audit event id.",
      ),
    };
  }

  deleteSecret(
    projectId: string,
    secretId: string,
    expectedVersion: string,
  ): Promise<MutationReceipt> {
    return this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/secrets/${segment(secretId)}` +
        queryString({ expected_version: integerVersion(expectedVersion) }),
      {
        method: "DELETE",
      },
    ).then(() =>
      mutationReceipt(
        "Secret deleted; the API did not return an audit event id.",
      ),
    );
  }

  async bindGitHub(
    projectId: string,
    repository: string,
    expectedVersion: string,
    expectedRemoteHead?: string,
  ): Promise<GitHubSettings> {
    const current = await this.getSettings(projectId, "github");
    if (current.version !== expectedVersion) {
      throw new ManagementApiError("The GitHub binding changed.", {
        status: 409,
        endpoint: `${this.projectPath(projectId)}/settings/github`,
        kind: "conflict",
      });
    }
    await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/github`,
      {
        method: "PUT",
        ...apiBody({
          repo_full_name: repository,
          branch: "main",
          expected_remote_head: expectedRemoteHead || "",
        }),
      },
    );
    return this.getSettings(projectId, "github");
  }

  async disconnectGitHub(
    projectId: string,
    expectedVersion: string,
  ): Promise<GitHubSettings> {
    const current = await this.getSettings(projectId, "github");
    if (current.version !== expectedVersion) {
      throw new ManagementApiError("The GitHub binding changed.", {
        status: 409,
        endpoint: `${this.projectPath(projectId)}/settings/github`,
        kind: "conflict",
      });
    }
    await this.request<UnknownRecord>(
      `${this.projectPath(projectId)}/settings/github`,
      { method: "DELETE" },
    );
    return this.getSettings(projectId, "github");
  }

  async saveSchedule(
    projectId: string,
    schedule: SaveProjectScheduleInput,
  ): Promise<ProjectSchedule> {
    const collectionEndpoint =
      `${this.projectPath(projectId)}/settings/schedules`;
    if (schedule.enabled === true) {
      throw unavailableError(
        collectionEndpoint,
        "Schedule execution is unavailable; disable this schedule before editing it.",
      );
    }
    const endpoint = schedule.id
      ? `${collectionEndpoint}/${segment(schedule.id)}`
      : collectionEndpoint;
    const raw = await this.request<UnknownRecord>(endpoint, {
      method: schedule.id ? "PUT" : "POST",
      ...apiBody({
        name: schedule.label,
        schedule_type: schedule.kind === "one_shot" ? "once" : "cron",
        cron_expression: schedule.kind === "cron" ? schedule.expression : "",
        run_at: schedule.kind === "one_shot" ? schedule.expression : null,
        timezone: schedule.timezone,
        revision_id: schedule.revisionId,
        enabled: false,
        ...(schedule.id
          ? { expected_version: integerVersion(schedule.version) }
          : {}),
      }),
    });
    return normalizeSchedule(asRecord(raw.schedule));
  }

  async scheduleAction(
    projectId: string,
    action: "enable" | "disable" | "delete",
    schedule: ProjectSchedule,
  ): Promise<SchedulesSettings> {
    const endpoint =
      `${this.projectPath(projectId)}/settings/schedules/` +
      segment(schedule.id);
    if (action === "enable") {
      throw unavailableError(
        endpoint,
        "Schedule execution worker is unavailable; the schedule was not enabled.",
      );
    }
    if (action === "delete") {
      await this.request<UnknownRecord>(
        `${endpoint}${queryString({
          expected_version: integerVersion(schedule.version),
        })}`,
        { method: "DELETE" },
      );
    } else {
      await this.request<UnknownRecord>(endpoint, {
        method: "PUT",
        ...apiBody({
          name: schedule.label,
          schedule_type:
            schedule.kind === "one_shot" ? "once" : "cron",
          cron_expression:
            schedule.kind === "cron" ? schedule.expression : "",
          run_at:
            schedule.kind === "one_shot" ? schedule.expression : null,
          timezone: schedule.timezone,
          revision_id: schedule.revision.id,
          enabled: false,
          expected_version: integerVersion(schedule.version),
        }),
      });
    }
    return this.getSettings(projectId, "schedules");
  }
}

export type ManagementApiClient = {
  [K in keyof ManagementApi]: ManagementApi[K];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function optionalText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function requiredText(
  value: unknown,
  endpoint: string,
  field: string,
): string {
  const result = text(value).trim();
  if (!result) {
    throw unavailableError(
      endpoint,
      `The backend response did not contain ${field}.`,
    );
  }
  return result;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerVersion(value: string | undefined): number {
  const version = Number.parseInt(value || "", 10);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ManagementApiError("The resource version is invalid.", {
      status: 409,
      endpoint: "resource-version",
      kind: "conflict",
    });
  }
  return version;
}

function unavailableError(
  endpoint: string,
  message: string,
): ManagementApiError {
  return new ManagementApiError(message, {
    status: 501,
    endpoint,
    kind: "unavailable",
  });
}

function parsePageCursor(cursor?: string): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ManagementApiError("The page cursor is invalid.", {
      status: 400,
      endpoint: "pagination",
      kind: "validation",
    });
  }
  return offset;
}

function capabilityPermission(
  snapshot: UnknownRecord,
  capability: string,
): boolean {
  return asRecord(snapshot.permissions)[capability] === true;
}

function normalizedRole(
  snapshot: UnknownRecord,
): ProjectSummary["permissions"]["role"] {
  const role = text(snapshot.role);
  return role === "owner" || role === "edit" ? role : "view";
}

function normalizeCapabilities(
  snapshot: UnknownRecord,
): ProjectCapability[] {
  const availability = asRecord(snapshot.availability);
  const detected = asRecord(snapshot.detected);
  const fromAvailability = (
    id: string,
    label: string,
  ): ProjectCapability => {
    const value = asRecord(availability[id]);
    const available = text(value.status) === "available";
    return {
      id,
      label,
      status: available ? "available" : "unavailable",
      reason: available ? null : optionalText(value.reason),
    };
  };
  return [
    {
      id: "publish",
      label: "Publish",
      status: capabilityPermission(snapshot, "publish")
        ? "available"
        : "unavailable",
      reason: capabilityPermission(snapshot, "publish")
        ? null
        : "publish capability required",
    },
    {
      id: "analytics",
      label: "Analytics",
      status: detected.analytics === true ? "available" : "unavailable",
      reason:
        detected.analytics === true ? null : "analytics ingest is not enabled",
    },
    fromAvailability("database", "Database"),
    fromAvailability("storage", "Storage"),
    {
      id: "github",
      label: "GitHub",
      status: detected.github === true ? "available" : "unavailable",
      reason:
        detected.github === true ? null : "GitHub is not bound to the project",
    },
    fromAvailability("schedule_execution", "Schedule execution"),
  ];
}

function normalizeProjectSummary(
  project: UnknownRecord,
  capability: UnknownRecord,
): ProjectSummary {
  const role = normalizedRole(capability);
  const published = asRecord(project.published_site_access);
  const effectiveMode = text(published.effective_mode, "unpublished");
  const publishedMode: ProjectSummary["publishedAccess"]["mode"] =
    effectiveMode === "public"
      ? "public"
      : effectiveMode === "authenticated"
        ? "protected"
        : effectiveMode === "private"
          ? "private"
          : "unavailable";
  const enforcement = text(published.enforcement_status, "not_enforced");
  const workingRevisionId = optionalText(project.working_revision_id);
  const publishedRevisionId = optionalText(project.published_revision_id);
  return {
    id: requiredText(project.project_id, "project-summary", "project_id"),
    displayName: text(project.display_name, "Untitled website"),
    slug: text(project.slug),
    faviconUrl: optionalText(project.favicon_url),
    primaryProductionUrl: optionalText(project.production_url),
    documentationUrl: optionalText(project.documentation_url),
    workingRevision: workingRevisionId
      ? { id: workingRevisionId }
      : null,
    publishedRevision: publishedRevisionId
      ? { id: publishedRevisionId }
      : null,
    capabilities: normalizeCapabilities(capability),
    projectAccess: {
      mode: role === "owner" ? "unknown" : "shared",
      label:
        role === "owner"
          ? "Owner role · member count unavailable"
          : role === "edit"
            ? "Shared editor access"
            : "Shared viewer access",
      memberCount: null,
    },
    publishedAccess: {
      mode: publishedMode,
      label:
        publishedMode === "protected"
          ? "Authenticated"
          : publishedMode === "unavailable"
            ? "Unpublished"
            : publishedMode[0].toUpperCase() + publishedMode.slice(1),
      enforced: enforcement === "enforced",
      reason:
        enforcement === "enforced"
          ? null
          : optionalText(published.error_code) ||
            `access enforcement is ${enforcement}`,
    },
    permissions: {
      role,
      capabilities: [
        "publish",
        "analytics.read",
        "database.read",
        "database.write",
        "storage.read",
        "storage.write",
      ].filter((name) => capabilityPermission(capability, name)) as ProjectSummary["permissions"]["capabilities"],
      canManageAccess: role === "owner",
      canPublish: capabilityPermission(capability, "publish"),
      canReadAnalytics: capabilityPermission(capability, "analytics.read"),
      canReadDatabase: capabilityPermission(capability, "database.read"),
      canWriteDatabase: capabilityPermission(capability, "database.write"),
      canReadStorage: capabilityPermission(capability, "storage.read"),
      canWriteStorage: capabilityPermission(capability, "storage.write"),
      canManageDomains: capabilityPermission(capability, "domains.manage"),
      canManageConnectors: capabilityPermission(
        capability,
        "connectors.manage",
      ),
      canManageSecrets: capabilityPermission(capability, "secrets.manage"),
      canManageSchedules: capabilityPermission(
        capability,
        "schedules.manage",
      ),
      canDeleteProject: capabilityPermission(capability, "project.delete"),
    },
    version: text(project.head_version, text(project.updated_at, "0")),
  };
}

function analyticsDates(
  query: Pick<AnalyticsQuery, "range" | "from" | "to">,
): { start: string; end: string } {
  if (query.range === "custom") {
    if (!query.from || !query.to) {
      throw new ManagementApiError(
        "A custom analytics range requires both dates.",
        {
          status: 400,
          endpoint: "analytics-query",
          kind: "validation",
        },
      );
    }
    return { start: query.from.slice(0, 10), end: query.to.slice(0, 10) };
  }
  const end = new Date();
  if (query.range === "13m") {
    const start = new Date(
      Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth() - 12,
        1,
      ),
    );
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  const days = {
    "24h": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
  }[query.range];
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function analyticsQuery(
  query: Pick<AnalyticsQuery, "range" | "from" | "to" | "filters">,
  options?: {
    dimension?: "path" | "referrer" | "device" | "deployment" | "revision";
  },
): string {
  const dates = analyticsDates(query);
  if (options?.dimension) {
    return queryString({ ...dates, dimension: options.dimension, limit: 50 });
  }
  const filters = query.filters || [];
  if (filters.length > 1) {
    throw new ManagementApiError(
      "The analytics backend supports one dimension filter per request.",
      {
        status: 400,
        endpoint: "analytics-query",
        kind: "validation",
      },
    );
  }
  const filter = filters[0];
  let filterDimension:
    | "path"
    | "referrer"
    | "device"
    | "deployment"
    | "revision"
    | undefined;
  let filterValue: string | undefined;
  if (filter) {
    if (filter.dimension === "deployment_revision") {
      const [prefix, ...rest] = filter.value.split(":");
      filterDimension = prefix === "revision" ? "revision" : "deployment";
      filterValue =
        prefix === "revision" || prefix === "deployment"
          ? rest.join(":")
          : filter.value;
    } else {
      const dimensionMap = {
        path: "path",
        referrer_class: "referrer",
        device_class: "device",
      } as const;
      filterDimension = dimensionMap[filter.dimension];
      filterValue = filter.value;
    }
  }
  return queryString({
    ...dates,
    filter_dimension: filterDimension,
    filter_value: filterValue,
  });
}

function normalizeAnalyticsSummary(raw: UnknownRecord): AnalyticsSummary {
  const range = asRecord(raw.range);
  const values = asRecord(raw.metrics);
  const unavailable = asArray(raw.unavailable_metrics).map(String);
  const metric = (
    key: AnalyticsSummary["metrics"][number]["key"],
    label: string,
    source: string,
    unit: AnalyticsSummary["metrics"][number]["unit"],
  ): AnalyticsSummary["metrics"][number] => ({
    key,
    label,
    value: finiteNumber(values[source]),
    unit,
    changeRatio: null,
  });
  return {
    from: text(range.start),
    to: text(range.end),
    timezone: "UTC",
    metrics: [
      metric("page_views", "Page views", "page_views", "count"),
      metric("visits", "Visits", "visits", "count"),
      metric("visitors", "Visitors", "visitors", "count"),
      metric(
        "duration_seconds",
        "Average duration",
        "average_duration_seconds",
        "seconds",
      ),
      metric("bounce_rate", "Bounce rate", "bounce_rate", "ratio"),
    ],
    sampled: false,
    unavailableReason:
      text(raw.status) === "actual"
        ? null
        : unavailable.length
          ? `Unavailable exact metrics: ${unavailable.join(", ")}`
          : `Analytics status: ${text(raw.status, "unavailable")}`,
  };
}

function normalizeAnalyticsTimeseries(
  raw: UnknownRecord,
): AnalyticsTimeseries {
  return {
    interval: "day",
    points: asArray(raw.items).map((value) => {
      const item = asRecord(value);
      const visits = finiteNumber(item.visits);
      const engaged = finiteNumber(item.engaged_seconds);
      const bounced = finiteNumber(item.bounced_visits);
      return {
        at: text(item.day),
        values: {
          page_views: finiteNumber(item.page_views) ?? 0,
          visits: visits ?? 0,
          visitors: finiteNumber(item.visitors) ?? 0,
          duration_seconds:
            visits && engaged !== null ? engaged / visits : 0,
          bounce_rate:
            visits && bounced !== null ? bounced / visits : 0,
        },
      };
    }),
  };
}

function normalizeAnalyticsDimensions(
  results: Array<{
    dimension: "path" | "referrer" | "device" | "deployment" | "revision";
    response: UnknownRecord;
  }>,
): AnalyticsDimensions {
  const dimensions: AnalyticsDimensions["dimensions"] = {};
  for (const { dimension, response } of results) {
    const target =
      dimension === "referrer"
        ? "referrer_class"
        : dimension === "device"
          ? "device_class"
          : dimension === "deployment" || dimension === "revision"
            ? "deployment_revision"
            : "path";
    const values = asArray(response.items).map((raw) => {
      const item = asRecord(raw);
      const value = text(item.value);
      return {
        value:
          target === "deployment_revision"
            ? `${dimension}:${value}`
            : value,
        label:
          target === "deployment_revision"
            ? `${dimension === "deployment" ? "Deployment" : "Revision"} ${value}`
            : null,
        count: finiteNumber(item.page_views) ?? 0,
      };
    });
    dimensions[target] = [...(dimensions[target] || []), ...values];
  }
  return { dimensions };
}

function normalizeDeployment(raw: UnknownRecord): WebsiteDeployment {
  const rawStatus = text(raw.status);
  const normalizedStatus = rawStatus === "pushing" ? "building" : rawStatus;
  if (
    ![
      "queued",
      "building",
      "verifying",
      "ready",
      "failed",
      "cancelled",
      "unpublished",
    ].includes(normalizedStatus)
  ) {
    throw unavailableError(
      "deployment",
      `Deployment status ${normalizedStatus} is not supported by this client.`,
    );
  }
  const status = normalizedStatus as WebsiteDeployment["status"];
  const productionUrl =
    optionalText(raw.productionUrl) || optionalText(raw.production_url);
  const previewUrl =
    optionalText(raw.previewUrl) || optionalText(raw.preview_url);
  const revision = asRecord(raw.revision);
  const rawActions = asRecord(raw.actions);
  return {
    id: requiredText(raw.id, "deployment", "deployment id"),
    status,
    statusLabel: text(
      raw.statusLabel,
      status[0].toUpperCase() + status.slice(1),
    ),
    environment:
      raw.environment === "preview"
        ? "preview"
        : raw.environment === "production" || productionUrl
          ? "production"
          : "preview",
    revision: {
      id: text(revision.id, text(raw.revision_id)),
      number: finiteNumber(revision.number),
      createdAt: optionalText(revision.createdAt),
    },
    commitSha:
      optionalText(raw.commitSha) || optionalText(raw.commit_sha),
    providerDeploymentId:
      optionalText(raw.providerDeploymentId) ||
      optionalText(raw.provider_deployment_id),
    url: optionalText(raw.url) || productionUrl || previewUrl,
    version: optionalText(raw.version) || optionalText(raw.updated_at),
    startedAt:
      optionalText(raw.startedAt) || optionalText(raw.created_at),
    readyAt: optionalText(raw.readyAt) || optionalText(raw.ready_at),
    failureReason:
      optionalText(raw.failureReason) ||
      optionalText(raw.error_message) ||
      optionalText(raw.error_code),
    actions: {
      canRetry: rawActions.canRetry === true,
      canCancel: rawActions.canCancel === true,
      canUnpublish: rawActions.canUnpublish === true,
    },
  };
}

function normalizeDatabaseBinding(raw: UnknownRecord): DatabaseBinding {
  const binding = asRecord(raw.binding);
  const providerStatus = text(binding.status);
  const status: DatabaseBinding["status"] = !raw.binding
    ? "unbound"
    : providerStatus === "verified"
      ? "ready"
      : providerStatus === "error"
        ? "degraded"
        : "unavailable";
  return {
    status,
    label:
      status === "ready"
        ? `${text(binding.provider, "Database")} database`
        : status === "unbound"
          ? "Database not bound"
          : "Database unavailable",
    provider: optionalText(binding.provider),
    projectLabel: optionalText(binding.provider_project_ref),
    allowedSchemas: asArray(binding.allowed_schemas).map(String),
    reason:
      optionalText(binding.last_error_message) ||
      (status === "unbound" ? "No database binding exists." : null),
    version: optionalText(binding.updated_at),
  };
}

function databaseColumnKind(
  databaseType: string,
): DatabaseSchema["tables"][number]["columns"][number]["kind"] {
  const normalized = databaseType.toLowerCase();
  if (/smallint|integer|bigint|int[248]/.test(normalized)) return "integer";
  if (/numeric|decimal|real|double/.test(normalized)) return "decimal";
  if (/bool/.test(normalized)) return "boolean";
  if (normalized === "date") return "date";
  if (/timestamp/.test(normalized)) return "timestamp";
  if (/uuid/.test(normalized)) return "uuid";
  if (/json/.test(normalized)) return "json";
  if (/bytea|blob|binary/.test(normalized)) return "binary";
  if (/enum/.test(normalized)) return "enum";
  if (/char|text/.test(normalized)) return "text";
  return "unknown";
}

function canonicalDatabaseType(dataType: string, udtName: string): string {
  const normalized = dataType.toLowerCase();
  if (normalized === "character varying") return "varchar";
  if (normalized === "timestamp with time zone") return "timestamptz";
  if (normalized === "timestamp without time zone") return "timestamp";
  if (normalized === "double precision" || normalized === "real") {
    return "numeric";
  }
  if (normalized === "user-defined" && udtName === "uuid") return "uuid";
  return dataType || udtName || "unknown";
}

function normalizeDatabaseSchema(raw: UnknownRecord): DatabaseSchema {
  return {
    version: text(raw.version, "unversioned"),
    tables: asArray(raw.tables).map((value) => {
      const table = asRecord(value);
      const primaryKey = asArray(table.primary_key).map(String);
      return {
        schema: text(table.schema),
        name: text(table.name),
        displayName: null,
        estimatedRowCount: null,
        writable: primaryKey.length > 0,
        readOnlyReason:
          primaryKey.length > 0 ? null : "No primary key was returned.",
        columns: asArray(table.columns).map((columnValue) => {
          const column = asRecord(columnValue);
          const databaseType = canonicalDatabaseType(
            text(column.data_type),
            text(column.udt_name),
          );
          const generated =
            column.identity === true || column.generated === true;
          return {
            name: text(column.name),
            databaseType,
            kind: databaseColumnKind(databaseType),
            nullable: column.nullable === true,
            hasDefault: column.default !== null && column.default !== undefined,
            defaultExpression: optionalText(column.default),
            primaryKey: column.primary_key === true,
            generated,
            writable: !generated,
            enumValues: [],
            foreignKey: null,
          };
        }),
        primaryKey,
        indexes: asArray(table.indexes).map((indexValue) => {
          const index = asRecord(indexValue);
          const definition = text(index.definition);
          const match = definition.match(/\(([^)]+)\)/);
          return {
            name: text(index.name),
            columns: match
              ? match[1]
                  .split(",")
                  .map((item) => item.trim().replace(/^"|"$/g, ""))
              : [],
            unique: /\bcreate\s+unique\s+index\b/i.test(definition),
          };
        }),
      };
    }),
  };
}

function normalizeDatabaseRow(
  raw: UnknownRecord,
  version: string,
): DatabaseRow {
  const values = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "_row_key"),
  ) as Record<string, JsonValue>;
  return {
    key: text(raw._row_key),
    values,
    version: text(raw._row_version, version || "unversioned"),
  };
}

function normalizeDatabaseRows(raw: UnknownRecord): DatabaseRowsPage {
  const tableVersion = text(raw.table_version, "unversioned");
  return {
    tableVersion,
    rows: asArray(raw.items).map((item) =>
      normalizeDatabaseRow(asRecord(item), tableVersion),
    ),
    rowCount: finiteNumber(raw.row_count),
    nextCursor: optionalText(raw.next_cursor),
  };
}

function databaseColumnRequest(column: {
  name: string;
  databaseType: string;
  nullable: boolean;
  defaultExpression?: string | null;
  primaryKey?: boolean;
}): UnknownRecord {
  const supported = new Set([
    "text",
    "varchar",
    "boolean",
    "smallint",
    "integer",
    "bigint",
    "numeric",
    "uuid",
    "date",
    "timestamptz",
    "jsonb",
  ]);
  if (!supported.has(column.databaseType)) {
    throw new ManagementApiError(
      `Database type ${column.databaseType} is not supported by the DDL provider.`,
      {
        status: 400,
        endpoint: "database-schema-plan",
        kind: "validation",
      },
    );
  }
  const expression = (column.defaultExpression || "").trim().toLowerCase();
  const defaultKind =
    !expression
      ? "none"
      : expression === "null"
        ? "null"
        : expression === "now()" || expression === "current_timestamp"
          ? "now"
          : expression.includes("gen_random_uuid")
            ? "uuid"
            : expression === "true"
              ? "true"
              : expression === "false"
                ? "false"
                : expression.includes("'{}'")
                  ? "empty_object"
                  : expression.includes("'[]'")
                    ? "empty_array"
                    : "";
  if (!defaultKind) {
    throw new ManagementApiError(
      "The column default is not supported by the typed DDL provider.",
      {
        status: 400,
        endpoint: "database-schema-plan",
        kind: "validation",
      },
    );
  }
  return {
    name: column.name,
    data_type: column.databaseType,
    nullable: column.nullable,
    default_kind: defaultKind,
    primary_key: Boolean(column.primaryKey),
  };
}

function databaseSchemaOperationRequest(
  operation: DatabaseSchemaOperation,
  expectedSchemaVersion: string,
): UnknownRecord {
  const common = {
    action: operation.kind,
    schema: operation.schema,
    table: operation.table,
    expected_schema_version: expectedSchemaVersion,
  };
  switch (operation.kind) {
    case "create_table":
      return {
        ...common,
        columns: operation.columns.map(databaseColumnRequest),
      };
    case "rename_table":
      return { ...common, new_name: operation.nextName };
    case "drop_table":
      return common;
    case "add_column":
      return { ...common, column: databaseColumnRequest(operation.column) };
    case "alter_column":
      return {
        ...common,
        column: operation.column,
        changes: {
          data_type: operation.next.databaseType,
          nullable: operation.next.nullable,
        },
      };
    case "rename_column":
      return {
        ...common,
        column: operation.column,
        new_name: operation.nextName,
      };
    case "drop_column":
      return { ...common, column: operation.column };
  }
}

function normalizeDatabasePlan(
  raw: UnknownRecord,
  operation: DatabaseSchemaOperation,
  expectedSchemaVersion: string,
): DatabaseSchemaPlan {
  const summary = asRecord(raw.summary);
  return {
    id: requiredText(raw.id, "database-schema-plan", "plan id"),
    operation,
    destructive: raw.destructive === true,
    warnings:
      raw.destructive === true
        ? ["The provider classified this operation as destructive."]
        : [],
    impactSummary: Object.entries(summary)
      .map(([key, value]) => `${key}: ${text(value, JSON.stringify(value))}`)
      .join(" · "),
    expectedSchemaVersion: text(
      raw.expected_schema_version,
      expectedSchemaVersion,
    ),
    expiresAt: text(raw.expires_at),
    confirmationToken: requiredText(
      raw.confirmation,
      "database-schema-plan",
      "confirmation token",
    ),
  };
}

function normalizeDatabaseAuthUsers(
  raw: UnknownRecord,
): DatabaseAuthUsersPage {
  return {
    items: asArray(raw.items).map((value) => {
      const user = asRecord(value);
      const providers = asArray(user.app_metadata).length
        ? asArray(user.app_metadata).map(String)
        : asArray(asRecord(user.app_metadata).providers).map(String);
      const bannedUntil = Date.parse(text(user.banned_until));
      return {
        id: text(user.id),
        email: optionalText(user.email),
        phone: optionalText(user.phone),
        createdAt: text(user.created_at),
        lastSignInAt: optionalText(user.last_sign_in_at),
        status:
          Number.isFinite(bannedUntil) && bannedUntil > Date.now()
            ? "banned"
            : "active",
        providers,
      };
    }),
    nextCursor:
      finiteNumber(raw.next_page) !== null
        ? String(Math.max(0, (finiteNumber(raw.next_page) as number) - 1))
        : null,
  };
}

function normalizeDatabasePolicies(raw: UnknownRecord): DatabasePolicies {
  const tables = asArray(raw.tables).map(asRecord);
  const version = text(raw.version, "unversioned");
  return {
    items: asArray(raw.items).map((value) => {
      const policy = asRecord(value);
      const schema = text(policy.schemaname);
      const table = text(policy.tablename);
      const tableState = tables.find(
        (item) =>
          text(item.schema_name) === schema &&
          text(item.table_name) === table,
      );
      const command = text(policy.cmd, "all").toLowerCase();
      return {
        id: `${schema}.${table}.${text(policy.policyname)}`,
        schema,
        table,
        name: text(policy.policyname),
        command: ["select", "insert", "update", "delete", "all"].includes(
          command,
        )
          ? (command as DatabasePolicies["items"][number]["command"])
          : "all",
        roles: asArray(policy.roles).map(String),
        using: undefined,
        check: undefined,
        enabled: tableState?.enabled === true,
        version,
      };
    }),
  };
}

function mutationReceipt(
  message: string,
  resourceVersion?: string | null,
  affectedRows?: number | null,
): MutationReceipt {
  return {
    auditEventId: "unavailable",
    resourceVersion,
    affectedRows,
    message,
  };
}

function normalizeStorageBinding(raw: UnknownRecord): StorageBinding {
  const binding = asRecord(raw.binding);
  const providerStatus = text(binding.status);
  const status: StorageBinding["status"] = !raw.binding
    ? "unbound"
    : providerStatus === "verified"
      ? "ready"
      : providerStatus === "error"
        ? "degraded"
        : "unavailable";
  const prefix = text(binding.allowed_prefix);
  return {
    status,
    label:
      status === "ready"
        ? `${text(binding.provider, "Storage")} storage`
        : status === "unbound"
          ? "Storage not bound"
          : "Storage unavailable",
    provider: optionalText(binding.provider),
    reason:
      optionalText(binding.last_error_message) ||
      (status === "unbound" ? "No storage binding exists." : null),
    allowedPrefixes: asArray(binding.allowed_buckets).map((bucket) => ({
      bucket: String(bucket),
      prefix,
    })),
    maxObjectBytes: finiteNumber(binding.max_object_bytes),
    quotaBytes: null,
    usedBytes: null,
  };
}

function normalizeStorageBucket(raw: UnknownRecord): StorageBucket {
  return {
    id: text(raw.id, text(raw.name)),
    name: text(raw.name, text(raw.id)),
    visibility: raw.public === true ? "public" : "private",
    objectCount: finiteNumber(raw.object_count),
    bytesUsed: finiteNumber(raw.bytes_used),
  };
}

function normalizeStorageObject(
  raw: UnknownRecord,
  bucket: string,
  fallbackPath = "",
): StorageObject {
  const path = text(raw.path, fallbackPath);
  const name = text(
    raw.name,
    path.split("/").filter(Boolean).at(-1) || path,
  );
  const mimeType = optionalText(raw.mime_type);
  const isFolder = raw.is_folder === true;
  const previewable =
    !isFolder &&
    Boolean(
      mimeType &&
        (/^(?:image|audio|video|text)\//.test(mimeType) ||
          mimeType === "application/pdf"),
    );
  return {
    id: text(raw.id, `${bucket}:${path}`),
    space: "app",
    bucket,
    path,
    name,
    isFolder,
    size: finiteNumber(raw.size),
    mimeType,
    visibility: raw.public === true ? "public" : "private",
    modifiedAt: text(raw.updated_at, text(raw.created_at)),
    etag: text(raw.etag),
    generation: optionalText(raw.generation),
    version: optionalText(raw.version),
    previewable,
  };
}

function normalizeStorageObjects(
  raw: UnknownRecord,
  bucket: string,
  prefix: string,
): StorageObjectsPage {
  return {
    items: asArray(raw.items).map((item) =>
      normalizeStorageObject(asRecord(item), bucket),
    ),
    prefix,
    nextCursor: optionalText(raw.next_cursor),
  };
}

function normalizeStorageUploadInit(raw: UnknownRecord): StorageUploadInit {
  const method = requiredText(raw.method, "storage-upload-init", "upload method");
  if (method !== "PUT" && method !== "POST") {
    throw new ManagementApiError("The signed upload method is invalid.", {
      status: 502,
      endpoint: "storage-upload-init",
      kind: "unavailable",
    });
  }
  return {
    uploadId: requiredText(
      raw.upload_id,
      "storage-upload-init",
      "upload_id",
    ),
    uploadUrl: requiredText(
      raw.upload_url,
      "storage-upload-init",
      "upload_url",
    ),
    method,
    headers: Object.fromEntries(
      Object.entries(asRecord(raw.headers)).map(([key, value]) => [
        key,
        text(value),
      ]),
    ),
    expiresAt: text(raw.expires_at),
    objectPath: text(raw.object_path, text(raw.path)),
    expectedEtag: optionalText(raw.expected_etag),
  };
}

function normalizeSignedObjectUrl(raw: UnknownRecord): SignedObjectUrl {
  const ttl = finiteNumber(raw.expires_in) ?? 300;
  return {
    url: requiredText(raw.url, "signed-download", "signed URL"),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

function requireStorageBucket(object: StorageObject): string {
  if (object.space !== "app") {
    throw unavailableError(
      "storage-object",
      "Project-assets operations are not exposed by the Website Project provider.",
    );
  }
  if (!object.bucket) {
    throw new ManagementApiError("The storage object has no bucket.", {
      status: 400,
      endpoint: "storage-object",
      kind: "validation",
    });
  }
  return object.bucket;
}

function storageObjectVersion(object: StorageObject): string {
  const version = object.version || object.generation || object.etag;
  if (!version) {
    throw unavailableError(
      "storage-object-version",
      "The provider did not return a version for this object.",
    );
  }
  return version;
}

function normalizeGeneralSettings(
  summary: ProjectSummary,
): SettingsDataMap["general"] {
  const published = Boolean(summary.publishedRevision);
  return {
    version: summary.version,
    displayName: summary.displayName,
    slug: summary.slug,
    faviconUrl: summary.faviconUrl,
    primaryUrl: summary.primaryProductionUrl,
    documentationUrl: summary.documentationUrl,
    capabilities: summary.capabilities,
    publish: {
      status: published ? "published" : "unpublished",
      statusLabel: published ? "Published" : "Unpublished",
      primaryUrl: summary.primaryProductionUrl,
      publishedRevision: summary.publishedRevision,
      failureReason: null,
    },
    publishedAccess: summary.publishedAccess,
    hosting: {
      mode: "oceanleo",
      label: "OceanLeo canonical hosting",
      supportedModes: [
        { value: "oceanleo", label: "OceanLeo canonical hosting" },
      ],
    },
    permissions: summary.permissions,
  };
}

function settingsVersion(items: unknown[]): string {
  const versions = items
    .map((item) => text(asRecord(item).updated_at))
    .filter(Boolean)
    .sort();
  return versions.at(-1) || "unversioned";
}

function normalizeDomainsSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SettingsDataMap["domains"] {
  const rows = asArray(raw.items);
  return {
    version: settingsVersion(rows),
    domains: rows.map((value) => {
      const domain = asRecord(value);
      const hostname = text(domain.domain);
      const rawVerification = asArray(domain.verification);
      const verification = rawVerification.flatMap((item) => {
        const record = asRecord(item);
        const type = text(record.type).toUpperCase();
        if (!["CNAME", "A", "AAAA", "TXT"].includes(type)) return [];
        return [
          {
            type: type as "CNAME" | "A" | "AAAA" | "TXT",
            name: text(record.domain, hostname),
            value: text(record.value),
            verified: text(domain.status) === "verified",
          },
        ];
      });
      return {
        id: text(domain.id, hostname),
        hostname,
        primary: domain.is_primary === true,
        platform: domain.provider === "oceanleo",
        status: text(domain.status, "unavailable"),
        statusLabel: titleCase(text(domain.status, "unavailable")),
        certificateStatus: optionalText(domain.certificate_status),
        certificateStatusLabel: optionalText(domain.certificate_status)
          ? titleCase(text(domain.certificate_status))
          : null,
        verification,
        providerResourceId: optionalText(domain.provider_domain_id),
      };
    }),
    canManage: capabilityPermission(capability, "domains.manage"),
  };
}

function titleCase(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function notificationEventFromBackend(
  event: unknown,
): SettingsDataMap["notifications"]["rules"][number]["event"] {
  const value = text(event).replaceAll(".", "_");
  if (
    [
    "deploy_success",
    "deploy_failure",
    "domain_failure",
    "schedule_success",
    "schedule_failure",
    "usage_threshold",
    ].includes(value)
  ) {
    return value as SettingsDataMap["notifications"]["rules"][number]["event"];
  }
  throw unavailableError(
    "notification-settings",
    `Notification event ${value || "unknown"} is not supported by this client.`,
  );
}

function notificationEventToBackend(
  event: SettingsUpdateMap["notifications"]["rules"][number]["event"],
): string {
  return event.replaceAll("_", ".");
}

function notificationChannelId(
  event: string,
  type: string,
  index: number,
): string {
  return [event, type, String(index)].map(encodeURIComponent).join("|");
}

function notificationChannelType(id: string): "email" | "webhook" {
  const type = decodeURIComponent(id.split("|")[1] || "");
  if (type !== "email" && type !== "webhook") {
    throw new ManagementApiError(
      `Notification channel ${type || "unknown"} is not supported.`,
      {
        status: 400,
        endpoint: "notification-settings",
        kind: "validation",
      },
    );
  }
  return type;
}

function normalizeNotificationsSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SettingsDataMap["notifications"] {
  const preferences = asArray(raw.preferences);
  const channels: SettingsDataMap["notifications"]["channels"] = [];
  const rules: SettingsDataMap["notifications"]["rules"] = [];
  for (const value of preferences) {
    const preference = asRecord(value);
    const event = notificationEventFromBackend(preference.event_type);
    const eventTypes = asArray(preference.channels).map(String);
    const recipients = asArray(preference.recipients).map(String);
    const channelPairs = eventTypes.flatMap((type) =>
      (recipients.length ? recipients : [""]).map((recipient) => ({
        type,
        recipient,
      })),
    );
    const channelIds = channelPairs.map(({ type, recipient }, index) => {
      const id = notificationChannelId(event, type, index);
      channels.push({
        id,
        type,
        label: `${titleCase(type)} · ${titleCase(event)}`,
        recipient,
        verified: false,
        enabled: preference.enabled === true,
      });
      return id;
    });
    rules.push({
      event,
      label: titleCase(event),
      enabled: preference.enabled === true,
      channelIds,
      threshold: finiteNumber(asRecord(preference.threshold).value),
    });
  }
  const delivery = asRecord(raw.delivery);
  const workerAvailable = text(delivery.status) === "available";
  return {
    version: settingsVersion(preferences),
    channels,
    rules,
    deliveries: asArray(raw.history).map((value) => {
      const item = asRecord(value);
      return {
        id: text(item.id),
        event: text(item.event_type),
        channelLabel: titleCase(text(item.channel)),
        status: text(item.status, "unavailable"),
        statusLabel: titleCase(text(item.status, "unavailable")),
        attemptedAt: text(item.created_at),
        failureReason:
          optionalText(item.error_message) || optionalText(item.error_code),
      };
    }),
    workerAvailable,
    unavailableReason: workerAvailable
      ? null
      : optionalText(delivery.reason) || "notification_worker_unavailable",
    canManage: capabilityPermission(capability, "connectors.manage"),
  };
}

function normalizeIntegrationsSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SettingsDataMap["integrations"] {
  const connectors = asArray(raw.connectors).map(asRecord);
  const bindings = asArray(raw.bindings).map(asRecord);
  const providers = new Set(
    [...connectors, ...bindings].map((item) => text(item.provider)).filter(Boolean),
  );
  return {
    integrations: [...providers].map((provider) => {
      const connector = connectors.find(
        (item) => text(item.provider) === provider,
      );
      const binding = bindings.find(
        (item) => text(item.provider) === provider,
      );
      const status = text(binding?.status, "unavailable");
      const bound =
        Boolean(binding) &&
        !["disconnected", "unavailable", "error"].includes(status);
      const supported = [
        "supabase",
        "github",
        "vercel",
        "cloudflare",
      ].includes(provider);
      return {
        id: provider,
        provider,
        label: text(connector?.label, titleCase(provider)),
        accountLabel:
          optionalText(binding?.account_label) ||
          optionalText(connector?.label),
        scopes: asArray(binding?.scopes).map(String),
        status,
        statusLabel: titleCase(status),
        verifiedAt: optionalText(binding?.verified_at),
        projectResourceLabel: optionalText(binding?.provider_resource_id),
        providerResourceId: optionalText(binding?.provider_resource_id),
        version: optionalText(binding?.updated_at),
        connectUrl: null,
        canConnect: false,
        canReconnect: supported && bound && connector?.enabled === true,
        canDisconnect: supported && bound,
      };
    }),
    canManage: capabilityPermission(capability, "connectors.manage"),
  };
}

function normalizeSeoSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SettingsDataMap["seo"] {
  const row = asRecord(raw.settings);
  const settings = asRecord(row.settings);
  const apply = asRecord(raw.apply_contract);
  const applyAvailable = text(apply.status) === "available";
  const robots = text(settings.robots, "index,follow");
  return {
    version: text(row.settings_version, "0"),
    titleTemplate: text(settings.title_template),
    description: text(settings.description),
    faviconUrl: optionalText(settings.favicon_url),
    openGraphImageUrl: optionalText(settings.open_graph_image_url),
    canonicalUrl: optionalText(settings.canonical_url),
    robots,
    sitemapEnabled: settings.sitemap_enabled !== false,
    indexable:
      settings.indexable === true ||
      (settings.indexable === undefined && !robots.startsWith("noindex")),
    structuredData:
      settings.structured_data &&
      typeof settings.structured_data === "object"
        ? (settings.structured_data as JsonValue)
        : null,
    lastAudit: null,
    canManage: ["owner", "edit"].includes(normalizedRole(capability)),
    unavailableReason: applyAvailable
      ? null
      : optionalText(apply.reason) || "seo_apply_unavailable",
  };
}

function normalizeSecret(raw: UnknownRecord): SecretMetadata {
  return {
    id: requiredText(raw.id, "secret-settings", "secret id"),
    name: text(raw.name),
    target: text(raw.target),
    environment: text(raw.environment),
    fingerprint: text(raw.fingerprint),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    version: text(raw.version),
  };
}

function normalizeSecretsSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SettingsDataMap["secrets"] {
  return {
    secrets: asArray(raw.items).map((value) =>
      normalizeSecret(asRecord(value)),
    ),
    allowedTargets: ["runtime", "build", "provider"],
    allowedEnvironments: ["production", "preview", "development"],
    canManage: capabilityPermission(capability, "secrets.manage"),
  };
}

function normalizeGitHubSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): GitHubSettings {
  const binding = asRecord(raw.binding);
  const bound = Boolean(raw.binding);
  const status = text(binding.status, text(raw.status, "unavailable"));
  return {
    version: text(binding.updated_at, "unversioned"),
    bound,
    repository: optionalText(binding.repo_full_name),
    repositoryUrl: optionalText(binding.repo_url),
    branch: optionalText(binding.branch),
    lastRemoteHead: optionalText(binding.remote_head),
    lastOceanLeoCommit: optionalText(binding.last_oceanleo_commit),
    syncStatus: bound ? status : null,
    syncStatusLabel: bound ? titleCase(status) : null,
    conflictReason:
      optionalText(binding.last_error_message) ||
      optionalText(binding.last_error_code),
    canManage: capabilityPermission(capability, "github.manage"),
  };
}

function normalizeSchedule(raw: UnknownRecord): ProjectSchedule {
  const scheduleType = text(raw.schedule_type);
  if (scheduleType !== "cron" && scheduleType !== "once") {
    throw unavailableError(
      "schedule-settings",
      `Schedule type ${scheduleType || "unknown"} is not supported by this client.`,
    );
  }
  if (text(raw.action) !== "publish") {
    throw unavailableError(
      "schedule-settings",
      `Schedule action ${text(raw.action) || "unknown"} is not supported by this client.`,
    );
  }
  const kind = scheduleType === "once" ? "one_shot" : "cron";
  return {
    id: requiredText(raw.id, "schedule-settings", "schedule id"),
    label: text(raw.name),
    enabled: raw.enabled === true,
    timezone: text(raw.timezone, "UTC"),
    kind,
    expression:
      kind === "one_shot" ? text(raw.run_at) : text(raw.cron_expression),
    action: "publish",
    revision: {
      id: requiredText(
        raw.revision_id,
        "schedule-settings",
        "revision_id",
      ),
    },
    nextRunAt: optionalText(raw.next_run_at),
    lastRun: null,
    version: requiredText(raw.version, "schedule-settings", "schedule version"),
  };
}

function normalizeSchedulesSettings(
  raw: UnknownRecord,
  capability: UnknownRecord,
): SchedulesSettings {
  const execution = asRecord(raw.execution);
  const executionAvailable = text(execution.status) === "available";
  return {
    schedules: asArray(raw.items).map((value) =>
      normalizeSchedule(asRecord(value)),
    ),
    availableTimezones: ["UTC"],
    canManage: capabilityPermission(capability, "schedules.manage"),
    executionAvailable,
    unavailableReason: executionAvailable
      ? null
      : optionalText(execution.reason) || "schedule_execution_unavailable",
  };
}

function normalizeUsageSettings(
  raw: UnknownRecord,
): SettingsDataMap["usage"] {
  const range = asRecord(raw.range);
  const labels: Record<string, string> = {
    ai_usage: "AI usage",
    build_minutes: "Build minutes",
    bandwidth: "Bandwidth",
    storage: "Storage",
    analytics_events: "Analytics events",
    database: "Database",
    schedule_runs: "Schedule runs",
  };
  return {
    period: {
      startsAt: text(range.start),
      endsAt: text(range.end),
      label: "Project usage range",
    },
    meters: Object.entries(asRecord(raw.metrics)).map(([rawKey, value]) => {
      const meter = asRecord(value);
      const actual = text(meter.status) === "actual";
      return {
        key: rawKey === "ai_usage" ? "ai" : rawKey,
        label: labels[rawKey] || titleCase(rawKey),
        value: actual ? finiteNumber(meter.value) : null,
        unit: text(meter.unit, "unavailable"),
        quota: finiteNumber(meter.quota),
        providerVerified: actual,
        unavailableReason: actual ? null : optionalText(meter.reason),
      };
    }),
  };
}

function putSignedFile(
  upload: StorageUploadInit,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  if (!onProgress || typeof XMLHttpRequest === "undefined") {
    return fetch(upload.uploadUrl, {
      method: upload.method,
      headers: upload.headers,
      body,
      signal: AbortSignal.timeout(120_000),
    }).then((response) => {
      if (!response.ok) {
        throw new ManagementApiError(
          `Signed upload failed with HTTP ${response.status}.`,
          {
            status: response.status,
            endpoint: "signed-upload",
            kind: "unavailable",
          },
        );
      }
    });
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.uploadUrl);
    request.timeout = 120_000;
    for (const [name, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else {
        reject(
          new ManagementApiError(
            `Signed upload failed with HTTP ${request.status}.`,
            {
              status: request.status,
              endpoint: "signed-upload",
              kind: "unavailable",
            },
          ),
        );
      }
    });
    request.addEventListener("error", () => {
      reject(
        new ManagementApiError("The signed upload could not be reached.", {
          endpoint: "signed-upload",
          kind: "network",
        }),
      );
    });
    request.addEventListener("timeout", () => {
      reject(
        new ManagementApiError("The signed upload timed out.", {
          endpoint: "signed-upload",
          kind: "network",
        }),
      );
    });
    request.send(body);
  });
}

export const managementApi = new ManagementApi();

export type {
  DatabaseFilterGroup,
  DatabaseSort,
};
