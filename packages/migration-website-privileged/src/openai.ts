const DEFAULT_MODEL = "gpt-4o-mini";

function apiBase(): string {
  return (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  apiKey?: string;
  timeoutMs?: number;
}

export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it in environment variables.",
    );
  }

  const body: Record<string, unknown> = {
    model: options.model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.8,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );

  try {
    const response = await fetch(`${apiBase()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API error (${response.status}): ${errText.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as Record<string, any>;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI returned no content");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseJsonResponse<T = unknown>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}

export async function* chatCompleteStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it in environment variables.",
    );
  }

  const body: Record<string, unknown> = {
    model: options.model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.8,
    stream: true,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${apiBase()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI API error (${response.status}): ${errText.slice(0, 300)}`,
    );
  }
  if (!response.body) {
    throw new Error("OpenAI returned an empty stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as Record<string, any>;
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // Skip malformed SSE chunks.
      }
    }
  }
}
