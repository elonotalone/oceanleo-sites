import type {
  SelectionCommand,
  SelectionContext,
  SelectionControlValue,
} from "@oceanleo/ui/shell";

export type WebsiteSelectionRevision = string | number;
export type WebsiteSelectionEpoch = string | number;
export type WebsiteEditorBreakpoint =
  | "base"
  | "mobile"
  | "tablet"
  | "desktop";
export type WebsiteSelectionCommandPhase =
  | "start"
  | "update"
  | "commit"
  | "cancel";

/**
 * v23.3 fields are kept local until every consumer has installed the matching
 * shared-shell release. Parsing them here also prevents an older shared
 * normalizer from silently dropping the stale-selection and gesture guards.
 */
export type WebsiteSelectionCommand = SelectionCommand & {
  selectionRevision?: WebsiteSelectionRevision;
  selectionEpoch?: WebsiteSelectionEpoch;
  breakpoint?: WebsiteEditorBreakpoint;
  phase?: WebsiteSelectionCommandPhase;
  transactionId?: string;
};

const COMMAND_ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;
const COMMAND_PHASES = new Set<WebsiteSelectionCommandPhase>([
  "start",
  "update",
  "commit",
  "cancel",
]);
const EDITOR_BREAKPOINTS = new Set<WebsiteEditorBreakpoint>([
  "base",
  "mobile",
  "tablet",
  "desktop",
]);

function commandString(
  value: unknown,
  maximum: number,
  trim = true,
): string {
  if (typeof value !== "string") return "";
  const result = trim ? value.trim() : value;
  return result.length <= maximum ? result : "";
}

function commandValue(value: unknown): SelectionControlValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 20_000) return value;
  return undefined;
}

export function normalizeWebsiteSelectionCommand(
  value: unknown,
): WebsiteSelectionCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const requestId = commandString(source.requestId, 128);
  const selectionId = commandString(source.selectionId, 80);
  const controlId = commandString(source.controlId, 80);
  const normalizedValue = commandValue(source.value);
  const breakpoint = EDITOR_BREAKPOINTS.has(
    source.breakpoint as WebsiteEditorBreakpoint,
  )
    ? (source.breakpoint as WebsiteEditorBreakpoint)
    : undefined;
  const revision =
    typeof source.selectionRevision === "string"
      ? (() => {
          const candidate = commandString(
            source.selectionRevision,
            128,
            false,
          );
          return /^[A-Za-z0-9_.:-]{1,128}$/.test(candidate)
            ? candidate
            : undefined;
        })()
      : typeof source.selectionRevision === "number" &&
          Number.isSafeInteger(source.selectionRevision) &&
          source.selectionRevision >= 0
        ? source.selectionRevision
        : undefined;
  const epoch =
    typeof source.selectionEpoch === "string"
      ? (() => {
          const candidate = commandString(
            source.selectionEpoch,
            128,
            false,
          );
          return /^[A-Za-z0-9_.:-]{1,128}$/.test(candidate)
            ? candidate
            : undefined;
        })()
      : typeof source.selectionEpoch === "number" &&
          Number.isSafeInteger(source.selectionEpoch) &&
          source.selectionEpoch >= 0
        ? source.selectionEpoch
        : undefined;
  const phase = COMMAND_PHASES.has(
    source.phase as WebsiteSelectionCommandPhase,
  )
    ? (source.phase as WebsiteSelectionCommandPhase)
    : undefined;
  const transactionCandidate = commandString(source.transactionId, 128);
  const transactionId = /^[A-Za-z0-9_.:-]{1,128}$/.test(transactionCandidate)
    ? transactionCandidate
    : "";
  if (
    !requestId ||
    !COMMAND_ID_RE.test(selectionId) ||
    !COMMAND_ID_RE.test(controlId) ||
    (source.value !== undefined && normalizedValue === undefined) ||
    (source.breakpoint !== undefined && breakpoint === undefined) ||
    (source.selectionRevision !== undefined && revision === undefined) ||
    (source.selectionEpoch !== undefined && epoch === undefined) ||
    (source.phase !== undefined && phase === undefined) ||
    (source.transactionId !== undefined && !transactionId) ||
    Boolean(phase) !== Boolean(transactionId)
  ) {
    return null;
  }
  return {
    requestId,
    selectionId,
    controlId,
    ...(normalizedValue !== undefined ? { value: normalizedValue } : {}),
    ...(revision !== undefined ? { selectionRevision: revision } : {}),
    ...(epoch !== undefined ? { selectionEpoch: epoch } : {}),
    ...(breakpoint ? { breakpoint } : {}),
    ...(phase ? { phase } : {}),
    ...(transactionId ? { transactionId } : {}),
  };
}

