import {
  EXCEL_SANDBOX_ALLOWED_EXTENSIONS,
  EXCEL_SANDBOX_MAX_FILE_SIZE_BYTES,
  EXCEL_SANDBOX_MAX_TOTAL_UPLOAD_BYTES,
  EXCEL_SANDBOX_MAX_UPLOAD_FILES,
} from "./constants";
import {
  createFileId,
  createSessionId,
  deleteSessionStorageFile,
  getIncomingUploadPrefix,
  isSessionNotFoundError,
  loadSession,
  readSessionStorageFile,
  saveSession,
  writeSessionSourceFile,
} from "./session-store";
import type {
  ExcelSessionRecord,
  SheetProfile,
} from "./types";
import {
  buildFileProfilesFromBuffer,
  formatFileSize,
  getFileExtension,
  normalizeSamplingConfig,
} from "./workbook";
import { jsonResponse } from "./http";

function hasAllowedExtension(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return EXCEL_SANDBOX_ALLOWED_EXTENSIONS.includes(
    ext as (typeof EXCEL_SANDBOX_ALLOWED_EXTENSIONS)[number]
  );
}

function isUploadLike(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function collectUploads(formData: FormData): File[] {
  const all = formData.getAll("files");
  const uploads = all.filter((entry) => isUploadLike(entry)) as File[];
  if (uploads.length > 0) return uploads;
  const single = formData.get("file");
  if (isUploadLike(single)) return [single];
  return [];
}

type JsonStorageUpload = {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

type UploadJsonBody = {
  sessionId?: string;
  fileId?: string;
  sheetName?: string;
  storageUploads?: JsonStorageUpload[];
};

type NormalizedIncomingUpload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  tempStoragePath?: string;
};

export async function handleExcelSandboxUpload(request: Request): Promise<Response> {
  const cleanupStoragePaths: string[] = [];
  try {
    const contentType = request.headers.get("content-type") || "";
    let requestedSessionId = "";
    let preferredFileId = "";
    let preferredSheet = "";
    const incomingUploads: NormalizedIncomingUpload[] = [];

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as UploadJsonBody;
      requestedSessionId = String(body.sessionId ?? "").trim();
      preferredFileId = String(body.fileId ?? "").trim();
      preferredSheet = String(body.sheetName ?? "").trim();
      const storageUploads = Array.isArray(body.storageUploads) ? body.storageUploads : [];
      if (storageUploads.length === 0) {
        return jsonResponse({ error: "请至少上传一个数据文件。" }, { status: 400 });
      }
      const requiredPrefix = `${getIncomingUploadPrefix()}/`;
      for (const item of storageUploads) {
        const storagePath = String(item.storagePath ?? "").trim();
        const fileName = String(item.fileName ?? "").trim();
        if (!storagePath || !fileName) {
          return jsonResponse({ error: "上传文件信息不完整，请重试。" }, { status: 400 });
        }
        if (!storagePath.startsWith(requiredPrefix)) {
          return jsonResponse({ error: "上传引用非法，请重新上传。" }, { status: 400 });
        }
        const buffer = await readSessionStorageFile(storagePath);
        incomingUploads.push({
          fileName,
          mimeType: String(item.mimeType ?? "application/octet-stream"),
          sizeBytes: Number(item.sizeBytes) > 0 ? Number(item.sizeBytes) : buffer.length,
          buffer,
          tempStoragePath: storagePath,
        });
        cleanupStoragePaths.push(storagePath);
      }
    } else {
      const formData = await request.formData();
      const uploadedFiles = collectUploads(formData);
      requestedSessionId = String(formData.get("sessionId") ?? "").trim();
      preferredFileId = String(formData.get("fileId") ?? "").trim();
      preferredSheet = String(formData.get("sheetName") ?? "").trim();
      if (uploadedFiles.length === 0) {
        return jsonResponse({ error: "请至少上传一个数据文件。" }, { status: 400 });
      }
      for (const file of uploadedFiles) {
        incomingUploads.push({
          fileName: (typeof file.name === "string" && file.name.trim()) || "upload.xlsx",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          buffer: Buffer.from(await file.arrayBuffer()),
        });
      }
    }

    let existingSession: ExcelSessionRecord | null = null;
    if (requestedSessionId) {
      existingSession = await loadSession(requestedSessionId);
    }

    const existingFiles = Array.isArray(existingSession?.files) ? existingSession.files : [];
    if (existingFiles.length + incomingUploads.length > EXCEL_SANDBOX_MAX_UPLOAD_FILES) {
      return jsonResponse(
        { error: `单个会话最多上传 ${EXCEL_SANDBOX_MAX_UPLOAD_FILES} 个文件。` },
        { status: 400 }
      );
    }

    let totalUploadBytes = existingFiles.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
    const sessionId = requestedSessionId || createSessionId();
    const now = new Date().toISOString();
    const lastSampling = existingSession?.lastSampling || normalizeSamplingConfig(null);
    const sessionFiles: ExcelSessionRecord["files"] = [...existingFiles];
    const appendedFiles: ExcelSessionRecord["files"] = [];

    for (const uploaded of incomingUploads) {
      const fileName = uploaded.fileName;
      const extension = getFileExtension(fileName);
      if (!hasAllowedExtension(fileName)) {
        return jsonResponse(
          {
            error: `文件 ${fileName} 格式不支持。当前支持：${EXCEL_SANDBOX_ALLOWED_EXTENSIONS.join(", ")}`,
          },
          { status: 400 }
        );
      }

      if (uploaded.sizeBytes > EXCEL_SANDBOX_MAX_FILE_SIZE_BYTES) {
        return jsonResponse(
          {
            error: `文件 ${fileName} 过大，单文件限制为 ${(
              EXCEL_SANDBOX_MAX_FILE_SIZE_BYTES /
              (1024 * 1024)
            ).toFixed(0)}MB。`,
          },
          { status: 400 }
        );
      }

      totalUploadBytes += uploaded.sizeBytes;
      if (totalUploadBytes > EXCEL_SANDBOX_MAX_TOTAL_UPLOAD_BYTES) {
        return jsonResponse(
          {
            error: `总上传体积过大，当前总限制为 ${(
              EXCEL_SANDBOX_MAX_TOTAL_UPLOAD_BYTES /
              (1024 * 1024)
            ).toFixed(0)}MB。`,
          },
          { status: 400 }
        );
      }

      let sheetNames: string[] = [];
      let profiles: Record<string, SheetProfile> = {};
      let analysisMeta: ExcelSessionRecord["files"][number]["analysisMeta"] | undefined;
      try {
        const parsed = await buildFileProfilesFromBuffer(uploaded.buffer, extension);
        sheetNames = parsed.sheetNames;
        profiles = parsed.profiles;
        analysisMeta = parsed.analysisMeta;
      } catch (error) {
        const reason = error instanceof Error ? `（${error.message}）` : "";
        return jsonResponse(
          { error: `文件 ${fileName} 解析失败，请确认格式正确且未损坏${reason}` },
          { status: 400 }
        );
      }

      if (sheetNames.length === 0) {
        return jsonResponse({ error: `文件 ${fileName} 未检测到可用数据。` }, { status: 400 });
      }

      const fileId = createFileId();
      const storedSource = await writeSessionSourceFile(sessionId, fileName, uploaded.buffer, fileId);
      const activeSheet =
        preferredSheet && sheetNames.includes(preferredSheet) ? preferredSheet : sheetNames[0];

      sessionFiles.push({
        fileId,
        fileName,
        extension,
        mimeType: uploaded.mimeType || "application/octet-stream",
        sizeBytes: uploaded.sizeBytes,
        filePath: storedSource.filePath,
        storagePath: storedSource.storagePath,
        sheetNames,
        activeSheet,
        profiles,
        analysisMeta,
      });
      appendedFiles.push(sessionFiles[sessionFiles.length - 1]);
    }

    if (appendedFiles.length === 0) {
      return jsonResponse({ error: "未检测到有效上传文件。" }, { status: 400 });
    }

    const targetFile =
      (preferredFileId && sessionFiles.find((file) => file.fileId === preferredFileId)) ||
      appendedFiles[0] ||
      sessionFiles[0];
    const targetSheet =
      preferredSheet && targetFile.sheetNames.includes(preferredSheet)
        ? preferredSheet
        : targetFile.activeSheet;

    const session: ExcelSessionRecord = {
      sessionId,
      createdAt: existingSession?.createdAt || now,
      updatedAt: now,
      files: sessionFiles,
      activeTarget: {
        fileId: targetFile.fileId,
        sheetName: targetSheet,
      },
      lastSampling,
    };
    await saveSession(session);

    const responseFiles = sessionFiles.map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      extension: file.extension,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sizeLabel: formatFileSize(file.sizeBytes),
      activeSheet: file.activeSheet,
      sheetNames: file.sheetNames,
      sheets: file.sheetNames.map((sheetName) => ({
        sheetName,
        totalRows: file.profiles[sheetName]?.totalRows ?? 0,
        totalColumns: file.profiles[sheetName]?.totalColumns ?? 0,
      })),
      profiles: file.profiles,
      analysisMeta: file.analysisMeta,
    }));

    return jsonResponse({
      sessionId,
      files: responseFiles,
      activeTarget: {
        fileId: targetFile.fileId,
        sheetName: targetSheet,
      },
      profile: targetFile.profiles[targetSheet],
      samplingPolicy: {
        maxItems: 100,
        default: null,
      },
      assistant: {
        questions: [],
      },
    });
  } catch (error) {
    console.error("Excel sandbox upload error:", error);
    if (isSessionNotFoundError(error)) {
      const message =
        error instanceof Error ? error.message.replace(/^SESSION_NOT_FOUND:\s*/, "") : "会话已失效";
      return jsonResponse({ error: message }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "上传分析失败";
    if (message.includes("Supabase 直传引用")) {
      return jsonResponse({ error: message }, { status: 503 });
    }
    return jsonResponse({ error: message }, { status: 500 });
  } finally {
    if (cleanupStoragePaths.length > 0) {
      await Promise.allSettled(cleanupStoragePaths.map((storagePath) => deleteSessionStorageFile(storagePath)));
    }
  }
}
