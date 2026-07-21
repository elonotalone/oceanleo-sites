import path from "path";
import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import { jsonResponse } from "./http";
import { runPythonSandbox } from "./python-runner";
import { extractBearerToken } from "./gateway";
import {
  isSessionNotFoundError,
  loadSession,
  saveSession,
  writeResultBinaryFile,
  writeResultFile,
} from "./session-store";
import { persistGenerationResult } from "./generation-storage";
import type {
  PythonExecutionMode,
  SamplingConfig,
  UploadedDataFileRecord,
} from "./types";
import {
  applySampling,
  buildSheetProfileFromRows,
  isSpreadsheetExtension,
  normalizeSamplingConfig,
  readRowsFromStoredFile,
} from "./workbook";


type RunBody = {
  sessionId?: string;
  pythonCode?: string;
  mode?: PythonExecutionMode;
  targetFileId?: string;
  sheetName?: string;
  includeAllFiles?: boolean;
  selectedFileIds?: string[];
  requirement?: string;
  answers?: string;
  sampling?: Partial<SamplingConfig> | null;
};

function stringifyTextCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const worksheet = XLSX.utils.json_to_sheet(rows);
  return XLSX.utils.sheet_to_csv(worksheet);
}

function toText(rows: Record<string, unknown>[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const normalized = [...rows];
  const canOrderByLine = normalized.every((row) => Object.prototype.hasOwnProperty.call(row, "line"));
  if (canOrderByLine) {
    normalized.sort((a, b) => {
      const left = Number(a.line);
      const right = Number(b.line);
      const leftNum = Number.isFinite(left) ? left : 0;
      const rightNum = Number.isFinite(right) ? right : 0;
      return leftNum - rightNum;
    });
  }
  return normalized
    .map((row) => {
      if (Object.prototype.hasOwnProperty.call(row, "content")) {
        return stringifyTextCell(row.content);
      }
      if (Object.prototype.hasOwnProperty.call(row, "text")) {
        return stringifyTextCell(row.text);
      }
      const keys = Object.keys(row);
      if (keys.length === 0) return "";
      if (keys.length === 1) {
        return stringifyTextCell(row[keys[0]]);
      }
      return keys.map((key) => `${key}: ${stringifyTextCell(row[key])}`).join("\t");
    })
    .join("\n");
}

function mergeWarnings(...messages: Array<string | undefined>): string | undefined {
  const merged = messages
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("；");
  return merged || undefined;
}

function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
}

type OutputArtifact = {
  fileName: string;
  mimeType?: string;
  base64: string;
  description?: string;
};

const INLINE_SOURCE_BASE64_MAX_BYTES = 12 * 1024 * 1024;
const INLINE_SOURCE_BASE64_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);

async function readInlineSourceBase64(
  filePath: string,
  extension: string,
  sizeBytes: number
): Promise<string | undefined> {
  const normalizedExtension = String(extension || "").toLowerCase();
  if (!INLINE_SOURCE_BASE64_EXTENSIONS.has(normalizedExtension)) return undefined;
  const normalizedSize = Number(sizeBytes);
  if (
    !Number.isFinite(normalizedSize) ||
    normalizedSize < 1 ||
    normalizedSize > INLINE_SOURCE_BASE64_MAX_BYTES
  ) {
    return undefined;
  }
  try {
    const payload = await fs.readFile(filePath);
    if (payload.length <= 0) return undefined;
    return payload.toString("base64");
  } catch {
    return undefined;
  }
}

function parseArtifacts(raw: unknown): OutputArtifact[] {
  if (!Array.isArray(raw)) return [];
  const artifacts: OutputArtifact[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") continue;
    const artifact = item as Record<string, unknown>;
    const fileName = String(artifact.fileName || artifact.name || `artifact_${index + 1}.bin`).trim();
    const base64 = String(artifact.base64 || artifact.contentBase64 || artifact.dataBase64 || "").trim();
    if (!fileName || !base64) continue;
    try {
      Buffer.from(base64, "base64");
    } catch {
      continue;
    }
    artifacts.push({
      fileName,
      mimeType: String(artifact.mimeType || artifact.contentType || "").trim() || undefined,
      base64,
      description: String(artifact.description || "").trim() || undefined,
    });
  }
  return artifacts;
}

function resolveTargetFile(
  files: UploadedDataFileRecord[],
  preferredFileId: string,
  sessionFileId: string
): UploadedDataFileRecord {
  if (preferredFileId) {
    const matched = files.find((file) => file.fileId === preferredFileId);
    if (matched) return matched;
  }
  if (sessionFileId) {
    const matched = files.find((file) => file.fileId === sessionFileId);
    if (matched) return matched;
  }
  return files[0];
}

