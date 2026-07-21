import { createHash } from "node:crypto";

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Invalid retirement evidence: ${message}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  invariant(isRecord(value), "values must be JSON-compatible");
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

export function isoMilliseconds(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  invariant(Number.isFinite(milliseconds), `${label} is not an ISO timestamp`);
  return milliseconds;
}

export function assertSha256(value: string, label: string): void {
  invariant(/^[a-f0-9]{64}$/u.test(value), `${label} is not a SHA-256 digest`);
}

export function assertSourceSha(value: string, label: string): void {
  invariant(/^[a-f0-9]{40}$/u.test(value), `${label} is not a full source SHA`);
}

export function assertUnique(
  values: readonly string[],
  label: string,
): void {
  invariant(
    new Set(values).size === values.length,
    `${label} must contain unique values`,
  );
}
