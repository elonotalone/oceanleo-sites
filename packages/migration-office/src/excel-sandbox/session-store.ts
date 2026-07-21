import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import type { ExcelSessionRecord } from "./types";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const SESSION_NOT_FOUND_CODE = "SESSION_NOT_FOUND";
const INCOMING_UPLOAD_PREFIX = "incoming";

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const trimmed = cleaned.replace(/^_+/, "");
  return trimmed || "upload.xlsx";
}

function makeSessionNotFoundError(sessionId: string): Error {
  return new Error(`${SESSION_NOT_FOUND_CODE}: 会话 ${sessionId} 不存在或已过期，请重新上传文件。`);
}

function isEnoent(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function saveSessionLocal(record: ExcelSessionRecord): Promise<void> {
  await ensureSandboxRoot();
  const sessionDir = getSessionDir(record.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  const metaPath = getSessionMetaPath(record.sessionId);
  await fs.writeFile(metaPath, JSON.stringify(record, null, 2), "utf8");
}

export function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(`${SESSION_NOT_FOUND_CODE}:`);
}

export function getIncomingUploadPrefix(): string {
  return INCOMING_UPLOAD_PREFIX;
}

export function getSandboxRootPath(): string {
  const configuredRoot = process.env.EXCEL_SANDBOX_SESSION_ROOT?.trim();
  if (configuredRoot) {
    return path.isAbsolute(configuredRoot)
      ? configuredRoot
      : path.join(
          /* turbopackIgnore: true */ process.cwd(),
          configuredRoot,
        );
  }
  return path.join(os.tmpdir(), "excel-sandbox");
}

export function createSessionId(): string {
  const uuidPart = randomUUID().split("-")[0];
  const timePart = Date.now().toString(36);
  return `sx_${timePart}_${uuidPart}`;
}

export function createFileId(): string {
  const uuidPart = randomUUID().split("-")[0];
  return `f_${uuidPart}`;
}

export function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("非法会话 ID");
  }
}

export function getSessionDir(sessionId: string): string {
  assertSessionId(sessionId);
  return path.join(getSandboxRootPath(), sessionId);
}

export function getSessionMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "session.json");
}

export function getSessionResultsDir(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "results");
}

export async function ensureSandboxRoot(): Promise<void> {
  await fs.mkdir(getSandboxRootPath(), { recursive: true });
}

export async function writeSessionSourceFile(
  sessionId: string,
  fileName: string,
  content: Buffer,
  fileId?: string,
): Promise<{ filePath: string; storagePath?: string }> {
  await ensureSandboxRoot();
  const sessionDir = getSessionDir(sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  const safeFileName = sanitizeFileName(fileName);
  const safeFileId = fileId ? sanitizeFileName(fileId).replace(/\.+$/, "") : "";
  const prefix = safeFileId ? `${safeFileId}_` : "";
  const targetPath = path.join(sessionDir, `source_${prefix}${safeFileName}`);
  await fs.writeFile(targetPath, content);
  return { filePath: targetPath };
}

export async function readSessionStorageFile(_storagePath: string): Promise<Buffer> {
  throw new Error(
    "当前标准迁移配置未启用 Supabase 直传引用；请使用 multipart/form-data 上传文件。",
  );
}

export async function deleteSessionStorageFile(_storagePath: string): Promise<void> {
  return;
}

export async function saveSession(record: ExcelSessionRecord): Promise<void> {
  await saveSessionLocal(record);
}

export async function loadSession(sessionId: string): Promise<ExcelSessionRecord> {
  assertSessionId(sessionId);
  const metaPath = getSessionMetaPath(sessionId);
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const record = JSON.parse(raw) as ExcelSessionRecord;
    for (const file of record.files || []) {
      if (!(await fileExists(file.filePath))) {
        throw makeSessionNotFoundError(sessionId);
      }
    }
    return record;
  } catch (error) {
    if (isSessionNotFoundError(error)) throw error;
    if (isEnoent(error)) {
      throw makeSessionNotFoundError(sessionId);
    }
    throw error;
  }
}

export async function writeResultFile(
  sessionId: string,
  baseName: string,
  content: string,
  extension = "csv",
): Promise<{ fileName: string; absolutePath: string }> {
  const resultsDir = getSessionResultsDir(sessionId);
  await fs.mkdir(resultsDir, { recursive: true });
  const normalizedBase = sanitizeFileName(baseName).replace(/\.+$/, "") || "result";
  const safeExtension = sanitizeFileName(extension).replace(/\./g, "") || "csv";
  const fileName = `${normalizedBase}.${safeExtension}`;
  const absolutePath = path.join(resultsDir, fileName);
  await fs.writeFile(absolutePath, Buffer.from(content, "utf8"));
  return { fileName, absolutePath };
}

export async function writeResultBinaryFile(
  sessionId: string,
  baseName: string,
  content: Buffer,
  extension: string,
  _contentType = "application/octet-stream",
): Promise<{ fileName: string; absolutePath: string }> {
  const resultsDir = getSessionResultsDir(sessionId);
  await fs.mkdir(resultsDir, { recursive: true });
  const normalizedBase = sanitizeFileName(baseName).replace(/\.+$/, "") || "result";
  const safeExtension = sanitizeFileName(extension).replace(/\./g, "") || "bin";
  const fileName = `${normalizedBase}.${safeExtension}`;
  const absolutePath = path.join(resultsDir, fileName);
  await fs.writeFile(absolutePath, content);
  return { fileName, absolutePath };
}

export async function readResultFile(sessionId: string, fileName: string): Promise<Buffer> {
  assertSessionId(sessionId);
  const safeName = sanitizeFileName(fileName);
  const targetPath = path.join(getSessionResultsDir(sessionId), safeName);
  return fs.readFile(targetPath);
}
