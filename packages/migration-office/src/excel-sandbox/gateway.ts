// Server-side OceanLeo gateway client for the Excel sandbox.
//
// The Excel API routes (run / generate-code) run in the Node.js runtime and
// forward the END USER's bearer token to api.oceanleo.com. We deliberately do
// NOT hold any provider key here — all AI + Python execution is brokered by the
// gateway under the user's platform credits (key_mode: "platform").

import type { PythonExecutionMode, PythonExecutionOutput } from "./types";

export const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  process.env.OCEANLEO_GATEWAY_URL ||
  "https://api.oceanleo.com";

const EXCEL_RUN_TIMEOUT_MS = 140_000;
const CHAT_TIMEOUT_MS = 90_000;

export class GatewayAuthError extends Error {
  constructor(message = "未登录或登录已过期，请重新登录后再试。") {
    super(message);
    this.name = "GatewayAuthError";
  }
}

export class GatewayError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

/**
 * Pull the bearer token out of an incoming request's Authorization header.
 * Returns the raw token (without the "Bearer " prefix) or null.
 */
export function extractBearerToken(header: string | null | undefined): string | null {
  const raw = String(header || "").trim();
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();
  // Some clients send the raw token; accept it as a fallback.
  return raw;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown; error?: unknown; message?: unknown };
    const detail =
      (typeof data?.detail === "string" && data.detail) ||
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      "";
    return detail || `网关返回 HTTP ${res.status}`;
  } catch {
    return `网关返回 HTTP ${res.status}`;
  }
}

interface GatewayChatInput {
  token: string;
  siteId?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens?: number;
}

/**
 * Call the gateway /v1/chat endpoint (platform key mode). Returns the model's
 * text response. Throws GatewayAuthError on 401 and GatewayError otherwise.
 */
export async function gatewayChat(input: GatewayChatInput): Promise<string> {
  if (!input.token) throw new GatewayAuthError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      site_id: input.siteId || "excel",
      key_mode: "platform",
      messages: input.messages,
    };
    if (input.system) body.system = input.system;
    if (input.maxTokens) body.max_tokens = input.maxTokens;

    const res = await fetch(`${GATEWAY_BASE}/v1/chat`, {
      method: "POST",
      headers: authHeaders(input.token),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) throw new GatewayAuthError();
    if (!res.ok) throw new GatewayError(await readErrorMessage(res), res.status);

    const data = (await res.json()) as { text?: unknown };
    return typeof data?.text === "string" ? data.text.trim() : "";
  } catch (error) {
    if (error instanceof GatewayAuthError || error instanceof GatewayError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayError("AI 生成超时，请稍后重试。", 504);
    }
    throw new GatewayError(
      `调用 AI 网关失败：${error instanceof Error ? error.message : "unknown"}`,
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export interface GatewayExcelRunInput {
  token: string;
  pythonCode: string;
  rows: Record<string, unknown>[];
  files?: Array<Record<string, unknown>>;
  mode: PythonExecutionMode;
  context: Record<string, unknown>;
  timeoutMs?: number;
}

export interface GatewayExcelRunResponse {
  ok: boolean;
  result?: PythonExecutionOutput;
  logs?: string;
  error?: string;
  traceback?: string;
  credits_spent?: number;
}

/**
 * Call the gateway /v1/excel/run sandbox endpoint. The gateway returns
 * { ok, result:{...}, logs, credits_spent }; we surface that shape directly so
 * the existing run route can keep parsing `result.*`.
 */
export async function gatewayExcelRun(
  input: GatewayExcelRunInput
): Promise<GatewayExcelRunResponse> {
  if (!input.token) throw new GatewayAuthError();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? EXCEL_RUN_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/excel/run`, {
      method: "POST",
      headers: authHeaders(input.token),
      body: JSON.stringify({
        site_id: "excel",
        key_mode: "platform",
        pythonCode: input.pythonCode,
        rows: input.rows,
        files: Array.isArray(input.files) ? input.files : [],
        mode: input.mode,
        context: input.context,
      }),
      signal: controller.signal,
    });

    if (res.status === 401) throw new GatewayAuthError();

    const data = (await res.json().catch(() => null)) as GatewayExcelRunResponse | null;
    if (!res.ok) {
      return {
        ok: false,
        error: String(data?.error || "").trim() || `沙箱执行失败（HTTP ${res.status}）`,
        traceback: String(data?.traceback || ""),
        logs: String(data?.logs || ""),
      };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "沙箱返回格式异常" };
    }
    if (!data.ok && !data.error) {
      data.error = "沙箱执行失败";
    }
    return data;
  } catch (error) {
    if (error instanceof GatewayAuthError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "沙箱执行超时，请稍后重试。" };
    }
    return {
      ok: false,
      error: `沙箱调用失败：${error instanceof Error ? error.message : "unknown"}`,
      traceback: error instanceof Error ? String(error.stack || "") : "",
    };
  } finally {
    clearTimeout(timeout);
  }
}
