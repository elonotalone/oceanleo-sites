import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  directGatewayUpload,
  gatewayJsonPost,
  incomingBearerAuthorization,
  MediaGatewayError,
  readBoundedBlob,
  resolveGatewayBase,
} from "./gateway";

const SITE_ID = "video";
const COMPOSE_MAX_CLIP_BYTES = 128 * 1024 * 1024;
const COMPOSE_MAX_INPUT_BYTES = 512 * 1024 * 1024;
const COMPOSE_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

type CanvasAction =
  | "generate_text"
  | "generate_script"
  | "generate_image"
  | "generate_video"
  | "generation_status"
  | "final_render";

interface CanvasRequestBody {
  readonly action?: CanvasAction;
  readonly payload?: unknown;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}

function requireAuthorization(value: string | null): string {
  if (!value) {
    throw new MediaGatewayError(
      "请先登录 OceanLeo 账号后再运行节点。",
      401,
    );
  }
  return value;
}

function ok<T>(data: T): Response {
  return Response.json({ ok: true, data });
}

function fail(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}

async function runChat(
  payload: Record<string, unknown>,
  authorization: string | null,
  defaultSystem: string,
) {
  const prompt = clean(payload.prompt);
  if (!prompt) throw new Error("请先填写节点内容。");
  const data = await gatewayJsonPost<{ readonly text?: unknown }>(
    "/v1/chat",
    {
      site_id: SITE_ID,
      key_mode: "platform",
      model: clean(payload.model) || undefined,
      system: clean(payload.system) || defaultSystem,
      messages: [{ role: "user", content: prompt }],
      max_tokens: toPositiveInt(payload.maxTokens, 2000),
    },
    requireAuthorization(authorization),
  );
  return { text: clean(data.text) };
}

const SCRIPT_SYSTEM =
  "你是资深短视频导演与分镜师，精通把一个主题拆成节奏合理、可直接用 AI 文生视频" +
  "逐段生成的分镜序列。每个分镜写清画面主体、环境、镜头运动、光线氛围、风格。" +
  "输出条理清晰的分镜脚本（可用「分镜 N：…」格式列出每段画面与时长建议）。";

async function runImage(
  payload: Record<string, unknown>,
  authorization: string | null,
) {
  const prompt = clean(payload.prompt);
  if (!prompt) throw new Error("请先填写画面描述。");
  const quality = clean(payload.quality);
  const data = await gatewayJsonPost<{
    readonly images?: readonly unknown[];
  }>(
    "/v1/images/generate",
    {
      site_id: SITE_ID,
      key_mode: "platform",
      prompt,
      ratio: clean(payload.ratio) || "16:9",
      model: clean(payload.model) || undefined,
      sharpness: quality === "1K" || quality === "4K" ? quality : "2K",
      n: 1,
    },
    requireAuthorization(authorization),
  );
  const images = Array.isArray(data.images)
    ? data.images.map(clean).filter(Boolean)
    : [];
  if (images.length === 0) throw new Error("图片生成未返回结果，请重试。");
  return { images };
}

async function runVideo(
  payload: Record<string, unknown>,
  authorization: string | null,
) {
  const prompt = clean(payload.prompt);
  const imageUrl = clean(payload.imageUrl);
  if (!prompt && !imageUrl) {
    throw new Error("请填写视频提示词或连入首帧图片。");
  }
  const quality = clean(payload.quality);
  const data = await gatewayJsonPost<{
    readonly task_id?: unknown;
    readonly status?: unknown;
  }>(
    "/v1/videos/generate",
    {
      site_id: SITE_ID,
      key_mode: "platform",
      prompt,
      image_url: imageUrl || null,
      ratio: clean(payload.ratio) || "16:9",
      model: clean(payload.model) || undefined,
      sharpness: quality === "1K" || quality === "4K" ? quality : "2K",
      duration: payload.duration
        ? toPositiveInt(payload.duration, 5)
        : undefined,
    },
    requireAuthorization(authorization),
  );
  const taskId = clean(data.task_id);
  if (!taskId) throw new Error("视频任务提交失败，请重试。");
  return { taskId, status: clean(data.status) || "PENDING" };
}

async function videoStatus(
  payload: Record<string, unknown>,
  authorization: string | null,
) {
  const taskId = clean(payload.taskId);
  if (!taskId) throw new Error("缺少视频任务 ID。");
  const data = await gatewayJsonPost<{
    readonly status?: unknown;
    readonly videos?: readonly unknown[];
    readonly error?: unknown;
  }>(
    `/v1/videos/status/${encodeURIComponent(taskId)}`,
    { key_mode: "platform" },
    requireAuthorization(authorization),
  );
  return {
    status: clean(data.status) || "UNKNOWN",
    videos: Array.isArray(data.videos)
      ? data.videos.map(clean).filter(Boolean)
      : [],
    error: clean(data.error),
  };
}

