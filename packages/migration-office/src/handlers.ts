import {
  CONVERTER_AUDIO_EXTENSIONS,
  CONVERTER_AUDIO_MAX_BYTES,
  WORD_DOCUMENT_EXTENSIONS,
} from "./contracts";

const PRIVATE_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Host",
  "X-Content-Type-Options": "nosniff",
});

function json(
  body: unknown,
  init: Readonly<{ status?: number; headers?: HeadersInit }> = {},
): Response {
  return Response.json(body, {
    status: init.status,
    headers: {
      ...PRIVATE_RESPONSE_HEADERS,
      ...init.headers,
    },
  });
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number"
  );
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
}

export async function handleWordDocumentUpload(
  request: Request,
): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadedFile(file)) {
      return json({ error: "请先上传文件。" }, { status: 400 });
    }

    const fileName = file.name.trim() || "uploaded";
    const extension = extensionOf(fileName);
    if (!WORD_DOCUMENT_EXTENSIONS.includes(extension)) {
      return json(
        { error: "仅支持 .doc/.docx/.txt/.md 文件。" },
        { status: 400 },
      );
    }

    if (extension === ".txt" || extension === ".md") {
      return json({
        fileName,
        extension,
        text: await file.text(),
        images: [],
      });
    }

    return json(
      {
        error:
          "DOC/DOCX structured extraction is not yet available in the shared office plugin.",
        code: "structured-document-parser-pending",
        fileName,
        extension,
      },
      { status: 501 },
    );
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "文件解析失败",
      },
      { status: 500 },
    );
  }
}

function isAllowedConverterAudio(
  purpose: FormDataEntryValue | null,
  file: File,
): boolean {
  if (purpose !== "asr") return false;
  if (!CONVERTER_AUDIO_EXTENSIONS.includes(extensionOf(file.name))) {
    return false;
  }
  const contentType = file.type.toLowerCase();
  return (
    !contentType ||
    contentType.startsWith("audio/") ||
    contentType === "application/octet-stream"
  );
}

const DEFAULT_GATEWAY_BASE = "https://api.oceanleo.com";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveGatewayBase(): string {
  const configured = clean(process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL);
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

function incomingBearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(authorization) ? authorization : null;
}

class ConverterGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConverterGatewayError";
  }
}

async function gatewayJsonPost<T>(
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
    throw new ConverterGatewayError("网络错误：无法连接到 AI 网关。", 502);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { detail?: unknown }).detail === "string"
        ? String((payload as { detail: string }).detail)
        : typeof payload === "object" &&
            payload !== null &&
            typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error: string }).error)
          : `网关请求失败（HTTP ${response.status}）`;
    throw new ConverterGatewayError(detail, response.status);
  }
  return payload as T;
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
    // Handled below.
  }
  throw new ConverterGatewayError("对象存储未返回安全上传地址。", 502);
}

async function directGatewayUpload(input: Readonly<{
  authorization: string;
  blob: Blob;
  filename: string;
  contentType: string;
}>): Promise<string> {
  const common = {
    filename: input.filename,
    content_type: input.contentType,
    bytes: input.blob.size,
    site_id: "converter",
    title: input.filename,
    register_asset: false,
  };
  const initialized = await gatewayJsonPost<{
    path?: unknown;
    signed_url?: unknown;
    upload_complete?: unknown;
    already_finalized?: unknown;
    file?: Readonly<{ url?: unknown }>;
  }>("/v1/media/upload/init", common, input.authorization);

  const finalizedUrl = clean(initialized.file?.url);
  if (initialized.already_finalized === true && finalizedUrl) {
    return finalizedUrl;
  }

  const path = clean(initialized.path);
  if (!path) {
    throw new ConverterGatewayError("无法创建上传凭证。", 502);
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
      throw new ConverterGatewayError("网络错误：无法上传到对象存储。", 502);
    }
    if (!uploaded.ok) {
      throw new ConverterGatewayError(
        `上传失败（HTTP ${uploaded.status}）。`,
        502,
      );
    }
  }

  const finalized = await gatewayJsonPost<{
    file?: Readonly<{ url?: unknown }>;
  }>("/v1/media/upload/finalize", { ...common, path }, input.authorization);
  const url = clean(finalized.file?.url);
  if (!url) {
    throw new ConverterGatewayError("上传完成但未返回文件地址。", 502);
  }
  return url;
}

export async function handleConverterAudioUpload(
  request: Request,
): Promise<Response> {
  const authorization = incomingBearerAuthorization(request);
  if (!authorization) {
    return json({ error: "请先登录 OceanLeo 账号后再上传。" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file") ?? null;
  const purpose = form?.get("purpose") ?? null;
  if (!isUploadedFile(file)) {
    return json({ error: "缺少文件。" }, { status: 400 });
  }
  if (!isAllowedConverterAudio(purpose, file)) {
    return json(
      { error: "该上传接口仅接受 ASR 音频；文档与图片只在浏览器本地处理。" },
      { status: 400 },
    );
  }
  if (file.size > CONVERTER_AUDIO_MAX_BYTES) {
    return json({ error: "文件过大（上限 50MB）。" }, { status: 413 });
  }

  try {
    const url = await directGatewayUpload({
      authorization,
      blob: file,
      filename: file.name.trim() || "audio.bin",
      contentType: file.type || "application/octet-stream",
    });
    return json({ url });
  } catch (error) {
    if (error instanceof ConverterGatewayError) {
      const status =
        error.status >= 400 && error.status <= 599 ? error.status : 502;
      return json({ error: error.message }, { status });
    }
    return json(
      {
        error: error instanceof Error ? error.message : "上传失败。",
      },
      { status: 502 },
    );
  }
}