function pickHeaders(
  rows: Record<string, unknown>[],
  profileHeaders?: string[]
): string[] {
  if (Array.isArray(profileHeaders) && profileHeaders.length > 0) return profileHeaders;
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}

export async function handleExcelSandboxRun(request: Request): Promise<Response> {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) {
      return jsonResponse(
        { error: "未登录或登录已过期，请重新登录后再试。" },
        { status: 401 }
      );
    }
    const body = (await request.json()) as RunBody;
    const sessionId = String(body.sessionId ?? "").trim();
    const pythonCode = String(body.pythonCode ?? "");
    if (!sessionId) {
      return jsonResponse({ error: "缺少 sessionId" }, { status: 400 });
    }
    if (!pythonCode.trim()) {
      return jsonResponse({ error: "请先提供 Python 代码。" }, { status: 400 });
    }

    const mode: PythonExecutionMode = body.mode === "full" ? "full" : "sample";
    const session = await loadSession(sessionId);
    if (!Array.isArray(session.files) || session.files.length === 0) {
      return jsonResponse({ error: "会话中没有可执行的文件数据。" }, { status: 400 });
    }

    const targetFile = resolveTargetFile(
      session.files,
      String(body.targetFileId ?? "").trim(),
      String(session.activeTarget?.fileId ?? "").trim()
    );
    const sourceExtension = String(targetFile.extension || "").toLowerCase();
    const sourceIsSpreadsheet = isSpreadsheetExtension(sourceExtension);
    const requestedSheet = String(body.sheetName ?? "").trim();
    const fallbackTargetSheet =
      targetFile.fileId === session.activeTarget?.fileId
        ? session.activeTarget?.sheetName || targetFile.activeSheet
        : targetFile.activeSheet;
    const preferredTargetSheet = requestedSheet || fallbackTargetSheet;

    const sampling = normalizeSamplingConfig(body.sampling);
    const includeAllFiles = body.includeAllFiles !== false;
    const selectedFileIds = Array.isArray(body.selectedFileIds)
      ? body.selectedFileIds
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
    const selectedFileSet = new Set(selectedFileIds);

    const loadedTarget = await readRowsFromStoredFile(
      targetFile.filePath,
      targetFile.extension,
      preferredTargetSheet
    );
    const targetSheetName = loadedTarget.sheetName;
    const sourceRows = loadedTarget.rows;
    const targetProfile =
      targetFile.profiles[targetSheetName] ??
      buildSheetProfileFromRows(targetSheetName, sourceRows);
    targetFile.profiles[targetSheetName] = targetProfile;
    const headers = pickHeaders(sourceRows, targetProfile.headers);

    const sampled =
      mode === "sample"
        ? applySampling(sourceRows, headers, sampling)
        : {
            rows: sourceRows,
            indexes: Array.from({ length: sourceRows.length }, (_, i) => i),
            selectedHeaders: headers,
          };

    const candidateFiles =
      selectedFileSet.size > 0
        ? session.files.filter((file) => selectedFileSet.has(file.fileId) || file.fileId === targetFile.fileId)
        : includeAllFiles
          ? session.files
          : [targetFile];
    if (candidateFiles.length === 0) {
      return jsonResponse({ error: "项目中未选择可用文件，请先添加文件。" }, { status: 400 });
    }
    const requestUrl = new URL(request.url);
    const sourceBaseUrl =
      process.env.EXCEL_SANDBOX_PUBLIC_BASE_URL?.trim() || requestUrl.origin;
    const filesPayload: Array<Record<string, unknown>> = [];
    const fileRuntimeMeta = new Map<
      string,
      { downloadUrl: string; sourceBase64?: string }
    >();
    const datasetInputs: Array<{
      fileId: string;
      fileName: string;
      extension: string;
      mimeType: string;
      sheetName: string;
      sourceRowsCount: number;
      inputRowsCount: number;
    }> = [];

    for (const file of candidateFiles) {
      const preferredSheet =
        file.fileId === targetFile.fileId ? targetSheetName : file.activeSheet;
      const loaded =
        file.fileId === targetFile.fileId
          ? { rows: sourceRows, sheetName: targetSheetName }
          : await readRowsFromStoredFile(file.filePath, file.extension, preferredSheet);
      const profile =
        file.profiles[loaded.sheetName] ??
        buildSheetProfileFromRows(loaded.sheetName, loaded.rows);
      file.profiles[loaded.sheetName] = profile;
      file.activeSheet = loaded.sheetName;
      const rowHeaders = pickHeaders(loaded.rows, profile.headers);
      const sampledRows =
        mode === "sample"
          ? applySampling(loaded.rows, rowHeaders, sampling)
          : {
              rows: loaded.rows,
              indexes: Array.from({ length: loaded.rows.length }, (_, idx) => idx),
              selectedHeaders: rowHeaders,
            };
      const sourceDownloadUrl = `${sourceBaseUrl}/api/excel-sandbox/source?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(file.fileId)}`;
      const sourceBase64 = await readInlineSourceBase64(
        file.filePath,
        file.extension,
        file.sizeBytes
      );
      fileRuntimeMeta.set(file.fileId, {
        downloadUrl: sourceDownloadUrl,
        sourceBase64,
      });
      filesPayload.push({
        fileId: file.fileId,
        fileName: file.fileName,
        extension: file.extension,
        mimeType: file.mimeType,
        sheetName: loaded.sheetName,
        mode,
        rows: sampledRows.rows,
        sourceRowsCount: loaded.rows.length,
        inputRowsCount: sampledRows.rows.length,
        sampledIndexes: sampledRows.indexes,
        selectedHeaders: sampledRows.selectedHeaders,
        downloadUrl: sourceDownloadUrl,
        url: sourceDownloadUrl,
        sourceBase64,
        contentBase64: sourceBase64,
      });
      datasetInputs.push({
        fileId: file.fileId,
        fileName: file.fileName,
        extension: file.extension,
        mimeType: file.mimeType,
        sheetName: loaded.sheetName,
        sourceRowsCount: loaded.rows.length,
        inputRowsCount: sampledRows.rows.length,
      });
    }

    const requirement = String(body.requirement ?? "").trim();
    const answers = String(body.answers ?? "").trim();
    const sourceFilesForContext = datasetInputs.map((item) => {
      const runtimeMeta = fileRuntimeMeta.get(item.fileId);
      const downloadUrl =
        runtimeMeta?.downloadUrl ||
        `${sourceBaseUrl}/api/excel-sandbox/source?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(item.fileId)}`;
      return {
        ...item,
        downloadUrl,
        url: downloadUrl,
        sourceBase64: runtimeMeta?.sourceBase64,
        contentBase64: runtimeMeta?.sourceBase64,
      };
    });
    const targetRuntimeMeta = fileRuntimeMeta.get(targetFile.fileId);
    const targetDownloadUrl =
      targetRuntimeMeta?.downloadUrl ||
      `${sourceBaseUrl}/api/excel-sandbox/source?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(targetFile.fileId)}`;

    const pythonResult = await runPythonSandbox({
      token,
      rows: sampled.rows,
      files: filesPayload,
      pythonCode,
      mode,
      context: {
        sessionId,
        target: {
          fileId: targetFile.fileId,
          fileName: targetFile.fileName,
          extension: targetFile.extension,
          sheetName: targetSheetName,
          mimeType: targetFile.mimeType,
          downloadUrl: targetDownloadUrl,
          url: targetDownloadUrl,
          sourceBase64: targetRuntimeMeta?.sourceBase64,
          contentBase64: targetRuntimeMeta?.sourceBase64,
          pageCount:
            Number.isFinite(Number(targetFile.analysisMeta?.pageCount)) &&
            Number(targetFile.analysisMeta?.pageCount) > 0
              ? Number(targetFile.analysisMeta?.pageCount)
              : undefined,
        },
        files: datasetInputs,
        sourceFiles: sourceFilesForContext,
        sourceFieldHints: [
          "downloadUrl",
          "url",
          "sourceBase64",
          "contentBase64",
          "fileName",
          "mimeType",
          "extension",
        ],
        mode,
        requirement,
        answers,
        sampling,
        sampledIndexes: sampled.indexes,
        selectedHeaders: sampled.selectedHeaders,
        sourceRowsCount: sourceRows.length,
      },
    });

    if (!pythonResult.ok || !pythonResult.result) {
      if (pythonResult.authError) {
        return jsonResponse(
          { error: pythonResult.error || "未登录或登录已过期，请重新登录后再试。" },
          { status: 401 }
        );
      }
      const rawError = String(pythonResult.error || "");
      const sourceFieldIssue =
        /(downloadurl|sourcebase64|contentbase64|base64|bytes|sourcefiles|target)/i.test(
          rawError
        ) || /keyerror|nameerror|attributeerror/i.test(rawError);
      const filesKeyHint =
        filesPayload.length > 0 ? Object.keys(filesPayload[0]).join(", ") : "(empty files)";
      const sourceFilesKeyHint =
        sourceFilesForContext.length > 0
          ? Object.keys(sourceFilesForContext[0]).join(", ")
          : "(empty sourceFiles)";
      const enrichedError = sourceFieldIssue
        ? `${rawError}\n\n[调试] files[0] keys: ${filesKeyHint}\n[调试] context.sourceFiles[0] keys: ${sourceFilesKeyHint}`
        : rawError;
      const infraFailure =
        rawError.includes("未找到可用 Python 解释器") ||
        rawError.includes("无法启动 Python 进程") ||
        rawError.includes("找不到 Python Runner 脚本");
      return jsonResponse(
        {
          error: enrichedError || "Python 执行失败",
          traceback: pythonResult.traceback || "",
          logs: pythonResult.logs || "",
        },
        { status: infraFailure ? 500 : 400 }
      );
    }

    const output = pythonResult.result;
    const summaryText = String(output.summary || "").trim();
    const textOutput = String(output.textOutput || "").trim();
    const exportRows =
      Array.isArray(output.exportRows) && output.exportRows.length > 0
        ? output.exportRows
        : output.previewRows;
    const outputArtifacts = parseArtifacts(output.artifacts);
    const textFromRows = toText(exportRows);
    const csvContent = sourceIsSpreadsheet ? toCsv(exportRows) : "";
    let download: { fileName: string; url: string } | null = null;
    let downloads: Array<{ fileName: string; url: string }> = [];
    let saveWarning: string | undefined;
    let savedArtifact: { id?: string; downloadUrl: string } | null = null;
    const sourceFileType = sourceExtension.replace(/^\./, "") || "txt";
    const sourceBase = path.parse(targetFile.fileName).name || "result";
    const stamp = Date.now();
    const baseName = sourceIsSpreadsheet
      ? `${sourceBase}_${targetSheetName}_${mode}_${stamp}`
      : `${sourceBase}_${mode}_${stamp}`;

    let outputContent = "";
    let outputExtension = "";
    let outputContentType = "";
    let outputResultKind: "text" | "spreadsheet" = "text";
    let formatWarning: string | undefined;
    let binaryDownloadHandled = false;

    if (outputArtifacts.length > 0) {
      const savedDownloads: Array<{ fileName: string; url: string }> = [];
      for (let index = 0; index < outputArtifacts.length; index += 1) {
        const artifact = outputArtifacts[index];
        const payload = Buffer.from(artifact.base64, "base64");
        if (payload.length === 0) continue;
        const parsedName = path.parse(artifact.fileName || `artifact_${index + 1}.bin`);
        const extFromName = parsedName.ext.replace(/^\./, "");
        const extFromMime =
          artifact.mimeType === "application/pdf"
            ? "pdf"
            : artifact.mimeType === "application/json"
              ? "json"
              : artifact.mimeType?.startsWith("text/plain")
                ? "txt"
                : artifact.mimeType?.startsWith("text/markdown")
                  ? "md"
                  : artifact.mimeType?.startsWith("text/csv")
                    ? "csv"
                    : artifact.mimeType?.startsWith("image/png")
                      ? "png"
                      : artifact.mimeType?.startsWith("image/jpeg")
                        ? "jpg"
                        : "";
        const safeExt = extFromName || extFromMime || "bin";
        const safeBase = parsedName.name || `${sourceBase}_${index + 1}`;
        const saved = await writeResultBinaryFile(
          sessionId,
          `${safeBase}_${mode}_${stamp}`,
          payload,
          safeExt,
          artifact.mimeType || "application/octet-stream"
        );
        const params = new URLSearchParams({
          sessionId,
          fileName: saved.fileName,
        });
        savedDownloads.push({
          fileName: saved.fileName,
          url: `/api/excel-sandbox/download?${params.toString()}`,
        });
      }
      if (savedDownloads.length > 0) {
        download = savedDownloads[0];
        downloads = savedDownloads;
        binaryDownloadHandled = true;
      }
    }

    if (!binaryDownloadHandled && sourceIsSpreadsheet) {
      if (csvContent) {
        outputContent = csvContent;
        outputExtension = "csv";
        outputContentType = "text/csv; charset=utf-8";
        outputResultKind = "spreadsheet";
      } else if (textOutput) {
        outputContent = textOutput;
        outputExtension = "txt";
        outputContentType = "text/plain; charset=utf-8";
      } else if (summaryText) {
        outputContent = summaryText;
        outputExtension = "txt";
        outputContentType = "text/plain; charset=utf-8";
      }
    } else if (!binaryDownloadHandled && sourceExtension === ".json" && exportRows.length > 0) {
      outputContent = toJson(exportRows);
      outputExtension = "json";
      outputContentType = "application/json; charset=utf-8";
    } else if (!binaryDownloadHandled) {
      outputContent = textFromRows || textOutput || summaryText;
      if (outputContent) {
        if (sourceExtension === ".md") {
          outputExtension = "md";
          outputContentType = "text/markdown; charset=utf-8";
        } else if (sourceExtension === ".txt") {
          outputExtension = "txt";
          outputContentType = "text/plain; charset=utf-8";
        } else if (sourceExtension === ".pdf" || sourceExtension === ".doc" || sourceExtension === ".docx") {
          outputContent = "";
          outputExtension = "";
          outputContentType = "";
          formatWarning = `源文件为 ${sourceExtension.slice(1)}。当前未收到可导出文件产物（artifacts），不会再降级导出 txt。请让 Python 返回 artifacts（base64）生成目标文件。`;
        } else {
          outputExtension = "txt";
          outputContentType = "text/plain; charset=utf-8";
        }
      }
    }

    if (!binaryDownloadHandled && outputContent && outputExtension) {
      const saved = await writeResultFile(sessionId, baseName, outputContent, outputExtension);
      const params = new URLSearchParams({
        sessionId,
        fileName: saved.fileName,
      });
      const localDownload = {
        fileName: saved.fileName,
        url: `/api/excel-sandbox/download?${params.toString()}`,
      };

      const persisted = await persistGenerationResult({
        fileType: sourceIsSpreadsheet ? "excel" : sourceFileType,
        generationMode: mode === "full" ? "final" : "draft",
        resultKind: outputResultKind,
        prompt: requirement || "多文件数据处理结果",
        provider: "python-sandbox",
        model: "local-python",
        content: outputContent,
        contentType: outputContentType,
        extension: outputExtension,
        metadata: {
          api: "/api/excel-sandbox/run",
          sessionId,
          targetFileId: targetFile.fileId,
          targetFileName: targetFile.fileName,
          sourceExtension,
          outputExtension: `.${outputExtension}`,
          sheetName: targetSheetName,
          mode,
        },
      });

      // 优先返回本地下载链路，避免公共存储权限/域名策略导致用户无法下载。
      download = localDownload;
      downloads = [localDownload];
      if (persisted.artifact?.downloadUrl) {
        savedArtifact = {
          id: persisted.artifact.id,
          downloadUrl: persisted.artifact.downloadUrl,
        };
      }
      saveWarning = mergeWarnings(formatWarning, persisted.warning);
    } else if (
      !binaryDownloadHandled &&
      summaryText &&
      sourceExtension !== ".pdf" &&
      sourceExtension !== ".doc" &&
      sourceExtension !== ".docx"
    ) {
      // 兜底：即使没有结构化 rows/textOutput，也输出 summary 文本文件，确保可下载。
      const saved = await writeResultFile(sessionId, baseName, summaryText, "txt");
      const params = new URLSearchParams({
        sessionId,
        fileName: saved.fileName,
      });
      download = {
        fileName: saved.fileName,
        url: `/api/excel-sandbox/download?${params.toString()}`,
      };
      downloads = [download];
      saveWarning = formatWarning;
    }

    if (!saveWarning && formatWarning) {
      saveWarning = formatWarning;
    }

    session.activeTarget = {
      fileId: targetFile.fileId,
      sheetName: targetSheetName,
    };
    targetFile.activeSheet = targetSheetName;
    session.lastSampling = sampling;
    session.updatedAt = new Date().toISOString();
    await saveSession(session);

    return jsonResponse({
      sessionId,
      mode,
      target: {
        fileId: targetFile.fileId,
        fileName: targetFile.fileName,
        sheetName: targetSheetName,
      },
      datasets: datasetInputs,
      sourceRowsCount: sourceRows.length,
      inputRowsCount: sampled.rows.length,
      usedSampling: mode === "sample" ? sampling : null,
      selectedHeaders: sampled.selectedHeaders,
      result: {
        summary: output.summary,
        textOutput: textOutput || undefined,
        previewRows: output.previewRows,
        totalOutputRows: output.totalOutputRows,
        truncated: output.truncated,
        chart: output.chart ?? null,
        metrics: output.metrics ?? null,
      },
      logs: pythonResult.logs || "",
      download,
      downloads,
      saveWarning,
      savedArtifact,
    });
  } catch (error) {
    console.error("Excel sandbox run error:", error);
    if (isSessionNotFoundError(error)) {
      const message =
        error instanceof Error ? error.message.replace(/^SESSION_NOT_FOUND:\s*/, "") : "会话已失效";
      return jsonResponse({ error: message }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "执行失败";
    return jsonResponse({ error: message }, { status: 500 });
  }
}
