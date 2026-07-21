import type { PluginRouteParams } from "@oceanleo/plugin-runtime";

export type PlatformFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TrialChatDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: PlatformFetch;
  readonly now?: () => number;
}

interface TrialTokenCache {
  readonly key: string;
  readonly token: string;
  readonly validUntil: number;
}

let trialTokenCache: TrialTokenCache | null = null;
const trialIpHits = new Map<string, { count: number; resetAt: number }>();

export function resetPlatformApiStateForTests(): void {
  trialTokenCache = null;
  trialIpHits.clear();
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function rateLimited(ip: string, now: number): boolean {
  const existing = trialIpHits.get(ip);
  if (!existing || now > existing.resetAt) {
    trialIpHits.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return false;
  }
  existing.count += 1;
  return existing.count > 6;
}

async function trialToken(
  environment: Readonly<Record<string, string | undefined>>,
  fetcher: PlatformFetch,
  now: number,
): Promise<string> {
  const supabaseUrl =
    environment.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL ??
    "https://kvrtcumcmhyqhmawpzyc.supabase.co";
  const anonKey = environment.NEXT_PUBLIC_OCEANLEO_ANON_KEY ?? "";
  const email = environment.TRIAL_CHAT_EMAIL ?? "";
  const password = environment.TRIAL_CHAT_PASSWORD ?? "";
  const cacheKey = `${supabaseUrl}\n${email}`;
  if (
    trialTokenCache?.key === cacheKey &&
    now < trialTokenCache.validUntil
  ) {
    return trialTokenCache.token;
  }

  const response = await fetcher(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) throw new Error("trial-auth-failed");
  const data = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("trial-token-missing");
  }
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 3_600;
  trialTokenCache = {
    key: cacheKey,
    token: data.access_token,
    validUntil: now + Math.max(expiresIn - 300, 60) * 1_000,
  };
  return data.access_token;
}

interface TrialMessage {
  readonly role: string;
  readonly content: string;
}

function validMessages(value: unknown): readonly TrialMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const messages = value.filter(
    (entry): entry is TrialMessage =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          typeof (entry as { role?: unknown }).role === "string" &&
          typeof (entry as { content?: unknown }).content === "string",
      ),
  );
  return messages.length === value.length ? messages : null;
}

