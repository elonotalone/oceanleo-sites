"use client";

import { useId, type ReactNode } from "react";
import { Button, InlineError, Panel } from "../ui";
import type { ManagementApiError } from "../api";

export function SettingsPage({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="space-y-4" aria-labelledby={headingId}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id={headingId}
            className="text-base font-semibold text-zinc-950"
          >
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Panel title={title} description={description} actions={actions}>
      <div className="p-4 sm:p-5">{children}</div>
    </Panel>
  );
}

export function SaveActions({
  busy,
  disabled,
  error,
  onReset,
  onSave,
  label = "Save changes",
}: {
  busy: boolean;
  disabled?: boolean;
  error?: ManagementApiError | null;
  onReset: () => void;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div
      className="space-y-3 border-t border-zinc-100 pt-4"
      aria-live="polite"
    >
      {error ? <InlineError error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onReset}>
          Reset
        </Button>
        <Button
          variant="primary"
          disabled={busy || disabled}
          onClick={onSave}
        >
          {busy ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}