async function fetchClipBlob(
  sourceUrl: string,
  authorization: string,
): Promise<Readonly<{ blob: Blob; filename: string }>> {
  const proxyUrl = new URL("/v1/media/proxy", resolveGatewayBase());
  proxyUrl.searchParams.set("url", sourceUrl);
  let response: Response;
  try {
    response = await fetch(proxyUrl, {
      method: "GET",
      headers: { Authorization: authorization },
      cache: "no-store",
    });
  } catch {
    throw new Error("网络错误：无法拉取视频片段。");
  }
  if (!response.ok) {
    throw new Error(
      `拉取片段失败（HTTP ${response.status}）：${sourceUrl}`,
    );
  }
  const blob = await readBoundedBlob(
    response,
    COMPOSE_MAX_CLIP_BYTES,
    "视频片段",
  );
  let filename = "clip.mp4";
  try {
    const candidate = new URL(sourceUrl).pathname.split("/").pop();
    if (candidate && /\.(mp4|webm|mov)$/i.test(candidate)) {
      filename = candidate;
    }
  } catch {
    // The gateway proxy performs the authoritative URL validation.
  }
  return { blob, filename };
}

async function persistComposedVideo(
  blob: Blob,
  authorization: string,
): Promise<string> {
  return directGatewayUpload({
    authorization,
    blob,
    filename: `节点画布合成-${Date.now()}.mp4`,
    contentType: "video/mp4",
    siteId: SITE_ID,
    title: "节点画布合成",
    registerAsset: true,
  });
}

async function compose(
  payload: Record<string, unknown>,
  authorizationValue: string | null,
) {
  const authorization = requireAuthorization(authorizationValue);
  const videoUrls = Array.isArray(payload.videoUrls)
    ? payload.videoUrls.map(clean).filter(Boolean)
    : [];
  if (videoUrls.length < 1) {
    throw new Error("请至少连入 1 个已生成的视频片段。");
  }
  if (videoUrls.length > 12) {
    throw new Error("最多支持合成 12 个片段。");
  }

  const form = new FormData();
  let totalInputBytes = 0;
  for (const sourceUrl of videoUrls) {
    const { blob, filename } = await fetchClipBlob(
      sourceUrl,
      authorization,
    );
    totalInputBytes += blob.size;
    if (totalInputBytes > COMPOSE_MAX_INPUT_BYTES) {
      throw new Error("合成素材总大小超过 512 MB。");
    }
    form.append("clips", blob, filename);
  }

  const subtitleText = clean(payload.subtitleText);
  if (subtitleText) {
    form.append(
      "subtitles",
      new Blob([subtitleText], { type: "application/x-subrip" }),
      "subtitles.srt",
    );
  }
  const bgmUrl = clean(payload.bgmUrl);
  if (bgmUrl) {
    const { blob } = await fetchClipBlob(bgmUrl, authorization);
    totalInputBytes += blob.size;
    if (totalInputBytes > COMPOSE_MAX_INPUT_BYTES) {
      throw new Error("合成素材总大小超过 512 MB。");
    }
    form.append("bgm", blob, "bgm.mp3");
    const bgmVolume = Number(payload.bgmVolume);
    form.append(
      "bgm_volume",
      String(Number.isFinite(bgmVolume) ? bgmVolume : 0.3),
    );
  }
  form.append("key_mode", "platform");

  let response: Response;
  try {
    response = await fetch(`${resolveGatewayBase()}/v1/convert/compose`, {
      method: "POST",
      headers: { Authorization: authorization },
      body: form,
    });
  } catch {
    throw new Error("网络错误：无法连接到合成服务。");
  }
  if (!response.ok) {
    let detail = `合成失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as {
        readonly detail?: unknown;
      };
      detail = clean(payload.detail) || detail;
    } catch {
      // Preserve the HTTP fallback for non-JSON failures.
    }
    throw new Error(detail);
  }

  const output = await readBoundedBlob(
    response,
    COMPOSE_MAX_OUTPUT_BYTES,
    "合成结果",
  );
  const videoUrl = await persistComposedVideo(output, authorization);
  return { videoUrl, persisted: true };
}

function requestPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const videoCanvasHandler: PluginRouteHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as CanvasRequestBody;
    const action = body.action;
    const payload = requestPayload(body.payload);
    const authorization = incomingBearerAuthorization(request);

    if (!action) {
      return { kind: "response", response: fail("缺少 action。") };
    }

    let data: unknown;
    switch (action) {
      case "generate_text":
        data = await runChat(
          payload,
          authorization,
          "你是有帮助的中文写作助手，输出简洁可用的内容。",
        );
        break;
      case "generate_script":
        data = await runChat(payload, authorization, SCRIPT_SYSTEM);
        break;
      case "generate_image":
        data = await runImage(payload, authorization);
        break;
      case "generate_video":
        data = await runVideo(payload, authorization);
        break;
      case "generation_status":
        data = await videoStatus(payload, authorization);
        break;
      case "final_render":
        data = await compose(payload, authorization);
        break;
      default:
        return { kind: "response", response: fail("不支持的 action。") };
    }
    return { kind: "response", response: ok(data) };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "画布节点执行失败。";
    return { kind: "response", response: fail(message, 500) };
  }
};
