import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

const DEFAULT_GATEWAY_BASE = "https://api.oceanleo.com";
const IMAGE_PROXY_MAX_BYTES = 20 * 1024 * 1024;

export interface GatewayEnvironment {
  readonly NEXT_PUBLIC_OCEANLEO_GATEWAY_URL?: string;
}

export interface UploadContract {
  readonly siteId: string;
  readonly mediaKind: "image" | "video";
  readonly maxBytes: number;
  readonly maxBytesLabel: string;
  readonly registerAsset: boolean;
  readonly title?: string;
}

export interface UploadMetadata {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface UploadValidationError {
  readonly status: 400 | 413 | 415;
  readonly error: string;
}

interface DirectUploadInput {
  readonly authorization: string;
  readonly blob: Blob;
  readonly filename: string;
  readonly contentType: string;
  readonly siteId: string;
  readonly title: string;
  readonly registerAsset: boolean;
}

interface DirectUploadInitResult {
  readonly path?: unknown;
  readonly signed_url?: unknown;
  readonly upload_complete?: unknown;
  readonly already_finalized?: unknown;
  readonly file?: Readonly<{ readonly url?: unknown }>;
}

interface DirectUploadFinalizeResult {
  readonly file?: Readonly<{ readonly url?: unknown }>;
}

export class MediaGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MediaGatewayError";
  }
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function resolveGatewayBase(
  environment: GatewayEnvironment = process.env,
): string {
  const configured = clean(environment.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL);
  if (!configured) return DEFAULT_GATEWAY_BASE;
  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.pathname === "/" || parsed.pathname === "")
    ) {
      return parsed.origin;
    }
  } catch {
    // Invalid configuration fails closed to the production gateway.
  }
  return DEFAULT_GATEWAY_BASE;
}

export function incomingBearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(authorization) ? authorization : null;
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseDetail(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const detail = clean(record.detail || record.error);
    if (detail) return detail;
  }
  return fallback;
}

export async function gatewayJsonPost<T>(
  path: `/${string}`,
  body: unknown,
  authorization: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${resolveGatewayBase()}${path}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new MediaGatewayError("网络错误：无法连接到 AI 网关。", 502);
  }
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new MediaGatewayError(
      responseDetail(payload, `网关请求失败（HTTP ${response.status}）`),
      response.status,
    );
  }
  return payload as T;
}

export async function readBoundedBlob(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Blob> {
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared && declared > maxBytes) {
    await response.body?.cancel();
    throw new MediaGatewayError(`${label}过大。`, 413);
  }
  if (!response.body) {
    throw new MediaGatewayError(`${label}响应为空。`, 502);
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MediaGatewayError(`${label}过大。`, 413);
      }
      const copy = new ArrayBuffer(value.byteLength);
      new Uint8Array(copy).set(value);
      chunks.push(copy);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

function safeSignedUploadUrl(value: unknown): string {
  const candidate = clean(value);
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password
    ) {
      return parsed.toString();
    }
  } catch {
    // Handled by the explicit error below.
  }
  throw new MediaGatewayError("对象存储未返回安全上传地址。", 502);
}

export async function directGatewayUpload(
  input: DirectUploadInput,
): Promise<string> {
  const common = {
    filename: input.filename,
    content_type: input.contentType,
    bytes: input.blob.size,
    site_id: input.siteId,
    title: input.title,
    register_asset: input.registerAsset,
  };
  const initialized = await gatewayJsonPost<DirectUploadInitResult>(
    "/v1/media/upload/init",
    common,
    input.authorization,
  );
  const finalizedUrl = clean(initialized.file?.url);
  if (initialized.already_finalized === true && finalizedUrl) {
    return finalizedUrl;
  }

  const path = clean(initialized.path);
  if (!path) {
    throw new MediaGatewayError("无法创建上传凭证。", 502);
  }
  if (initialized.upload_complete !== true) {
    const signedUrl = safeSignedUploadUrl(initialized.signed_url);
    let uploaded: Response;
    try {
      uploaded = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": input.contentType,
          "x-upsert": "false",
        },
        body: input.blob,
      });
    } catch {
      throw new MediaGatewayError("网络错误：无法上传到对象存储。", 502);
    }
    if (!uploaded.ok) {
      throw new MediaGatewayError(
        `上传失败（HTTP ${uploaded.status}）。`,
        502,
      );
    }
  }

  const finalized = await gatewayJsonPost<DirectUploadFinalizeResult>(
    "/v1/media/upload/finalize",
    { ...common, path },
    input.authorization,
  );
  const url = clean(finalized.file?.url);
  if (!url) {
    throw new MediaGatewayError("上传完成但未返回文件地址。", 502);
  }
  return url;
}

