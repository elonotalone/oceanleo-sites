import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

export const MEETING_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const MEETING_UPLOAD_EXTENSIONS = Object.freeze([
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "aac",
  "flac",
  "ogg",
  "wma",
  "amr",
] as const);
export const PAPER_FETCH_MAX_BYTES = 4 * 1024 * 1024;
export const PAPER_FETCH_MAX_TEXT = 40_000;

const DEFAULT_GATEWAY_BASE = "https://api.oceanleo.com";
const meetingUploadExtensions = new Set<string>(MEETING_UPLOAD_EXTENSIONS);

export type MeetingUploadValidation =
  | Readonly<{ ok: true; extension: string }>
  | Readonly<{ ok: false; status: 400 | 413 | 415; error: string }>;

export function validateMeetingUpload(
  file: Readonly<{ name: string; size: number }>,
): MeetingUploadValidation {
  if (file.size > MEETING_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "文件过大（上限 100MB）。",
    };
  }
  const extension = (file.name.split(".").pop() || "")
    .toLowerCase()
    .slice(0, 5);
  if (!meetingUploadExtensions.has(extension)) {
    return {
      ok: false,
      status: 415,
      error: `不支持的格式 .${extension}（支持 mp3 / m4a / wav / mp4 等音视频）。`,
    };
  }
  return { ok: true, extension };
}

function uploadFile(value: FormDataEntryValue | null): value is File {
  return (
    value instanceof Blob &&
    typeof (value as Partial<File>).name === "string" &&
    typeof value.arrayBuffer === "function"
  );
}

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
    // Fall through to the production gateway.
  }
  return DEFAULT_GATEWAY_BASE;
}

function incomingBearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(authorization) ? authorization : null;
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
    throw new Error("网络错误：无法连接到 AI 网关。");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { detail?: unknown }).detail === "string"
        ? String((payload as { detail: string }).detail)
        : `网关请求失败（HTTP ${response.status}）`;
    throw new Error(detail);
  }
  return payload as T;
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
    site_id: "meeting",
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
  if (!path) throw new Error("无法创建上传凭证。");
  if (initialized.upload_complete !== true) {
    const signedUrl = clean(initialized.signed_url);
    if (!signedUrl.startsWith("https://")) {
      throw new Error("对象存储未返回安全上传地址。");
    }
    const uploaded = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "x-upsert": "false",
      },
      body: input.blob,
    });
    if (!uploaded.ok) {
      throw new Error(`上传失败（HTTP ${uploaded.status}）。`);
    }
  }

  const finalized = await gatewayJsonPost<{
    file?: Readonly<{ url?: unknown }>;
  }>("/v1/media/upload/finalize", { ...common, path }, input.authorization);
  const url = clean(finalized.file?.url);
  if (!url) throw new Error("上传完成但未返回文件地址。");
  return url;
}

export const meetingUploadHandler: PluginRouteHandler = async ({ request }) => {
  const authorization = incomingBearerAuthorization(request);
  if (!authorization) {
    return {
      kind: "response",
      response: Response.json(
        { error: "请先登录 OceanLeo 账号后再上传。" },
        { status: 401 },
      ),
    };
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file") ?? null;
  if (!uploadFile(file)) {
    return {
      kind: "response",
      response: Response.json({ error: "缺少文件。" }, { status: 400 }),
    };
  }

  const validation = validateMeetingUpload(file);
  if (!validation.ok) {
    return {
      kind: "response",
      response: Response.json(
        { error: validation.error },
        { status: validation.status },
      ),
    };
  }

  try {
    const url = await directGatewayUpload({
      authorization,
      blob: file,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    });
    return {
      kind: "response",
      response: Response.json({ url }),
    };
  } catch (error) {
    return {
      kind: "response",
      response: Response.json(
        {
          error:
            error instanceof Error ? error.message : "上传失败。",
        },
        { status: 502 },
      ),
    };
  }
};

export function paperHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi,
    "\n",
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function paperTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? paperHtmlToText(match[1] ?? "").slice(0, 200) : "";
}

async function readUpstreamBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = PAPER_FETCH_MAX_BYTES - received;
    if (remaining <= 0) break;
    chunks.push(value.byteLength > remaining ? value.slice(0, remaining) : value);
    received += Math.min(value.byteLength, remaining);
    if (received >= PAPER_FETCH_MAX_BYTES) break;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const paperFetchUrlHandler: PluginRouteHandler = async ({ request }) => {
  let requestedUrl = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    requestedUrl = String(body?.url || "").trim();
  } catch {
    return {
      kind: "response",
      response: Response.json(
        { error: "请求格式错误。" },
        { status: 400 },
      ),
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(requestedUrl);
  } catch {
    return {
      kind: "response",
      response: Response.json({ error: "无效的网址。" }, { status: 400 }),
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      kind: "response",
      response: Response.json(
        { error: "仅支持 http(s) 网址。" },
        { status: 400 },
      ),
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; OceanLeoPaper/1.0; +https://paper.oceanleo.com)",
      },
    });
  } catch {
    return {
      kind: "response",
      response: Response.json(
        { error: "无法访问该网址。" },
        { status: 502 },
      ),
    };
  }
  if (!upstream.ok) {
    return {
      kind: "response",
      response: Response.json(
        { error: `抓取失败（HTTP ${upstream.status}）。` },
        { status: 502 },
      ),
    };
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) {
    return {
      kind: "response",
      response: Response.json(
        { error: "该网址不是网页（可能是文件/图片），请直接粘贴文本。" },
        { status: 415 },
      ),
    };
  }

  const html = await readUpstreamBody(upstream.body);
  const title = paperTitle(html);
  const text = paperHtmlToText(html).slice(0, PAPER_FETCH_MAX_TEXT);
  if (text.length < 200) {
    return {
      kind: "response",
      response: Response.json({
        title,
        text,
        warning:
          "抓到的正文很短，该页面可能依赖 JavaScript 渲染。建议直接复制网页文本粘贴进来。",
      }),
    };
  }
  return {
    kind: "response",
    response: Response.json({ title, text }),
  };
};
