import { jsonResponse } from "./http";
import { isSessionNotFoundError, loadSession } from "./session-store";
import { formatFileSize } from "./workbook";

export async function handleExcelSandboxSession(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    if (!sessionId) {
      return jsonResponse({ error: "缺少 sessionId" }, { status: 400 });
    }

    const session = await loadSession(sessionId);
    if (!Array.isArray(session.files) || session.files.length === 0) {
      return jsonResponse({ error: "会话中没有可用文件。" }, { status: 400 });
    }

    const targetFile =
      session.files.find((file) => file.fileId === session.activeTarget?.fileId) ||
      session.files[0];
    const targetSheet =
      session.activeTarget?.sheetName &&
      targetFile.sheetNames.includes(session.activeTarget.sheetName)
        ? session.activeTarget.sheetName
        : targetFile.activeSheet;
    const profile = targetFile.profiles[targetSheet];
    if (!profile) {
      return jsonResponse(
        { error: "会话目标工作表信息缺失，请重新上传文件。" },
        { status: 400 },
      );
    }

    return jsonResponse({
      sessionId: session.sessionId,
      files: session.files.map((file) => ({
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
      })),
      activeTarget: {
        fileId: targetFile.fileId,
        sheetName: targetSheet,
      },
      profile,
    });
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      const message =
        error instanceof Error
          ? error.message.replace(/^SESSION_NOT_FOUND:\s*/, "")
          : "会话已失效";
      return jsonResponse({ error: message }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "会话加载失败";
    return jsonResponse({ error: message }, { status: 500 });
  }
}
