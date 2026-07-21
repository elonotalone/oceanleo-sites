import { readFile } from "node:fs/promises";

import {
  assertSha256,
  canonicalSha256,
  deepFreeze,
  invariant,
  isRecord,
  isoMilliseconds,
  sha256,
} from "./canonical";
import {
  RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION,
  RETIREMENT_RECEIPT_SCHEMA_VERSION,
  type AnyRetirementReceipt,
  type LoadedRetirementReceiptBundle,
  type ReceiptPayloadByKind,
  type RetirementReceipt,
  type RetirementReceiptBundle,
  type RetirementReceiptKind,
} from "./types";

const RECEIPT_KINDS = new Set<RetirementReceiptKind>([
  "terminal-domains",
  "w1-rollback-drill",
  "release-gate",
  "legacy-resource-seal",
  "soak",
  "change-log",
  "incident-status",
  "hold-status",
  "shared-ui-release",
  "git-archive",
  "credential-status",
]);

export function sealRetirementReceipt<K extends RetirementReceiptKind>(
  retirementManifestSha256: string,
  receiptId: string,
  kind: K,
  issuedAt: string,
  payload: ReceiptPayloadByKind[K],
): RetirementReceipt<K> {
  assertSha256(retirementManifestSha256, "receipt manifest digest");
  invariant(receiptId.length > 0, "receipt ID is empty");
  isoMilliseconds(issuedAt, "receipt issuedAt");
  return deepFreeze({
    schemaVersion: RETIREMENT_RECEIPT_SCHEMA_VERSION,
    receiptId,
    kind,
    issuedAt,
    retirementManifestSha256,
    payloadSha256: canonicalSha256(payload),
    payload,
  });
}

function validateReceipt(
  raw: unknown,
  manifestSha256: string,
): AnyRetirementReceipt {
  invariant(isRecord(raw), "receipt must be an object");
  invariant(
    raw.schemaVersion === RETIREMENT_RECEIPT_SCHEMA_VERSION,
    "receipt schemaVersion mismatch",
  );
  invariant(
    typeof raw.receiptId === "string" && raw.receiptId.length > 0,
    "receipt ID is empty",
  );
  invariant(
    typeof raw.kind === "string" &&
      RECEIPT_KINDS.has(raw.kind as RetirementReceiptKind),
    `${String(raw.receiptId)} has an unknown receipt kind`,
  );
  invariant(
    typeof raw.issuedAt === "string",
    `${String(raw.receiptId)} has no issuedAt`,
  );
  isoMilliseconds(raw.issuedAt, `${raw.receiptId} issuedAt`);
  invariant(
    raw.retirementManifestSha256 === manifestSha256,
    `${raw.receiptId} is bound to another retirement manifest`,
  );
  invariant(
    typeof raw.payloadSha256 === "string",
    `${raw.receiptId} has no payload digest`,
  );
  assertSha256(raw.payloadSha256, `${raw.receiptId} payload digest`);
  invariant(
    raw.payloadSha256 === canonicalSha256(raw.payload),
    `${raw.receiptId} payload digest mismatch`,
  );
  return deepFreeze(raw as unknown as AnyRetirementReceipt);
}

export function validateRetirementReceiptBundle(
  raw: unknown,
  manifestSha256: string,
): RetirementReceiptBundle {
  invariant(isRecord(raw), "receipt bundle root must be an object");
  invariant(
    raw.schemaVersion === RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION,
    "receipt bundle schemaVersion mismatch",
  );
  invariant(
    typeof raw.bundleId === "string" && raw.bundleId.length > 0,
    "receipt bundle ID is empty",
  );
  invariant(
    typeof raw.createdAt === "string",
    "receipt bundle createdAt is missing",
  );
  isoMilliseconds(raw.createdAt, "receipt bundle createdAt");
  invariant(
    raw.retirementManifestSha256 === manifestSha256,
    "receipt bundle is bound to another retirement manifest",
  );
  invariant(Array.isArray(raw.receipts), "receipt bundle has no receipts array");
  const receipts = raw.receipts.map((receipt) =>
    validateReceipt(receipt, manifestSha256),
  );
  invariant(
    new Set(receipts.map((receipt) => receipt.receiptId)).size ===
      receipts.length,
    "receipt IDs must be unique",
  );
  return deepFreeze({
    schemaVersion: RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION,
    bundleId: raw.bundleId,
    createdAt: raw.createdAt,
    retirementManifestSha256: manifestSha256,
    receipts,
  });
}

export function sealRetirementReceiptBundle(
  manifestSha256: string,
  bundleId: string,
  createdAt: string,
  receipts: readonly AnyRetirementReceipt[],
): LoadedRetirementReceiptBundle {
  const bundle = validateRetirementReceiptBundle(
    {
      schemaVersion: RETIREMENT_RECEIPT_BUNDLE_SCHEMA_VERSION,
      bundleId,
      createdAt,
      retirementManifestSha256: manifestSha256,
      receipts,
    },
    manifestSha256,
  );
  return deepFreeze({ bundle, digest: canonicalSha256(bundle) });
}

export async function loadRetirementReceiptBundle(
  bundlePath: string,
  digestPath: string,
  manifestSha256: string,
): Promise<LoadedRetirementReceiptBundle> {
  const [bytes, digestFile] = await Promise.all([
    readFile(bundlePath),
    readFile(digestPath, "utf8"),
  ]);
  const digest = sha256(bytes);
  const expected = digestFile.trim().split(/\s+/u)[0] ?? "";
  assertSha256(expected, "receipt bundle sidecar digest");
  invariant(digest === expected, "receipt bundle digest mismatch");
  const bundle = validateRetirementReceiptBundle(
    JSON.parse(bytes.toString("utf8")) as unknown,
    manifestSha256,
  );
  return deepFreeze({ bundle, digest });
}

export function receiptsOfKind<K extends RetirementReceiptKind>(
  bundle: RetirementReceiptBundle,
  kind: K,
): readonly RetirementReceipt<K>[] {
  return bundle.receipts.filter(
    (receipt): receipt is RetirementReceipt<K> => receipt.kind === kind,
  );
}

export function exactlyOneReceipt<K extends RetirementReceiptKind>(
  bundle: RetirementReceiptBundle,
  kind: K,
): RetirementReceipt<K> {
  const matches = receiptsOfKind(bundle, kind);
  invariant(matches.length === 1, `expected exactly one ${kind} receipt`);
  return matches[0] as RetirementReceipt<K>;
}