export function selectionCommandTargetsCurrent(
  command: WebsiteSelectionCommand,
  selection: {
    id: string;
    revision: WebsiteSelectionRevision;
    epoch?: WebsiteSelectionEpoch;
  } | null,
): boolean {
  return Boolean(
    selection &&
      command.selectionId === selection.id &&
      command.selectionRevision !== undefined &&
      Object.is(command.selectionRevision, selection.revision) &&
      command.selectionEpoch !== undefined &&
      selection.epoch !== undefined &&
      Object.is(command.selectionEpoch, selection.epoch),
  );
}

export function selectionCommandCanReachPreview(
  command: WebsiteSelectionCommand,
  selection: {
    id: string;
    revision: WebsiteSelectionRevision;
    epoch?: WebsiteSelectionEpoch;
  } | null,
): boolean {
  return (
    command.phase === "cancel" ||
    selectionCommandTargetsCurrent(command, selection)
  );
}

interface WebsiteSelectionTransaction {
  selectionId: string;
  selectionRevision: WebsiteSelectionRevision;
  selectionEpoch: WebsiteSelectionEpoch;
  controlId: string;
}

function contextSupportsSelectionCommand(
  context: SelectionContext,
  controlId: string,
): boolean {
  return context.controls.some((control) => control.id === controlId);
}

function contextHasSelectionIdentity(
  context: SelectionContext,
): context is SelectionContext & {
  revision: WebsiteSelectionRevision;
  epoch: WebsiteSelectionEpoch;
} {
  return (
    (typeof context.revision === "string" ||
      typeof context.revision === "number") &&
    (typeof context.epoch === "string" || typeof context.epoch === "number")
  );
}

export class WebsiteSelectionCommandGate {
  private readonly transactions = new Map<
    string,
    WebsiteSelectionTransaction
  >();
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  accept(
    command: WebsiteSelectionCommand,
    context: SelectionContext | null,
  ): boolean {
    if (!command.requestId || this.seen.has(command.requestId)) return false;
    // Reserve every syntactically valid request identity before semantic
    // validation. Rejected stale/inapplicable messages must not become valid
    // later by reusing the same requestId with a corrected payload.
    this.remember(command.requestId);
    const phase = command.phase;
    const transactionId = command.transactionId;
    if (Boolean(phase) !== Boolean(transactionId)) return false;
    if (phase === "start") {
      if (
        !context ||
        !contextHasSelectionIdentity(context) ||
        !selectionCommandTargetsCurrent(command, context) ||
        !contextSupportsSelectionCommand(context, command.controlId) ||
        this.transactions.has(transactionId!)
      ) {
        return false;
      }
      this.transactions.set(transactionId!, {
        selectionId: command.selectionId,
        selectionRevision: command.selectionRevision!,
        selectionEpoch: command.selectionEpoch!,
        controlId: command.controlId,
      });
    } else if (phase) {
      const active = this.transactions.get(transactionId!);
      if (
        !active ||
        active.selectionId !== command.selectionId ||
        active.controlId !== command.controlId ||
        !Object.is(active.selectionRevision, command.selectionRevision) ||
        !Object.is(active.selectionEpoch, command.selectionEpoch) ||
        (phase !== "cancel" &&
          (!context ||
            !contextHasSelectionIdentity(context) ||
            !selectionCommandTargetsCurrent(command, context) ||
            !contextSupportsSelectionCommand(context, command.controlId)))
      ) {
        return false;
      }
      if (phase === "commit" || phase === "cancel") {
        this.transactions.delete(transactionId!);
      }
    } else if (
      !context ||
      !contextHasSelectionIdentity(context) ||
      !selectionCommandTargetsCurrent(command, context) ||
      !contextSupportsSelectionCommand(context, command.controlId)
    ) {
      return false;
    }
    return true;
  }

