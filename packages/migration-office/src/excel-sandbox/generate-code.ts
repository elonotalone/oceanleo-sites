import { generatePythonPlan } from "./assistant";
import { jsonResponse } from "./http";
import { extractBearerToken, GatewayAuthError } from "./gateway";
import {
  isSessionNotFoundError,
  loadSession,
  saveSession,
} from "./session-store";
import type {
  SamplingConfig,
  SheetProfile,
  UploadedDataFileRecord,
} from "./types";
import {
  buildSheetProfileFromRows,
  readRowsFromStoredFile,
} from "./workbook";


type GenerateCodeBody = {
  sessionId?: string;
  requirement?: string;
  answers?: string;
  targetFileId?: string;
  sheetName?: string;
  selectedFileIds?: string[];
  sampling?: Partial<SamplingConfig> | null;
};

function resolveTargetFile(
  files: UploadedDataFileRecord[],
  preferredFileId: string
): UploadedDataFileRecord {
  if (preferredFileId) {
    const matched = files.find((file) => file.fileId === preferredFileId);
    if (matched) return matched;
  }
  return files[0];
}

async function resolveProfile(
  file: UploadedDataFileRecord,
  preferredSheetName: string
): Promise<{ sheetName: string; profile: SheetProfile }> {
  const existing =
    preferredSheetName && file.profiles[preferredSheetName]
      ? file.profiles[preferredSheetName]
      : file.profiles[file.activeSheet];
  if (existing) {
    return {
      sheetName: existing.sheetName,
      profile: existing,
    };
  }

  const loaded = await readRowsFromStoredFile(file.filePath, file.extension, preferredSheetName);
  const profile = buildSheetProfileFromRows(loaded.sheetName, loaded.rows);
  return {
    sheetName: loaded.sheetName,
    profile,
  };
}

export async function handleExcelSandboxGenerateCode(request: Request): Promise<Response> {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) {
      return jsonResponse(
        { error: "未登录或登录已过期，请重新登录后再试。" },
        { status: 401 }
      );
    }
    const body = (await request.json()) as GenerateCodeBody;
    const sessionId = String(body.sessionId ?? "").trim();
    const requirement = String(body.requirement ?? "").trim();
    const answers = String(body.answers ?? "").trim();
    if (!sessionId) {
      return jsonResponse({ error: "缺少 sessionId" }, { status: 400 });
    }
    if (!requirement) {
      return jsonResponse({ error: "请先填写你的处理需求。" }, { status: 400 });
    }

    const session = await loadSession(sessionId);
    if (!Array.isArray(session.files) || session.files.length === 0) {
      return jsonResponse({ error: "会话中没有可用文件。" }, { status: 400 });
    }

    const selectedFile = resolveTargetFile(session.files, String(body.targetFileId ?? "").trim());
    const preferredSheet = String(body.sheetName ?? "").trim() || selectedFile.activeSheet;
    const resolvedTarget = await resolveProfile(selectedFile, preferredSheet);
    const requestedSampling =
      body.sampling && typeof body.sampling === "object" ? body.sampling : null;
    const selectedFileIds = Array.isArray(body.selectedFileIds)
      ? body.selectedFileIds
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
    const selectedFileSet = new Set(selectedFileIds);
    const candidateFiles = session.files.filter(
      (file) => selectedFileSet.size === 0 || selectedFileSet.has(file.fileId) || file.fileId === selectedFile.fileId
    );
    if (candidateFiles.length === 0) {
      return jsonResponse({ error: "项目中未选择可用文件，请先添加文件。" }, { status: 400 });
    }

    const filesForAssistant = await Promise.all(
      candidateFiles.map(async (file) => {
        const preferred =
          file.fileId === selectedFile.fileId ? resolvedTarget.sheetName : file.activeSheet;
        const resolved = await resolveProfile(file, preferred);
        file.profiles[resolved.sheetName] = resolved.profile;
        return {
          fileId: file.fileId,
          fileName: file.fileName,
          extension: file.extension,
          sizeBytes: file.sizeBytes,
          analysisMeta: file.analysisMeta,
          sheetName: resolved.sheetName,
          profile: resolved.profile,
        };
      })
    );

    const plan = await generatePythonPlan({
      token,
      requirement,
      answers,
      sampling: requestedSampling,
      targetFileId: selectedFile.fileId,
      targetFileName: selectedFile.fileName,
      targetSheetName: resolvedTarget.sheetName,
      files: filesForAssistant,
    });

    selectedFile.activeSheet = resolvedTarget.sheetName;
    selectedFile.profiles[resolvedTarget.sheetName] = resolvedTarget.profile;
    session.activeTarget = {
      fileId: selectedFile.fileId,
      sheetName: resolvedTarget.sheetName,
    };
    session.updatedAt = new Date().toISOString();
    session.lastSampling = plan.suggestedSampling;
    await saveSession(session);

    return jsonResponse({
      sessionId,
      activeTarget: session.activeTarget,
      profile: resolvedTarget.profile,
      generated: {
        decision: plan.decision,
        directAnswer: plan.directAnswer,
        pythonCode: plan.pythonCode,
        notes: plan.notes,
        followUpQuestions: plan.followUpQuestions,
        suggestedSampling: plan.suggestedSampling,
        usedProvider: plan.usedProvider,
        usedModel: plan.usedModel,
      },
    });
  } catch (error) {
    console.error("Excel sandbox generate-code error:", error);
    if (error instanceof GatewayAuthError) {
      return jsonResponse({ error: error.message }, { status: 401 });
    }
    if (isSessionNotFoundError(error)) {
      const message =
        error instanceof Error ? error.message.replace(/^SESSION_NOT_FOUND:\s*/, "") : "会话已失效";
      return jsonResponse({ error: message }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "代码生成失败";
    return jsonResponse({ error: message }, { status: 500 });
  }
}
