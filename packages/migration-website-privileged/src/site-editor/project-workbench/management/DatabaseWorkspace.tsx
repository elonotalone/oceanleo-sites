"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { managementApi, type ManagementApi } from "./api";
import { useApiResource } from "./resource";
import type {
  DatabaseBinding,
  DatabaseSchema,
  DatabaseTable,
  ProjectPermissions,
  WorkspaceBaseProps,
} from "./types";
import {
  Button,
  EmptyState,
  Notice,
  ResourceBoundary,
  StatusPill,
  Tabs,
  TextInput,
  WorkspaceSurface,
  statusTone,
} from "./ui";
import { DatabaseDataPanel } from "./database/DatabaseDataPanel";
import { DatabaseSchemaPanel } from "./database/DatabaseSchemaPanel";
import {
  DatabaseAuthPanel,
  DatabasePoliciesPanel,
} from "./database/DatabaseSecurityPanels";

type DatabaseTab = "data" | "schema" | "auth" | "policies";

export interface DatabaseWorkspaceProps extends WorkspaceBaseProps {
  api?: ManagementApi;
  onOpenDatabaseSettings?: () => void;
}

interface DatabaseWorkspaceData {
  binding: DatabaseBinding;
  schema: DatabaseSchema;
  permissions: ProjectPermissions;
}

function tableKey(table: DatabaseTable): string {
  return `${table.schema}.${table.name}`;
}