  reconcile(context: SelectionContext | null): void {
    for (const [transactionId, active] of this.transactions) {
      if (
        !context ||
        active.selectionId !== context.id ||
        !Object.is(active.selectionRevision, context.revision) ||
        !Object.is(active.selectionEpoch, context.epoch) ||
        !contextSupportsSelectionCommand(context, active.controlId)
      ) {
        this.transactions.delete(transactionId);
      }
    }
  }

  abort(command: WebsiteSelectionCommand): void {
    if (command.transactionId) {
      this.transactions.delete(command.transactionId);
    }
  }

  clear(): void {
    this.transactions.clear();
    this.seen.clear();
    this.order.length = 0;
  }

  private remember(requestId: string): void {
    this.seen.add(requestId);
    this.order.push(requestId);
    if (this.order.length <= 256) return;
    const oldest = this.order.shift();
    if (oldest) this.seen.delete(oldest);
  }
}

export function shouldPersistSelectionCommand(
  command: Partial<Pick<WebsiteSelectionCommand, "controlId" | "phase">>,
): boolean {
  return (
    command.controlId !== "responsive-breakpoint" &&
    (command.phase === undefined || command.phase === "commit")
  );
}

export const DETERMINISTIC_ENDPOINT_CONTROL_IDS = [
  "text",
  "src",
  "alt",
  "href",
  "poster",
  "color",
  "background",
  "font-family",
  "font-size",
  "font-weight",
  "text-align",
  "border",
  "border-radius",
  "padding",
  "margin",
  "opacity",
  "display",
  "gap",
  "border-color",
  "border-width",
  "border-style",
  "insert-image",
  "duplicate",
  "delete",
  "move",
  "layout-x",
  "layout-y",
  "layout-w",
  "layout-h",
  "layout-order",
] as const;

export type DeterministicMutationControlId =
  (typeof DETERMINISTIC_ENDPOINT_CONTROL_IDS)[number];

export const DETERMINISTIC_TOOLBAR_CONTROL_IDS = [
  ...DETERMINISTIC_ENDPOINT_CONTROL_IDS.filter((id) => id !== "move"),
  "move-up",
  "move-down",
] as const;
export type DeterministicToolbarControlId =
  | DeterministicMutationControlId
  | "move-up"
  | "move-down";

const DETERMINISTIC_CONTROL_SET = new Set<string>(
  DETERMINISTIC_TOOLBAR_CONTROL_IDS,
);

const STABLE_EDITOR_ID_RE =
  /^(?:field:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)+|section:[A-Za-z0-9_.-]+|nav:\d+|site-(?:name|header|root))$/;

export function isDeterministicMutationControl(
  value: string,
): value is DeterministicToolbarControlId {
  return DETERMINISTIC_CONTROL_SET.has(value);
}

export function isStableEditorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    STABLE_EDITOR_ID_RE.test(value)
  );
}

export interface StableEditorNode {
  getAttribute(name: string): string | null;
  parentElement: StableEditorNode | null;
}

/**
 * Selection identity is semantic, never positional DOM identity. The clicked
 * node wins when it owns a stable id; otherwise the nearest stable ancestor
 * wins. No DOM-path/hash fallback is intentionally provided.
 */
export function nearestStableEditorTarget<T extends StableEditorNode>(
  node: T | null,
): { id: string; node: T } | null {
  let current = node;
  while (current) {
    const id = (current.getAttribute("data-editor-id") || "").trim();
    if (isStableEditorId(id)) return { id, node: current };
    current = current.parentElement as T | null;
  }
  return null;
}