export function validateUploadMetadata(
  file: UploadMetadata,
  contract: UploadContract,
): UploadValidationError | null {
  if (file.size <= 0) return { status: 400, error: "文件为空。" };
  if (file.size > contract.maxBytes) {
    return {
      status: 413,
      error: `文件过大（上限 ${contract.maxBytesLabel}）。`,
    };
  }
  const contentType = file.type.split(";", 1)[0]!.trim().toLowerCase();
  const valid =
    contract.mediaKind === "image"
      ? contentType.startsWith("image/") && contentType !== "image/svg+xml"
      : contentType === "video/mp4";
  if (!valid) {
    return {
      status: 415,
      error:
        contract.mediaKind === "image"
          ? "仅支持安全的图片文件。"
          : "仅支持 MP4 视频文件。",
    };
  }
  return null;
}

function gatewayFailure(error: unknown): Response {
  if (error instanceof MediaGatewayError) {
    const status =
      error.status >= 400 && error.status <= 599 ? error.status : 502;
    return jsonError(error.message, status);
  }
  return jsonError("上传失败。", 502);
}

export function createDirectUploadHandler(
  contract: UploadContract,
): PluginRouteHandler {
  return async ({ request }) => {
    const authorization = incomingBearerAuthorization(request);
    if (!authorization) {
      return {
        kind: "response",
        response: jsonError("请先登录 OceanLeo 账号后再上传。", 401),
      };
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return {
        kind: "response",
        response: jsonError("缺少文件。", 400),
      };
    }
    const validation = validateUploadMetadata(file, contract);
    if (validation) {
      return {
        kind: "response",
        response: jsonError(validation.error, validation.status),
      };
    }

    try {
      const url = await directGatewayUpload({
        authorization,
        blob: file,
        filename: file.name,
        contentType: file.type.split(";", 1)[0]!.trim().toLowerCase(),
        siteId: contract.siteId,
        title: contract.title ?? file.name,
        registerAsset: contract.registerAsset,
      });
      return {
        kind: "response",
        response: Response.json({ url }),
      };
    } catch (error) {
      return { kind: "response", response: gatewayFailure(error) };
    }
  };
}

function safeDownloadName(value: string): string {
  return (value || "logo.png").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
}

export function createFetchImageHandler(
  options: Readonly<{ readonly attachment: boolean }>,
): PluginRouteHandler {
  return async ({ request }) => {
    const requestUrl = new URL(request.url);
    const sourceUrl = requestUrl.searchParams.get("url") || "";
    if (!sourceUrl) {
      return {
        kind: "response",
        response: jsonError("无效的图片地址。", 400),
      };
    }
    const proxyUrl = new URL("/v1/media/proxy", resolveGatewayBase());
    proxyUrl.searchParams.set("url", sourceUrl);

    let upstream: Response;
    try {
      upstream = await fetch(proxyUrl, {
        method: "GET",
        cache: "no-store",
      });
    } catch {
      return {
        kind: "response",
        response: jsonError("拉取图片失败。", 502),
      };
    }
    if (!upstream.ok) {
      return {
        kind: "response",
        response: jsonError(
          `拉取图片失败（HTTP ${upstream.status}）。`,
          502,
        ),
      };
    }
    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      await upstream.body?.cancel();
      return {
        kind: "response",
        response: jsonError("目标不是图片。", 415),
      };
    }

    try {
      const blob = await readBoundedBlob(
        upstream,
        IMAGE_PROXY_MAX_BYTES,
        "图片",
      );
      const headers = new Headers({
        "Cache-Control": "private, max-age=300",
        "Content-Type": contentType,
      });
      if (options.attachment) {
        const name = safeDownloadName(
          requestUrl.searchParams.get("name") || "logo.png",
        );
        headers.set(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(name)}"`,
        );
      }
      return {
        kind: "response",
        response: new Response(blob, { headers }),
      };
    } catch (error) {
      if (error instanceof MediaGatewayError) {
        return {
          kind: "response",
          response: jsonError(error.message, error.status),
        };
      }
      return {
        kind: "response",
        response: jsonError("拉取图片失败。", 502),
      };
    }
  };
}