export async function handleTrialChatRequest(
  request: Request,
  dependencies: TrialChatDependencies = {},
): Promise<Response> {
  const environment = dependencies.environment ?? process.env;
  const fetcher = dependencies.fetcher ?? fetch;
  const now = (dependencies.now ?? Date.now)();
  const anonKey = environment.NEXT_PUBLIC_OCEANLEO_ANON_KEY ?? "";
  const email = environment.TRIAL_CHAT_EMAIL ?? "";
  const password = environment.TRIAL_CHAT_PASSWORD ?? "";
  if (!anonKey || !email || !password) {
    return jsonError("试用通道未配置，请登录后使用。", 503);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (rateLimited(ip, now)) {
    return jsonError("试用次数已达上限，请登录 OceanLeo 账号继续。", 429);
  }

  const body = (await request.json().catch(() => null)) as {
    readonly model?: unknown;
    readonly system?: unknown;
    readonly messages?: unknown;
  } | null;
  const messages = validMessages(body?.messages);
  if (!messages) return jsonError("消息不能为空。", 400);

  let token: string;
  try {
    token = await trialToken(environment, fetcher, now);
  } catch {
    return jsonError("试用通道暂不可用，请登录后使用。", 502);
  }

  const gateway =
    environment.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL ??
    "https://api.oceanleo.com";
  let upstream: Response;
  try {
    upstream = await fetcher(`${gateway}/v1/chat/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        site_id: "chat",
        provider: "bailian",
        model:
          typeof body?.model === "string" && body.model.startsWith("qwen")
            ? body.model
            : "qwen-plus",
        system:
          typeof body?.system === "string" && body.system
            ? body.system
            : undefined,
        messages: messages.slice(-6),
        max_tokens: 1_024,
      }),
    });
  } catch {
    return jsonError("试用请求失败。", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const data = (await upstream.json().catch(() => null)) as {
      detail?: unknown;
    } | null;
    return jsonError(
      typeof data?.detail === "string" ? data.detail : "试用请求失败。",
      502,
    );
  }
  return new Response(upstream.body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}

const TWO_LABEL_SUFFIX = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "co.uk",
  "com.hk",
  "com.tw",
  "co.jp",
]);

function rootDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LABEL_SUFFIX.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

function hostFromParam(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    !/^[a-z0-9.-]+$/.test(hostname)
  ) {
    return null;
  }
  return hostname;
}

export async function handleFaviconProxyRequest(
  request: Request,
  fetcher: PlatformFetch = fetch,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const host = hostFromParam(sourceUrl.searchParams.get("domain") ?? "");
  if (host) {
    const root = rootDomain(host);
    const candidates = [
      `https://icons.duckduckgo.com/ip3/${root}.ico`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
      `https://${host}/favicon.ico`,
      `https://www.google.com/s2/favicons?sz=64&domain=${root}`,
    ];
    for (const candidate of candidates) {
      try {
        const response = await fetcher(candidate, {
          headers: { "User-Agent": "Mozilla/5.0 (aitools icon proxy)" },
          redirect: "follow",
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.startsWith("image/")) continue;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 4 * 1_024 * 1_024) continue;
        return new Response(bytes, {
          status: 200,
          headers: {
            "Cache-Control":
              "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
            "Content-Type": contentType,
          },
        });
      } catch {
        // Continue through the fixed public favicon candidate list.
      }
    }
  }
  return new Response("no icon", {
    status: 404,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

export const PLATFORM_ELEMENT_EFFECTS = Object.freeze([
  "aurora",
  "blobs",
  "beams",
  "mesh",
  "orbs",
  "waves",
  "neon-grid",
  "grid",
  "dots",
  "constellation",
  "shimmer",
  "rings",
  "spotlight",
  "noise",
  "confetti",
  "sparkle",
  "stripes",
] as const);

export const PLATFORM_TEMPLATE_SUBCATEGORIES = Object.freeze([
  "culture-media",
  "ad-design",
  "pr-consulting",
  "brand-planning",
  "gift-custom",
  "exhibition",
  "printing",
  "finance",
  "investment",
  "loan",
  "realestate",
  "registration",
  "accounting",
  "trademark",
  "law",
  "guarantee",
  "pawn",
  "womenswear",
  "menswear",
  "kidswear",
  "maternity",
  "shoes",
  "bags",
  "jewelry",
  "glasses",
  "watches",
  "hairsalon",
  "nails",
  "makeup",
  "slimming",
  "medical-beauty",
  "school",
  "training",
  "government",
  "association",
  "chamber",
  "web-build",
  "internet",
  "tech-company",
  "wedding",
  "bridal",
  "photography",
  "cleaning",
  "car-care",
  "photo-print",
  "moving",
  "pets",
  "flowers",
  "fastfood",
  "hotpot",
  "western",
  "japanese-korean",
  "bakery",
  "bbq",
  "farmstay",
  "resort",
  "hotel",
  "travel-agency",
  "local-tour",
  "visa",
  "chem-material",
  "textile",
  "rubber-plastic",
  "metallurgy",
  "recycling",
  "farming",
  "feed",
  "garden",
  "digital",
  "appliance",
  "phone",
  "furniture",
  "kitchenware",
  "decor",
  "bedding",
  "towel",
  "lighting",
  "fruit-veg",
  "snacks",
  "specialty",
  "tea",
  "baijiu",
  "wine",
  "hospital",
  "pharmacy",
  "dental",
  "handles",
  "windows",
  "bathroom",
  "machinery",
  "instruments",
  "firesafety",
  "electrical",
  "surveillance",
  "auto",
  "freight",
  "express",
  "house-rent",
  "car-rent",
  "export-trade",
  "enterprise",
  "mall",
  "personal",
  "landing",
  "others",
] as const);

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

const shortTemplateCategories = new Set<string>(
  [...PLATFORM_TEMPLATE_SUBCATEGORIES]
    .sort(
      (left, right) =>
        hashString(`${left}:cut`) - hashString(`${right}:cut`),
    )
    .slice(0, 25),
);

function templateCountForCategory(category: string): number {
  return shortTemplateCategories.has(category) ? 4 : 5;
}

export const PLATFORM_TEMPLATE_COUNT = PLATFORM_TEMPLATE_SUBCATEGORIES.reduce(
  (total, category) => total + templateCountForCategory(category),
  0,
);

function templateParts(
  slug: string,
): Readonly<{ category: string; variant: number }> | null {
  const match = /^([a-z][a-z0-9-]*?)-([1-9]\d*)$/.exec(slug);
  if (!match) return null;
  const category = match[1] ?? "";
  const variant = Number(match[2]);
  if (
    !PLATFORM_TEMPLATE_SUBCATEGORIES.includes(
      category as (typeof PLATFORM_TEMPLATE_SUBCATEGORIES)[number],
    ) ||
    variant > templateCountForCategory(category)
  ) {
    return null;
  }
  return { category, variant };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function standaloneDocument(input: Readonly<{
  title: string;
  subtitle: string;
  language: "zh" | "en";
  accent: string;
  compact?: boolean;
}>): string {
  const title = escapeHtml(input.title);
  const subtitle = escapeHtml(input.subtitle);
  return `<!doctype html>
<html lang="${input.language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root{color-scheme:dark;--accent:${input.accent}}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
    font-family:Inter,ui-sans-serif,system-ui;color:#f8fafc;background:
    radial-gradient(circle at 20% 20%,color-mix(in srgb,var(--accent) 58%,transparent),transparent 42%),
    radial-gradient(circle at 80% 75%,#2563eb66,transparent 40%),#0f172a}
    main{width:min(58rem,92vw);padding:${input.compact ? "2rem" : "clamp(2rem,8vw,7rem)"};
    border:1px solid #ffffff2e;border-radius:2rem;background:#0f172ab8;backdrop-filter:blur(18px)}
    p{color:#cbd5e1;line-height:1.8}small{color:#94a3b8}
  </style>
</head>
<body><main><small>LeoAsset · public-read</small><h1>${title}</h1><p>${subtitle}</p></main></body>
</html>`;
}

function stringParam(
  params: PluginRouteParams,
  key: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export function handleElementDocumentRequest(
  request: Request,
  params: PluginRouteParams,
): Response {
  const effect = stringParam(params, "fx");
  if (
    !PLATFORM_ELEMENT_EFFECTS.includes(
      effect as (typeof PLATFORM_ELEMENT_EFFECTS)[number],
    )
  ) {
    return new Response("Element not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "en" : "zh";
  const compact = url.searchParams.get("chrome") === "0";
  const palette = url.searchParams.get("palette") ?? "indigo";
  const accent = /^#[0-9a-f]{6}$/i.test(palette) ? palette : "#7c3aed";
  const html = standaloneDocument({
    title: language === "en" ? `${effect} effect` : `${effect} 风格元素`,
    subtitle:
      language === "en"
        ? "A self-contained, reusable visual effect document."
        : "可独立打开、分享与嵌入预览的自包含风格文档。",
    language,
    accent,
    compact,
  });
  return new Response(html, {
    status: 200,
    headers: {
      "Cache-Control":
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export function handleTemplateDocumentRequest(
  request: Request,
  params: PluginRouteParams,
): Response {
  const slug = stringParam(params, "slug");
  const parts = templateParts(slug);
  if (!parts) {
    return new Response("Template not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "en" : "zh";
  const download = url.searchParams.get("download") === "1";
  const html = standaloneDocument({
    title:
      language === "en"
        ? `${parts.category} template ${parts.variant}`
        : `${parts.category} 行业模板 ${parts.variant}`,
    subtitle:
      language === "en"
        ? "A bilingual, self-contained website template."
        : "可预览、分享和下载源码的中英双语自包含网站模板。",
    language,
    accent: "#2563eb",
  });
  const headers: Record<string, string> = {
    "Cache-Control": download
      ? "public, max-age=0, s-maxage=86400"
      : "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    "Content-Type": "text/html; charset=utf-8",
  };
  if (download) {
    headers["Content-Disposition"] =
      `attachment; filename="${escapeHtml(slug)}.html"`;
  }
  return new Response(html, { status: 200, headers });
}
