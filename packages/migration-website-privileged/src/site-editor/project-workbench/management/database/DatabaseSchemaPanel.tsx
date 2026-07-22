"use client";

import { useMemo, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction } from "../resource";
import type {
  DatabaseSchema,
  DatabaseSchemaOperation,
  DatabaseSchemaPlan,
  DatabaseTable,
  MutationReceipt,
} from "../types";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Notice,
  SelectInput,
  StatusPill,
  TextInput,
  formatDateTime,
} from "../ui";

type OperationKind = DatabaseSchemaOperation["kind"];

const COLUMN_TYPE_OPTIONS = [
  "text",
  "bigint",
  "numeric",
  "boolean",
  "date",
  "timestamptz",
  "uuid",
  "jsonb",
  "bytea",
] as const;

export function DatabaseSchemaPanel({
  projectId,
  schema,
  allowedSchemas,
  selectedTable,
  isOwner,
  api,
  initiallyCreateTable,
  onChanged,
}: {
  projectId: string;
  schema: DatabaseSchema;
  allowedSchemas: string[];
  selectedTable: DatabaseTable | null;
  isOwner: boolean;
  api: ManagementApi;
  initiallyCreateTable?: boolean;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(Boolean(initiallyCreateTable));
  const [kind, setKind] = useState<OperationKind>(
    initiallyCreateTable ? "create_table" : "add_column",
  );
  const [tableName, setTableName] = useState(
    initiallyCreateTable ? "" : selectedTable?.name || "",
  );
  const [tableSchema, setTableSchema] = useState(
    selectedTable?.schema || allowedSchemas[0] || "public",
  );
  const [columnName, setColumnName] = useState("");
  const [nextName, setNextName] = useState("");
  const [databaseType, setDatabaseType] = useState("text");
  const [nullable, setNullable] = useState(true);
  const [primaryKey, setPrimaryKey] = useState(false);
  const [formError, setFormError] = useState("");
  const [plan, setPlan] = useState<DatabaseSchemaPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<MutationReceipt | null>(null);
  const planAction = useApiAction<DatabaseSchemaPlan>();
  const applyAction = useApiAction<MutationReceipt>();

  const selectedOperationTable = useMemo(
    () =>
      schema.tables.find(
        (table) =>
          table.schema === tableSchema && table.name === tableName,
      ) ?? selectedTable,
    [schema.tables, selectedTable, tableName, tableSchema],
  );
  const selectedSchema =
    kind === "create_table"
      ? tableSchema
      : selectedOperationTable?.schema || tableSchema;

  function openOperation(
    nextKind: OperationKind,
    targetTable = selectedTable,
    targetColumn?: DatabaseTable["columns"][number],
  ) {
    setKind(nextKind);
    if (nextKind === "create_table") {
      setTableName("");
      setTableSchema(
        selectedTable?.schema || allowedSchemas[0] || "public",
      );
      setColumnName("");
      setNextName("");
      setDatabaseType("text");
      setNullable(true);
      setPrimaryKey(false);
    } else {
      const table = targetTable || schema.tables[0] || null;
      const column = targetColumn || table?.columns[0];
      setTableName(table?.name || "");
      setTableSchema(
        table?.schema || allowedSchemas[0] || "public",
      );
      setColumnName(column?.name || "");
      setNextName(
        nextKind === "rename_table" || nextKind === "rename_column"
          ? ""
          : column?.name || "",
      );
      setDatabaseType(column?.databaseType || "text");
      setNullable(column?.nullable ?? true);
      setPrimaryKey(column?.primaryKey ?? false);
    }
    setPlan(null);
    setConfirmation("");
    setFormError("");
    planAction.clear();
    applyAction.clear();
    setDialogOpen(true);
  }

  async function createPlan() {
    const operation = buildOperation({
      kind,
      schema: selectedSchema,
      tableName,
      columnName,
      nextName,
      databaseType,
      nullable,
      primaryKey,
    });
    if (typeof operation === "string") {
      setFormError(operation);
      return;
    }
    setFormError("");
    const next = await planAction.run(() =>
      api.planDatabaseSchema(projectId, operation, schema.version),
    );
    if (next) setPlan(next);
  }

  async function applyPlan() {
    if (!plan) return;
    const result = await applyAction.run(async () => {
      const response = await api.applyDatabaseSchemaPlan(
        projectId,
        plan,
        plan.destructive ? confirmation : undefined,
      );
      return response.receipt;
    });
    if (result) {
      setReceipt(result);
      setDialogOpen(false);
      setPlan(null);
      setConfirmation("");
      onChanged();
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {!isOwner ? (
        <Notice tone="warning" title="Owner permission required for schema changes">
          Schema introspection remains available, but DDL planning and apply
          actions are owner-only. The gateway does not accept the browser role
          as proof of permission.
        </Notice>
      ) : null}
      {receipt ? (
        <Notice tone="success" title="Schema change persisted">
          Audit event: <span className="font-mono">{receipt.auditEventId}</span>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Schema</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Version <span className="font-mono">{schema.version}</span>
          </p>
        </div>
        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openOperation("create_table")}>
              Create table
            </Button>
            {selectedTable ? (
              <>
                <Button size="sm" onClick={() => openOperation("add_column")}>
                  Add column
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openOperation("rename_table")}
                >
                  Rename table
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openOperation("drop_table")}
                >
                  Drop table
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {schema.tables.length ? (
        <div className="space-y-3">
          {schema.tables.map((table) => (
            <section
              key={`${table.schema}.${table.name}`}
              className="overflow-hidden rounded-xl border border-zinc-200"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 bg-zinc-50 px-4 py-3">
                <div>
                  <h4 className="font-mono text-xs font-semibold text-zinc-800">
                    {table.schema}.{table.name}
                  </h4>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {table.primaryKey.length
                      ? `Primary key: ${table.primaryKey.join(", ")}`
                      : "No safe key · row writes disabled"}
                  </p>
                </div>
                <StatusPill
                  label={table.writable ? "Writable" : "Read only"}
                  tone={table.writable ? "positive" : "warning"}
                  title={table.readOnlyReason || undefined}
                />
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <caption className="sr-only">
                    Columns in {table.schema}.{table.name}
                  </caption>
                  <thead>
                    <tr className="border-y border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400">
                      <th className="px-4 py-2 font-medium">Column</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Constraints</th>
                      <th className="px-4 py-2 font-medium">Reference</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((column) => (
                      <tr key={column.name} className="border-b border-zinc-100 last:border-0">
                        <td className="px-4 py-2.5 font-mono text-zinc-800">
                          {column.name}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600">
                          {column.databaseType}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500">
                          {[
                            column.primaryKey ? "primary key" : "",
                            column.nullable ? "nullable" : "required",
                            column.hasDefault ? "default" : "",
                            column.generated ? "generated" : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500">
                          {column.foreignKey
                            ? `${column.foreignKey.schema}.${column.foreignKey.table}.${column.foreignKey.column}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {isOwner ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openOperation("alter_column", table, column)
                                }
                              >
                                Alter
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openOperation("rename_column", table, column)
                                }
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openOperation("drop_column", table, column)
                                }
                              >
                                Drop
                              </Button>
                            </div>
                          ) : (
                            <span className="block text-right text-zinc-400">
                              Owner only
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tables in the allowed schema"
          description="The schema API returned no business tables. System schemas are intentionally excluded."
        />
      )}

      <Dialog
        open={dialogOpen}
        title="Plan schema change"
        description="The server creates a dry-run plan first. Nothing is changed until an owner reviews and applies that exact plan."
        onClose={() => {
          if (!planAction.running && !applyAction.running) {
            setDialogOpen(false);
          }
        }}
        width="lg"
        closeDisabled={planAction.running || applyAction.running}
        footer={
          <>
            <Button
              disabled={planAction.running || applyAction.running}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            {!plan ? (
              <Button
                variant="primary"
                disabled={planAction.running}
                onClick={() => void createPlan()}
              >
                {planAction.running ? "Planning…" : "Review plan"}
              </Button>
            ) : (
              <Button
                variant={plan.destructive ? "danger" : "primary"}
                disabled={
                  applyAction.running ||
                  (plan.destructive &&
                    confirmation !== confirmationPhrase(plan))
                }
                onClick={() => void applyPlan()}
              >
                {applyAction.running ? "Applying…" : "Apply plan"}
              </Button>
            )}
          </>
        }
      >
        {!plan ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Operation">
              <SelectInput
                value={kind}
                onChange={(event) =>
                  openOperation(event.target.value as OperationKind)
                }
              >
                <option value="create_table">Create table</option>
                <option value="rename_table">Rename table</option>
                <option value="drop_table">Drop table</option>
                <option value="add_column">Add column</option>
                <option value="alter_column">Alter column</option>
                <option value="rename_column">Rename column</option>
                <option value="drop_column">Drop column</option>
              </SelectInput>
            </Field>
            <Field label="Schema">
              {kind === "create_table" && allowedSchemas.length ? (
                <SelectInput
                  value={tableSchema}
                  onChange={(event) => setTableSchema(event.target.value)}
                >
                  {allowedSchemas.map((schemaName) => (
                    <option key={schemaName} value={schemaName}>
                      {schemaName}
                    </option>
                  ))}
                </SelectInput>
              ) : (
                <TextInput value={selectedSchema} disabled />
              )}
            </Field>
            <Field label="Table" required>
              {kind === "create_table" ? (
                <TextInput
                  value={tableName}
                  onChange={(event) => setTableName(event.target.value)}
                />
              ) : (
                <SelectInput
                  value={
                    selectedOperationTable
                      ? tableIdentity(selectedOperationTable)
                      : ""
                  }
                  onChange={(event) => {
                    const table = schema.tables.find(
                      (item) => tableIdentity(item) === event.target.value,
                    );
                    if (!table) return;
                    setTableName(table.name);
                    setTableSchema(table.schema);
                    const column = table.columns[0];
                    setColumnName(column?.name || "");
                    setDatabaseType(column?.databaseType || "text");
                    setNullable(column?.nullable ?? true);
                    setPrimaryKey(column?.primaryKey ?? false);
                  }}
                >
                  {schema.tables.map((table) => (
                    <option
                      key={tableIdentity(table)}
                      value={tableIdentity(table)}
                    >
                      {table.schema}.{table.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            {needsColumn(kind) ? (
              <Field label="Column" required>
                {kind === "add_column" || kind === "create_table" ? (
                  <TextInput
                    value={columnName}
                    onChange={(event) => setColumnName(event.target.value)}
                  />
                ) : (
                  <SelectInput
                    value={columnName}
                    onChange={(event) => {
                      const name = event.target.value;
                      setColumnName(name);
                      const column = selectedOperationTable?.columns.find(
                        (item) => item.name === name,
                      );
                      if (column && kind === "alter_column") {
                        setNextName(column.name);
                        setDatabaseType(column.databaseType);
                        setNullable(column.nullable);
                        setPrimaryKey(column.primaryKey);
                      }
                    }}
                  >
                    {selectedOperationTable?.columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            ) : null}
            {needsNextName(kind) ? (
              <Field label="New name" required>
                <TextInput
                  value={nextName}
                  onChange={(event) => setNextName(event.target.value)}
                />
              </Field>
            ) : null}
            {needsDefinition(kind) ? (
              <>
                <Field label="Database type" required>
                  <SelectInput
                    value={databaseType}
                    onChange={(event) => setDatabaseType(event.target.value)}
                  >
                    {!COLUMN_TYPE_OPTIONS.some(
                      (option) => option === databaseType,
                    ) ? (
                      <option value={databaseType}>
                        {databaseType} (current)
                      </option>
                    ) : null}
                    {COLUMN_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <label className="flex items-center gap-2 self-end pb-3 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={nullable}
                    disabled={kind === "create_table" && primaryKey}
                    onChange={(event) => setNullable(event.target.checked)}
                  />
                  Nullable
                </label>
                {kind === "create_table" ? (
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={primaryKey}
                      onChange={(event) => {
                        setPrimaryKey(event.target.checked);
                        if (event.target.checked) setNullable(false);
                      }}
                    />
                    First column is the primary key
                  </label>
                ) : null}
              </>
            ) : null}
            {formError ? (
              <div className="sm:col-span-2">
                <Notice tone="danger">{formError}</Notice>
              </div>
            ) : null}
            {planAction.error ? (
              <div className="sm:col-span-2">
                <InlineError error={planAction.error} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <Notice
              tone={plan.destructive ? "danger" : "warning"}
              title={plan.destructive ? "Destructive plan" : "Review server plan"}
            >
              {plan.impactSummary}
            </Notice>
            {plan.warnings.length ? (
              <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-amber-800">
                {plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <dl className="grid gap-2 rounded-xl bg-zinc-50 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400">Plan ID</dt>
                <dd className="mt-0.5 break-all font-mono text-zinc-700">
                  {plan.id}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Expires</dt>
                <dd className="mt-0.5 text-zinc-700">
                  {formatDateTime(plan.expiresAt)}
                </dd>
              </div>
            </dl>
            {plan.destructive ? (
              <Field
                label={`Type “${confirmationPhrase(plan)}” to apply`}
                required
              >
                <TextInput
                  autoFocus
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
            ) : null}
            {applyAction.error ? <InlineError error={applyAction.error} /> : null}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function buildOperation(input: {
  kind: OperationKind;
  schema: string;
  tableName: string;
  columnName: string;
  nextName: string;
  databaseType: string;
  nullable: boolean;
  primaryKey: boolean;
}): DatabaseSchemaOperation | string {
  const table = input.tableName.trim();
  const column = input.columnName.trim();
  const nextName = input.nextName.trim();
  const databaseType = input.databaseType.trim();
  if (!table) return "Table name is required.";
  if (needsColumn(input.kind) && !column) return "Column name is required.";
  if (needsNextName(input.kind) && !nextName) return "New name is required.";
  if (
    input.kind === "create_table" &&
    !isSafeIdentifier(table)
  ) {
    return "New table names must start with a letter or underscore and contain only letters, numbers, and underscores.";
  }
  if (
    (input.kind === "create_table" || input.kind === "add_column") &&
    !isSafeIdentifier(column)
  ) {
    return "New column names must start with a letter or underscore and contain only letters, numbers, and underscores.";
  }
  if (
    needsNextName(input.kind) &&
    !isSafeIdentifier(nextName)
  ) {
    return "New names must start with a letter or underscore and contain only letters, numbers, and underscores.";
  }
  if (needsDefinition(input.kind) && !databaseType) {
    return "Database type is required.";
  }
  const definition = {
    name: column,
    databaseType,
    nullable: input.nullable,
    primaryKey: input.primaryKey,
  };
  switch (input.kind) {
    case "create_table":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        columns: [definition],
      };
    case "rename_table":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        nextName,
      };
    case "drop_table":
      return { kind: input.kind, schema: input.schema, table };
    case "add_column":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        column: definition,
      };
    case "alter_column":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        column,
        next: { ...definition, name: nextName || column },
      };
    case "rename_column":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        column,
        nextName,
      };
    case "drop_column":
      return {
        kind: input.kind,
        schema: input.schema,
        table,
        column,
      };
  }
}

function needsColumn(kind: OperationKind): boolean {
  return [
    "create_table",
    "add_column",
    "alter_column",
    "rename_column",
    "drop_column",
  ].includes(kind);
}

function needsDefinition(kind: OperationKind): boolean {
  return ["create_table", "add_column", "alter_column"].includes(kind);
}

function needsNextName(kind: OperationKind): boolean {
  return ["rename_table", "rename_column"].includes(kind);
}

function confirmationPhrase(plan: DatabaseSchemaPlan): string {
  return `APPLY ${plan.operation.schema}.${plan.operation.table}`;
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function tableIdentity(table: Pick<DatabaseTable, "schema" | "name">): string {
  return JSON.stringify([table.schema, table.name]);
}
