import { promises as fs } from "fs";
import path from "path";

import { binaryResponse, jsonResponse } from "./http";
import { isSessionNotFoundError, loadSession } from "./session-store";

function resolveSourceContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".tsv") return "text/tab-separated-values; charset=utf-8";
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

export async function handleExcelSandboxSource(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    const fileId = url.searchParams.get("fileId")?.trim() || "";
    if (!sessionId || !fileId) {
      return jsonResponse({ error: "缺少 sessionId 或 fileId" }, { status: 400 });
    }
    const session = await loadSession(sessionId);
    const file = session.files.find((item) => item.fileId === fileId);
    if (!file) {
      return jsonResponse({ error: "文件不存在或已失效" }, { status: 404 });
    }
    const fileBuffer = await fs.readFile(file.filePath);
    return binaryResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": resolveSourceContentType(file.fileName),
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      const message =
        error instanceof Error
          ? error.message.replace(/^SESSION_NOT_FOUND:\s*/, "")
          : "会话已失效";
      return jsonResponse({ error: message }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "读取源文件失败";
    return jsonResponse({ error: message }, { status: 500 });
  }
}
