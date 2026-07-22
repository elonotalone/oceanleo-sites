"use client";

import { useCallback, useMemo, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type {
  DatabaseColumn,
  DatabaseFilterGroup,
  DatabaseFilterOperator,
  DatabaseRow,
  DatabaseSort,
  DatabaseTable,
  JsonPrimitive,
  JsonValue,
  MutationReceipt,
} from "../types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  SelectInput,
  TextInput,
  formatNumber,
} from "../ui";
import { DatabaseRowEditor } from "./DatabaseRowEditor";

const FILTER_OPERATORS: Array<{
  value: DatabaseFilterOperator;
  label: string;
}> = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "is_null", label: "is null" },
];

export function DatabaseDataPanel({
  projectId,
  table,
  canWrite,
  api,
}: {
  projectId: string;
  table: DatabaseTable;
  canWrite: boolean;
  api: ManagementApi;
}) {
  const [pageSize, setPageSize] = useState(25);
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const currentCursor = cursorHistory[cursorHistory.length - 1];
  const [sortColumn, setSortColumn] = useState(table.primaryKey[0] || "");
  const [sortDirection, setSortDirection] =
    useState<DatabaseSort["direction"]>("asc");
  const [filterColumn, setFilterColumn] = useState(table.columns[0]?.name || "");
  const [filterOperator, setFilterOperator] =
    useState<DatabaseFilterOperator>("eq");
  const [filterDraft, setFilterDraft] = useState("");
  const [filterError, setFilterError] = useState("");
  const [filter, setFilter] = useState<DatabaseFilterGroup | undefined>();
  const [editorRow, setEditorRow] = useState<DatabaseRow | null | undefined>(
    undefined,
  );
  const [deleteRow, setDeleteRow] = useState<DatabaseRow | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<MutationReceipt | null>(null);

  const sort = useMemo<DatabaseSort | undefined>(
    () =>
      sortColumn
        ? { column: sortColumn, direction: sortDirection }
        : undefined,
    [sortColumn, sortDirection],
  );
  const loader = useCallback(
    () =>
      api.getDatabaseRows(projectId, table.schema, table.name, {
        cursor: currentCursor,
        limit: pageSize,
        sort,
        filter,
      }),
    [api, currentCursor, filter, pageSize, projectId, sort, table.name, table.schema],
  );
  const rows = useApiResource(
    loader,
    [projectId, table.schema, table.name, currentCursor, pageSize, sort, filter],
  );
  const mutation = useApiAction<MutationReceipt>();

  const visibleColumns = table.columns;

  function resetPagination() {
    setCursorHistory([undefined]);
  }

  function applyFilter() {
    if (!filterColumn) return;
    const column = table.columns.find((item) => item.name === filterColumn);
    if (!column) return;
    const parsed: { value?: JsonPrimitive; error?: string } =
      filterOperator === "is_null"
        ? { value: undefined }
        : parseFilterValue(column, filterDraft);
    if (parsed.error) {
      setFilterError(parsed.error);
      return;
    }
    setFilterError("");
    setFilter({
      type: "group",
      operator: "and",
      children: [
        {
          type: "predicate",
          column: filterColumn,
          operator: filterOperator,
          value: parsed.value,
        },
      ],
    });
    resetPagination();
  }

  async function saveRow(values: Record<string, JsonValue>) {
    const currentRows = rows.data;
    if (!currentRows) return;
    const result = await mutation.run(async () => {
      if (editorRow) {
        const response = await api.updateDatabaseRow(
          projectId,
          table.schema,
          table.name,
          editorRow,
          values,
        );
        return response.receipt;
      }
      const response = await api.insertDatabaseRow(
        projectId,
        table.schema,
        table.name,
        values,
        currentRows.tableVersion,
      );
      return response.receipt;
    });
    if (result) {
      setReceipt(result);
      setEditorRow(undefined);
      await rows.reload();
    }
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    const result = await mutation.run(() =>
      api.deleteDatabaseRow(
        projectId,
        table.schema,
        table.name,
        deleteRow,
      ),
    );
    if (result) {
      setReceipt(result);
      setDeleteRow(null);
      setConfirmation("");
      await rows.reload();
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(8rem,0.7fr)_minmax(9rem,1fr)_auto]">
          <Field label="Filter column">
            <SelectInput
              className="min-h-9 text-xs"
              value={filterColumn}
              disabled={!table.columns.length}
              onChange={(event) => {
                setFilterColumn(event.target.value);
                setFilterError("");
              }}
            >
              {table.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Operator">
            <SelectInput
              className="min-h-9 text-xs"
              value={filterOperator}
              disabled={!table.columns.length}
              onChange={(event) => {
                setFilterOperator(
                  event.target.value as DatabaseFilterOperator,
                );
                setFilterError("");
              }}
            >
              {FILTER_OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Typed value" error={filterError}>
            <TextInput
              className="min-h-9 text-xs"
              value={filterDraft}
              disabled={
                !table.columns.length || filterOperator === "is_null"
              }
              onChange={(event) => {
                setFilterDraft(event.target.value);
                setFilterError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilter();
              }}
            />
          </Field>
          <Button
            className="self-end"
            size="sm"
            disabled={!table.columns.length}
            onClick={applyFilter}
          >
            Apply filter
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Sort">
            <SelectInput
              className="min-h-9 w-32 text-xs"
              value={sortColumn}
              onChange={(event) => {
                setSortColumn(event.target.value);
                resetPagination();
              }}
            >
              <option value="">Unsorted</option>
              {table.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Direction">
            <SelectInput
              className="min-h-9 w-24 text-xs"
              value={sortDirection}
              disabled={!sortColumn}
              onChange={(event) => {
                setSortDirection(
                  event.target.value as DatabaseSort["direction"],
                );
                resetPagination();
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </SelectInput>
          </Field>
          {filter ? (
            <Button
              size="sm"
              onClick={() => {
                setFilter(undefined);
                setFilterDraft("");
                setFilterError("");
                resetPagination();
              }}
            >
              Clear filter
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                mutation.clear();
                setEditorRow(null);
              }}
            >
              Insert row
            </Button>
          ) : null}
        </div>
      </div>

      {receipt ? (
        <div className="p-3 pb-0" aria-live="polite">
          <Notice tone="success" title="Database write persisted">
            Audit event: <span className="font-mono">{receipt.auditEventId}</span>
          </Notice>
        </div>
      ) : null}
      {mutation.error && editorRow === undefined && !deleteRow ? (
        <div className="p-3 pb-0">
          <InlineError error={mutation.error} />
        </div>
      ) : null}

      <div className="p-3">
        <ResourceBoundary
          resource={rows}
          loadingLabel={`Loading ${table.name} rows`}
          emptyTitle="No rows returned"
          emptyDescription="The typed query completed successfully but this page contains no rows."
          onRetry={() => void rows.reload()}
        >
          {(page) => (
            <>
              {!page.rows.length ? (
                <EmptyState
                  title="No rows returned"
                  description="The typed query completed successfully but this page contains no rows."
                  compact
                />
              ) : null}
              <div
                className={
                  page.rows.length
                    ? "overflow-x-auto rounded-xl border border-zinc-200"
                    : "hidden"
                }
              >
                <table className="w-full min-w-max border-separate border-spacing-0 text-left">
                  <caption className="sr-only">
                    Rows from {table.schema}.{table.name}
                  </caption>
                  <thead className="sticky top-0 z-10 bg-zinc-50">
                    <tr>
                      {visibleColumns.map((column) => (
                        <th
                          key={column.name}
                          className="max-w-72 border-b border-r border-zinc-200 px-3 py-2 text-[11px] font-medium text-zinc-500 last:border-r-0"
                        >
                          <span className="block">{column.name}</span>
                          <span className="font-normal text-zinc-400">
                            {column.databaseType}
                            {column.primaryKey ? " · key" : ""}
                          </span>
                        </th>
                      ))}
                      <th className="w-32 border-b border-zinc-200 px-3 py-2 text-right text-[11px] font-medium text-zinc-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <tr
                        key={row.key}
                        className="bg-white hover:bg-zinc-50"
                      >
                        {visibleColumns.map((column) => (
                          <td
                            key={column.name}
                            className="max-w-72 border-b border-r border-zinc-100 px-3 py-2 text-xs text-zinc-700 last:border-r-0"
                          >
                            <span
                              className="block max-h-16 overflow-hidden whitespace-pre-wrap break-all"
                              title={cellTitle(row.values[column.name])}
                            >
                              {renderCell(row.values[column.name])}
                            </span>
                          </td>
                        ))}
                        <td className="border-b border-zinc-100 px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              disabled={!canWrite}
                              title={
                                canWrite
                                  ? "Edit this row"
                                  : table.readOnlyReason ||
                                    "Write permission required"
                              }
                              onClick={() => {
                                mutation.clear();
                                setEditorRow(row);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite}
                              onClick={() => {
                                mutation.clear();
                                setConfirmation("");
                                setDeleteRow(row);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-col gap-3 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {typeof page.rowCount === "number"
                    ? `${formatNumber(page.rowCount)} rows`
                    : `${formatNumber(page.rows.length)} rows on this page`}
                </div>
                <div className="flex items-center gap-2">
                  <SelectInput
                    aria-label="Rows per page"
                    className="min-h-8 w-24 py-0 text-xs"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      resetPagination();
                    }}
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size} / page
                      </option>
                    ))}
                  </SelectInput>
                  <Button
                    size="sm"
                    disabled={cursorHistory.length <= 1}
                    onClick={() => {
                      setCursorHistory((current) => current.slice(0, -1));
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    disabled={!page.nextCursor}
                    onClick={() => {
                      if (!page.nextCursor) return;
                      setCursorHistory((current) => [
                        ...current,
                        page.nextCursor || undefined,
                      ]);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </ResourceBoundary>
      </div>

      {editorRow !== undefined ? (
        <DatabaseRowEditor
          key={editorRow?.key || "new"}
          open
          table={table}
          row={editorRow}
          busy={mutation.running}
          error={mutation.error}
          onClose={() => {
            setEditorRow(undefined);
            mutation.clear();
          }}
          onSubmit={saveRow}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteRow)}
        title="Delete database row"
        description="This write is sent with the current row version. A concurrent change will cause a conflict instead of being overwritten."
        confirmLabel="Delete row"
        confirmationText={deleteRow?.key}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={mutation.running}
        error={mutation.error}
        onClose={() => {
          if (mutation.running) return;
          setDeleteRow(null);
          setConfirmation("");
          mutation.clear();
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function parseFilterValue(
  column: DatabaseColumn,
  raw: string,
): { value?: JsonPrimitive; error?: string } {
  if (column.kind === "integer" || column.kind === "decimal") {
    if (!raw.trim()) return { error: "Enter a numeric filter value." };
    const value = Number(raw);
    if (column.kind === "integer") {
      if (!/^-?\d+$/.test(raw.trim())) {
        return { error: "Enter a whole-number filter value." };
      }
      return {
        value: Number.isSafeInteger(value) ? value : raw.trim(),
      };
    }
    if (!Number.isFinite(value)) {
      return { error: "Enter a valid numeric filter value." };
    }
    return { value: raw.trim() };
  }
  if (column.kind === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      return { error: "Enter true or false." };
    }
    return { value: normalized === "true" };
  }
  return { value: raw };
}

function renderCell(value: JsonValue | undefined) {
  if (value === undefined) return <span className="text-zinc-400">missing</span>;
  if (value === null) return <span className="italic text-zinc-400">null</span>;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cellTitle(value: JsonValue | undefined): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
