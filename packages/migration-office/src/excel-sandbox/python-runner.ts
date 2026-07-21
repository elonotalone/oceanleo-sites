// Python sandbox runner — LeoSheet edition.
//
// In generator this module spawned a local python3 / hit a private aliyun
// sandbox. In LeoSheet ALL execution is brokered by the OceanLeo gateway
// (api.oceanleo.com /v1/excel/run) under the signed-in user's platform credits.
// We therefore forward the user's bearer token (extracted from the API route's
// Authorization header) and surface the gateway's { ok, result, logs } shape.

import {
  GatewayAuthError,
  gatewayExcelRun,
} from "./gateway";
import type { PythonExecutionMode, PythonExecutionOutput } from "./types";

interface RunPythonSandboxInput {
  token: string | null;
  rows: Record<string, unknown>[];
  files?: Array<Record<string, unknown>>;
  pythonCode: string;
  mode: PythonExecutionMode;
  context: Record<string, unknown>;
  timeoutMs?: number;
}

interface PythonRunnerResponse {
  ok: boolean;
  result?: PythonExecutionOutput;
  logs?: string;
  error?: string;
  traceback?: string;
  credits_spent?: number;
  /** set when the failure is an auth problem so the route can return 401 */
  authError?: boolean;
}

export async function runPythonSandbox(
  input: RunPythonSandboxInput
): Promise<PythonRunnerResponse> {
  if (!input.token) {
    return {
      ok: false,
      error: "未登录或登录已过期，请重新登录后再试。",
      authError: true,
    };
  }

  try {
    const remote = await gatewayExcelRun({
      token: input.token,
      pythonCode: input.pythonCode,
      rows: input.rows,
      files: Array.isArray(input.files) ? input.files : [],
      mode: input.mode,
      context: input.context,
      timeoutMs: input.timeoutMs,
    });
    return {
      ok: remote.ok,
      result: remote.result,
      logs: remote.logs,
      error: remote.error,
      traceback: remote.traceback,
      credits_spent: remote.credits_spent,
    };
  } catch (error) {
    if (error instanceof GatewayAuthError) {
      return { ok: false, error: error.message, authError: true };
    }
    return {
      ok: false,
      error: `远程沙箱调用失败：${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}
