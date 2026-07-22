"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { ManagementApiError } from "./api";
import type { ResourceState } from "./resource";

export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function WorkspaceSurface({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      className={cx(
        "min-h-0 flex-1 overflow-y-auto bg-zinc-50 text-zinc-950",
        className,
      )}
      aria-labelledby={headingId}
    >
      <div className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1
              id={headingId}
              className="text-xl font-semibold tracking-tight text-zinc-950"
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  as = "section",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  const Component = as;
  const headingId = useId();
  return (
    <Component
      aria-labelledby={title ? headingId : undefined}
      className={cx(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        className,
      )}
    >
      {title || description || actions ? (
        <div className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title ? (
              <h2
                id={headingId}
                className="text-sm font-semibold text-zinc-900"
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Component>
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    size?: "sm" | "md";
  }
>(function Button(
  {
    variant = "secondary",
    size = "md",
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm",
        variant === "primary" &&
          "border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "secondary" &&
          "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
        variant === "danger" &&
          "border border-red-600 bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" &&
          "border border-transparent bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  const fieldId = useId();
  const messageId = useId();
  type ControlProps = {
    id?: string;
    required?: boolean;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "false" | "true";
  };
  const control = isValidElement<ControlProps>(children)
    ? cloneElement(children, {
        id: children.props.id ?? fieldId,
        required: children.props.required ?? required,
        "aria-describedby":
          [children.props["aria-describedby"], error || hint ? messageId : ""]
            .filter(Boolean)
            .join(" ") || undefined,
        "aria-invalid":
          children.props["aria-invalid"] ?? (error ? true : undefined),
      })
    : children;

  return (
    <div className="block">
      <label
        htmlFor={
          isValidElement<ControlProps>(control) ? control.props.id : fieldId
        }
        className="mb-1.5 block text-xs font-medium text-zinc-700"
      >
        {label}
        {required ? (
          <>
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {control}
      {error ? (
        <span
          id={messageId}
          className="mt-1 block text-xs text-red-600"
          role="alert"
        >
          {error}
        </span>
      ) : hint ? (
        <span
          id={messageId}
          className="mt-1 block text-xs leading-5 text-zinc-500"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const inputClass =
  "min-h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-100 disabled:text-zinc-500";

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function SelectInput({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputClass, className)} {...props} />;
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(inputClass, "min-h-24 py-2.5", className)}
      {...props}
    />
  );
}

export function StatusPill({
  label,
  tone = "neutral",
  title,
}: {
  label: string;
  tone?: "positive" | "warning" | "negative" | "info" | "neutral";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "positive" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-700",
        tone === "negative" && "border-red-200 bg-red-50 text-red-700",
        tone === "info" && "border-blue-200 bg-blue-50 text-blue-700",
        tone === "neutral" &&
          "border-zinc-200 bg-zinc-50 text-zinc-600",
      )}
    >
      {label}
      {title ? <span className="sr-only">: {title}</span> : null}
    </span>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-3.5 py-3 text-sm",
        tone === "info" && "border-blue-200 bg-blue-50 text-blue-800",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-800",
        tone === "danger" && "border-red-200 bg-red-50 text-red-800",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cx(title && "mt-1", "text-xs leading-5")}>{children}</div>
    </div>
  );
}

export function InlineError({ error }: { error: ManagementApiError | null }) {
  if (!error) return null;
  return (
    <Notice tone="danger" title="Request failed">
      {error.message}
      {error.kind === "conflict"
        ? " Refresh the latest server state before trying again."
        : null}
    </Notice>
  );
}

export function ResourceBoundary<T>({
  resource,
  children,
  loadingLabel = "Loading project data",
  emptyTitle = "Nothing here yet",
  emptyDescription = "The project API returned an empty collection.",
  onRetry,
}: {
  resource: ResourceState<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
}) {
  if (resource.status === "loading" && !resource.data) {
    return <LoadingState label={loadingLabel} />;
  }
  if (
    resource.status === "forbidden" ||
    resource.status === "unavailable" ||
    resource.status === "error"
  ) {
    return (
      <FailureState
        error={resource.error}
        status={resource.status}
        onRetry={onRetry}
      />
    );
  }
  if (resource.status === "empty") {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    );
  }
  if (!resource.data) {
    return (
      <FailureState
        error={resource.error}
        status="error"
        onRetry={onRetry}
      />
    );
  }
  return <>{children(resource.data)}</>;
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div
      className="grid min-h-44 place-items-center rounded-2xl border border-zinc-200 bg-white p-8"
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <span
          className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-800"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm text-zinc-500">{label}…</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "grid place-items-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 px-5 text-center",
        compact ? "min-h-28 py-5" : "min-h-44 py-8",
      )}
    >
      <div className="max-w-md">
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function FailureState({
  error,
  status,
  onRetry,
}: {
  error: ManagementApiError | null;
  status: ResourceState<unknown>["status"];
  onRetry?: () => void;
}) {
  const forbidden = status === "forbidden";
  const unauthenticated = error?.kind === "unauthenticated";
  const unavailable = status === "unavailable";
  return (
    <div
      className="grid min-h-44 place-items-center rounded-2xl border border-zinc-200 bg-white p-8 text-center"
      role={forbidden ? "status" : "alert"}
    >
      <div className="max-w-lg">
        <h3 className="text-sm font-semibold text-zinc-900">
          {unauthenticated
            ? "Sign in required"
            : forbidden
              ? "You do not have permission"
            : unavailable
              ? "Management API unavailable"
              : "Could not load this project data"}
        </h3>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          {error?.message ||
            (unavailable
              ? "The backend has not exposed this capability or cannot be reached. No success state has been assumed."
              : "The project API did not return usable data.")}
        </p>
        {error?.endpoint ? (
          <p className="mt-2 break-all font-mono text-[10px] text-zinc-400">
            {error.endpoint}
          </p>
        ) : null}
        {onRetry && !forbidden ? (
          <Button className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  label,
}: {
  value: T;
  items: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  function moveFocus(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)',
      ) ?? [],
    );
    if (tabs.length < 2) return;
    const current = tabs.indexOf(event.currentTarget);
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    next?.focus();
    next?.click();
  }

  return (
    <div
      className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100 p-1"
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(event, -1);
            } else if (
              event.key === "ArrowRight" ||
              event.key === "ArrowDown"
            ) {
              event.preventDefault();
              moveFocus(event, 1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const tabs = Array.from(
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]:not(:disabled)',
                ) ?? [],
              );
              const next =
                event.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
              next?.focus();
              next?.click();
            }
          }}
          className={cx(
            "min-h-8 shrink-0 rounded-lg px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40",
            value === item.value
              ? "bg-white text-zinc-900 shadow-sm"
              : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "md",
  closeDisabled = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  closeDisabled?: boolean;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return;
    const prior = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          element.getAttribute("aria-hidden") !== "true" &&
          element.offsetParent !== null,
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const initial =
      dialogRef.current?.querySelector<HTMLElement>("[autofocus]") ??
      (closeDisabledRef.current ? dialogRef.current : closeRef.current);
    initial?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prior?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-zinc-950/45 p-4 backdrop-blur-sm">
      <button
        className="absolute inset-0 cursor-default"
        type="button"
        tabIndex={-1}
        disabled={closeDisabled}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-busy={closeDisabled}
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(
          "relative z-10 max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl",
          width === "sm" && "max-w-sm",
          width === "md" && "max-w-lg",
          width === "lg" && "max-w-2xl",
          width === "xl" && "max-w-4xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
          <div>
            <h2 id={headingId} className="text-base font-semibold text-zinc-900">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-xs leading-5 text-zinc-500"
              >
                {description}
              </p>
            ) : null}
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="sm"
            disabled={closeDisabled}
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </Button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmationText,
  confirmationValue,
  onConfirmationValueChange,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmationText?: string;
  confirmationValue?: string;
  onConfirmationValueChange?: (value: string) => void;
  busy?: boolean;
  error?: ManagementApiError | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const valid =
    !confirmationText || confirmationValue === confirmationText;
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      width="sm"
      closeDisabled={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy || !valid}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {confirmationText ? (
        <Field
          label={`Type “${confirmationText}” to confirm`}
          required
        >
          <TextInput
            autoFocus
            autoComplete="off"
            value={confirmationValue}
            onChange={(event) =>
              onConfirmationValueChange?.(event.target.value)
            }
          />
        </Field>
      ) : null}
      {error ? <div className="mt-4"><InlineError error={error} /></div> : null}
    </Dialog>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="divide-y divide-zinc-100">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(8rem,0.4fr)_minmax(0,1fr)] sm:items-start sm:px-5"
        >
          <dt className="text-xs font-medium text-zinc-500">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm text-zinc-800">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    setState("idle");
  }, [value]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" onClick={() => void copy()}>
        {state === "copied"
          ? "Copied"
          : state === "error"
            ? "Copy failed"
            : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "error"
            ? "Clipboard copy failed"
            : ""}
      </span>
    </span>
  );
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumber(value?: number | null): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value?: number | null): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(value?: number | null): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(value?: number | null): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return "Unavailable";
  }
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** index;
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(amount)} ${units[index]}`;
}

export function statusTone(
  status: string,
): "positive" | "warning" | "negative" | "info" | "neutral" {
  const normalized = status.toLowerCase();
  if (
    ["ready", "success", "verified", "available", "enabled", "public"].includes(
      normalized,
    )
  ) {
    return "positive";
  }
  if (
    ["failed", "error", "revoked", "degraded", "expired"].includes(normalized)
  ) {
    return "negative";
  }
  if (
    ["queued", "building", "verifying", "pending", "warning"].includes(
      normalized,
    )
  ) {
    return "warning";
  }
  if (["running", "active", "syncing"].includes(normalized)) return "info";
  return "neutral";
}