export interface PendingMutation {
  selectionId: string;
  controlId: DeterministicMutationControlId;
  breakpoint: WebsiteEditorBreakpoint;
  value?: SelectionControlValue;
  /** Keeps repeated structural actions from collapsing in the latest-value map. */
  operationId?: string;
}

const OPERATION_BOUND_CONTROL_IDS = new Set<DeterministicMutationControlId>([
  "duplicate",
  "delete",
  "move",
  "insert-image",
]);

export function isReplaySafeMutation(
  mutation: Pick<PendingMutation, "controlId" | "operationId">,
): boolean {
  return (
    !OPERATION_BOUND_CONTROL_IDS.has(mutation.controlId) ||
    Boolean(mutation.operationId)
  );
}

export function pendingMutationFromCommand(
  selectionId: string,
  controlId: string,
  value?: SelectionControlValue,
  operationId?: string,
  breakpoint: WebsiteEditorBreakpoint = "base",
): PendingMutation | null {
  if (!isStableEditorId(selectionId) || !isDeterministicMutationControl(controlId)) {
    return null;
  }
  if (controlId === "move-up" || controlId === "move-down") {
    return {
      selectionId,
      controlId: "move",
      breakpoint,
      value: controlId === "move-up" ? "up" : "down",
      ...(operationId ? { operationId } : {}),
    };
  }
  return {
    selectionId,
    controlId: controlId as DeterministicMutationControlId,
    breakpoint,
    value,
    ...(OPERATION_BOUND_CONTROL_IDS.has(
      controlId as DeterministicMutationControlId,
    ) && operationId
      ? { operationId }
      : {}),
  };
}

export function pendingMutationKey(
  mutation: Pick<
    PendingMutation,
    "selectionId" | "controlId" | "breakpoint" | "operationId"
  >,
): string {
  return `${mutation.selectionId}:${mutation.controlId}:${mutation.breakpoint}${
    mutation.operationId ? `:${mutation.operationId}` : ""
  }`;
}

/**
 * A latest-value buffer. Removing a batch before I/O lets new edits continue
 * to merge while one request is in flight; restore() never overwrites a newer
 * value that arrived for the same target/control.
 */
export class LatestMutationBuffer {
  readonly #pending = new Map<string, PendingMutation>();

  get size(): number {
    return this.#pending.size;
  }

  upsert(mutation: PendingMutation): void {
    this.#pending.set(pendingMutationKey(mutation), mutation);
  }

  take(limit = 16): PendingMutation[] {
    const batch = Array.from(this.#pending.values()).slice(0, limit);
    for (const mutation of batch) {
      const key = pendingMutationKey(mutation);
      if (this.#pending.get(key) === mutation) this.#pending.delete(key);
    }
    return batch;
  }

  restore(batch: readonly PendingMutation[]): void {
    for (const mutation of batch) {
      const key = pendingMutationKey(mutation);
      if (!this.#pending.has(key)) this.#pending.set(key, mutation);
    }
  }

  clear(): void {
    this.#pending.clear();
  }

  values(): PendingMutation[] {
    return Array.from(this.#pending.values());
  }
}

export function debounceMutationFlush(
  previousTimer: number | null,
  schedule: (callback: () => void, delay: number) => number,
  cancel: (timer: number) => void,
  flush: () => void,
  delay = 240,
): number {
  if (previousTimer !== null) cancel(previousTimer);
  return schedule(flush, delay);
}

export interface SessionDisposeOnce {
  dispose(sessionId: string, keepalive: boolean): boolean;
  hasDisposed(sessionId: string): boolean;
}

/**
 * React unmount, pagehide and the parent dispose message race each other.
 * Starting the DELETE once per session is safer than relying on whichever
 * lifecycle callback happens to run last.
 */
export function createSessionDisposeOnce(
  send: (sessionId: string, keepalive: boolean) => void,
): SessionDisposeOnce {
  const disposed = new Set<string>();
  return {
    dispose(sessionId, keepalive) {
      if (!sessionId || disposed.has(sessionId)) return false;
      disposed.add(sessionId);
      send(sessionId, keepalive);
      return true;
    },
    hasDisposed(sessionId) {
      return disposed.has(sessionId);
    },
  };
}
