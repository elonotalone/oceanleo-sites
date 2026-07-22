"use client";

import { useMemo, useState } from "react";
import type { ManagementApiError } from "../api";
import type {
  DatabaseColumn,
  DatabaseRow,
  DatabaseTable,
  JsonValue,
} from "../types";
import {
  Button,
  Dialog,
  Field,
  InlineError,
  SelectInput,
  TextArea,
  TextInput,
} from "../ui";

export function DatabaseRowEditor({
  open,
  table,
  row,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  table: DatabaseTable;
  row: DatabaseRow | null;
  busy: boolean;
  error: ManagementApiError | null;
  onClose: () => void;
  onSubmit: (values: Record<string, JsonValue>) => Promise<void>;
}) {
  const writableColumns = useMemo(
    () => table.columns.filter((column) => column.writable && !column.generated),
    [table.columns],
  );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      writableColumns.map((column) => [
        column.name,
        initialValue(column, row?.values[column.name]),
      ]),
    ),
  );
  const [nullColumns, setNullColumns] = useState<Set<string>>(
    () =>
      new Set(
        writableColumns
          .filter((column) => row?.values[column.name] === null)
          .map((column) => column.name),
      ),
  );
  const [validation, setValidation] = useState<Record<string, string>>({});

  function submit() {
    const next: Record<string, JsonValue> = {};
    const errors: Record<string, string> = {};
    for (const column of writableColumns) {
      if (nullColumns.has(column.name)) {
        next[column.name] = null;
        continue;
      }
      if (
        !row &&
        column.hasDefault &&
        (draft[column.name] ?? "") === ""
      ) {
        continue;
      }
      const result = parseValue(column, draft[column.name] ?? "");
      if (result.error) errors[column.name] = result.error;
      else next[column.name] = result.value as JsonValue;
    }
    setValidation(errors);
    if (!Object.keys(errors).length) void onSubmit(next);
  }

  return (
    <Dialog
      open={open}
      title={row ? `Edit ${table.name} row` : `Insert ${table.name} row`}
      description="Values are parsed according to the introspected column types. The gateway validates the row again before writing."
      onClose={() => {
        if (!busy) onClose();
      }}
      width="lg"
      closeDisabled={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !writableColumns.length}
            onClick={submit}
          >
            {busy ? "Saving…" : row ? "Save row" : "Insert row"}
          </Button>
        </>
      }
    >
      {writableColumns.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {writableColumns.map((column) => {
            const isNull = nullColumns.has(column.name);
            return (
              <div key={column.name}>
                <Field
                  label={column.name}
                  required={!column.nullable && !column.hasDefault}
                  hint={`${column.databaseType}${column.primaryKey ? " · primary key" : ""}${column.hasDefault ? " · default available" : ""}`}
                  error={validation[column.name]}
                >
                  <TypedInput
                    column={column}
                    disabled={isNull || busy}
                    value={draft[column.name] ?? ""}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        [column.name]: value,
                      }))
                    }
                  />
                </Field>
                {column.nullable ? (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={isNull}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setNullColumns((current) => {
                          const next = new Set(current);
                          if (checked) next.add(column.name);
                          else next.delete(column.name);
                          return next;
                        });
                        if (!checked && !(draft[column.name] ?? "")) {
                          setDraft((current) => ({
                            ...current,
                            [column.name]: initialValue(column, undefined),
                          }));
                        }
                      }}
                    />
                    Store a null value
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Introspection did not return any writable columns for this table.
        </p>
      )}
      {error ? (
        <div className="mt-4">
          <InlineError error={error} />
        </div>
      ) : null}
    </Dialog>
  );
}

function TypedInput({
  column,
  value,
  disabled,
  onChange,
}: {
  column: DatabaseColumn;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (column.kind === "boolean") {
    return (
      <SelectInput
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </SelectInput>
    );
  }
  if (column.kind === "enum" && column.enumValues?.length) {
    return (
      <SelectInput
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {column.enumValues.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </SelectInput>
    );
  }
  if (column.kind === "json") {
    return (
      <TextArea
        className="font-mono text-xs"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <TextInput
      value={value}
      disabled={disabled}
      type={
        column.kind === "integer" || column.kind === "decimal"
          ? "number"
          : column.kind === "date"
            ? "date"
            : "text"
      }
      step={column.kind === "integer" ? "1" : "any"}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function parseValue(
  column: DatabaseColumn,
  raw: string,
): { value?: JsonValue; error?: string } {
  if (!raw) {
    if (
      column.kind === "text" ||
      column.kind === "binary" ||
      column.kind === "unknown"
    ) {
      return { value: "" };
    }
    return {
      error: column.nullable
        ? "Enter a value or choose “Store a null value”."
        : "A value is required.",
    };
  }
  if (column.kind === "integer") {
    if (!/^-?\d+$/.test(raw.trim())) {
      return { error: "Enter a whole number." };
    }
    const number = Number(raw);
    return {
      value: Number.isSafeInteger(number) ? number : raw.trim(),
    };
  }
  if (column.kind === "decimal") {
    const number = Number(raw);
    if (!Number.isFinite(number)) return { error: "Enter a valid number." };
    return { value: raw.trim() };
  }
  if (column.kind === "boolean") return { value: raw === "true" };
  if (
    (column.kind === "date" || column.kind === "timestamp") &&
    Number.isNaN(Date.parse(raw))
  ) {
    return {
      error:
        column.kind === "date"
          ? "Enter a valid date."
          : "Enter a valid ISO timestamp.",
    };
  }
  if (
    column.kind === "uuid" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      raw,
    )
  ) {
    return { error: "Enter a valid UUID." };
  }
  if (column.kind === "json") {
    try {
      return { value: JSON.parse(raw) as JsonValue };
    } catch {
      return { error: "Enter valid JSON." };
    }
  }
  return { value: raw };
}

function serializeValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function initialValue(
  column: DatabaseColumn,
  value: JsonValue | undefined,
): string {
  if (value !== undefined) return serializeValue(value);
  if (column.hasDefault) return "";
  if (column.kind === "boolean") return "false";
  if (column.kind === "enum") return column.enumValues?.[0] || "";
  if (column.kind === "json") return "{}";
  return "";
}
