import path from "path";

import { binaryResponse, jsonResponse } from "./http";
import { readResultFile } from "./session-store";

function resolveContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".tsv") return "text/tab-separated-values; charset=utf-8";
  return "text/csv; charset=utf-8";
}

export async function handleExcelSandboxDownload(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    const fileName = url.searchParams.get("fileName")?.trim() || "";
    if (!sessionId || !fileName) {
      return jsonResponse({ error: "缺少 sessionId 或 fileName" }, { status: 400 });
    }

    const fileBuffer = await readResultFile(sessionId, fileName);
    return binaryResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": resolveContentType(fileName),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载失败";
    return jsonResponse({ error: message }, { status: 404 });
  }
}