export function DatabaseWorkspace({
  projectId,
  className,
  api = managementApi,
  onOpenDatabaseSettings,
}: DatabaseWorkspaceProps) {
  const [tab, setTab] = useState<DatabaseTab>("data");
  const [selectedTableKey, setSelectedTableKey] = useState("");
  const [search, setSearch] = useState("");
  const [schemaPanelKey, setSchemaPanelKey] = useState(0);

  useEffect(() => {
    setTab("data");
    setSelectedTableKey("");
    setSearch("");
    setSchemaPanelKey(0);
  }, [projectId]);

  const loader = useCallback(async (): Promise<DatabaseWorkspaceData> => {
    const [project, binding] = await Promise.all([
      api.getProjectSummary(projectId),
      api.getDatabaseBinding(projectId),
    ]);
    const schema =
      binding.status === "ready"
        ? await api.getDatabaseSchema(projectId)
        : { version: binding.version || "", tables: [] };
    return { binding, schema, permissions: project.permissions };
  }, [api, projectId]);
  const resource = useApiResource(loader, [projectId]);

  const matchingTables = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const tables = resource.data?.schema.tables ?? [];
    if (!needle) return tables;
    return tables.filter((table) =>
      `${table.schema}.${table.name}`.toLowerCase().includes(needle),
    );
  }, [resource.data?.schema.tables, search]);

  const allTables = resource.data?.schema.tables ?? [];
  const selectedTable =
    allTables.find((table) => tableKey(table) === selectedTableKey) ??
    allTables[0] ??
    null;

  return (
    <WorkspaceSurface
      title="Database"
      description="Typed project database access through the management gateway. Arbitrary SQL is never sent by this client."
      className={className}
      actions={
        <Button onClick={() => void resource.reload()}>Refresh schema</Button>
      }
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading database binding"
        onRetry={() => void resource.reload()}
      >
        {(data) => {
          if (!data.permissions.canReadDatabase) {
            return (
              <EmptyState
                title="Database permission required"
                description="Your project role does not include database.read. The gateway independently enforces the same capability."
              />
            );
          }
          if (data.binding.status !== "ready") {
            return (
              <DatabaseBindingUnavailable
                binding={data.binding}
                onOpenSettings={onOpenDatabaseSettings}
              />
            );
          }
          return (
            <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:grid-cols-[250px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col border-b border-zinc-200 bg-zinc-50 lg:border-b-0 lg:border-r">
                <div className="border-b border-zinc-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-800">
                        {data.binding.label}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {data.binding.projectLabel ||
                          data.binding.provider ||
                          "Project binding"}
                      </p>
                    </div>
                    <StatusPill
                      label={data.binding.status}
                      tone={statusTone(data.binding.status)}
                    />
                  </div>
                  <TextInput
                    className="mt-3 min-h-9 text-xs"
                    type="search"
                    aria-label="Search database tables"
                    placeholder="Search tables"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

                <nav
                  className="min-h-0 flex-1 overflow-y-auto p-2"
                  aria-label="Database tables"
                >
                  {matchingTables.length ? (
                    matchingTables.map((table) => {
                      const selected = selectedTable
                        ? tableKey(selectedTable) === tableKey(table)
                        : false;
                      return (
                        <button
                          key={tableKey(table)}
                          type="button"
                          aria-current={selected ? "page" : undefined}
                          onClick={() => {
                            setSelectedTableKey(tableKey(table));
                            setTab("data");
                          }}
                          className={`mb-1 flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            selected
                              ? "bg-white font-medium text-zinc-900 shadow-sm"
                              : "text-zinc-600 hover:bg-white/70"
                          }`}
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-zinc-400">{table.schema}.</span>
                            {table.name}
                          </span>
                          {typeof table.estimatedRowCount === "number" ? (
                            <span className="shrink-0 text-[10px] text-zinc-400">
                              {new Intl.NumberFormat().format(
                                table.estimatedRowCount,
                              )}
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-4 text-center text-xs leading-5 text-zinc-500">
                      {search
                        ? "No tables match this search."
                        : "No business tables were returned."}
                    </p>
                  )}
                </nav>

                <div className="space-y-2 border-t border-zinc-200 p-3">
                  {data.permissions.role === "owner" ? (
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => {
                        setTab("schema");
                        setSchemaPanelKey((current) => current + 1);
                      }}
                    >
                      New table
                    </Button>
                  ) : null}
                  {onOpenDatabaseSettings ? (
                    <Button
                      className="w-full"
                      variant="ghost"
                      size="sm"
                      onClick={onOpenDatabaseSettings}
                    >
                      Database settings
                    </Button>
                  ) : null}
                </div>
              </aside>

              <main className="min-w-0">
                <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-900">
                      {selectedTable
                        ? `${selectedTable.schema}.${selectedTable.name}`
                        : "Database"}
                    </h2>
                    {selectedTable?.readOnlyReason ? (
                      <p className="mt-0.5 text-[11px] text-amber-700">
                        Read only: {selectedTable.readOnlyReason}
                      </p>
                    ) : null}
                  </div>
                  <Tabs
                    label="Database section"
                    value={tab}
                    onChange={setTab}
                    items={[
                      { value: "data", label: "Data" },
                      { value: "schema", label: "Schema" },
                      { value: "auth", label: "Auth" },
                      { value: "policies", label: "Policies" },
                    ]}
                  />
                </div>

                {tab === "data" ? (
                  <div role="tabpanel">
                    {selectedTable ? (
                      <DatabaseDataPanel
                        key={`${projectId}:${tableKey(selectedTable)}`}
                        projectId={projectId}
                        table={selectedTable}
                        canWrite={
                          data.permissions.canWriteDatabase &&
                          selectedTable.writable
                        }
                        api={api}
                      />
                    ) : (
                      <div className="p-5">
                        <EmptyState
                          title="No table selected"
                          description="Create a table or bind a database that exposes at least one allowed business table."
                        />
                      </div>
                    )}
                  </div>
                ) : null}
                <div hidden={tab !== "schema"} role="tabpanel">
                  <DatabaseSchemaPanel
                    key={`${projectId}:${schemaPanelKey}`}
                    projectId={projectId}
                    schema={data.schema}
                    allowedSchemas={data.binding.allowedSchemas}
                    selectedTable={selectedTable}
                    isOwner={data.permissions.role === "owner"}
                    api={api}
                    initiallyCreateTable={schemaPanelKey > 0}
                    onChanged={() => void resource.reload()}
                  />
                </div>
                {tab === "auth" ? (
                  <div role="tabpanel">
                    <DatabaseAuthPanel
                      key={projectId}
                      projectId={projectId}
                      api={api}
                    />
                  </div>
                ) : null}
                {tab === "policies" ? (
                  <div role="tabpanel">
                    <DatabasePoliciesPanel
                      key={projectId}
                      projectId={projectId}
                      api={api}
                    />
                  </div>
                ) : null}
              </main>
            </div>
          );
        }}
      </ResourceBoundary>
    </WorkspaceSurface>
  );
}

function DatabaseBindingUnavailable({
  binding,
  onOpenSettings,
}: {
  binding: DatabaseBinding;
  onOpenSettings?: () => void;
}) {
  return (
    <Notice
      tone={binding.status === "degraded" ? "warning" : "info"}
      title={binding.label}
    >
      <p>
        {binding.reason ||
          "The project API did not report a usable database binding. No database state is inferred."}
      </p>
      {onOpenSettings ? (
        <Button className="mt-3" size="sm" onClick={onOpenSettings}>
          Open integration settings
        </Button>
      ) : null}
    </Notice>
  );
}
