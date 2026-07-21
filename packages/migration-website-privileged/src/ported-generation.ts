import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import { chatComplete, chatCompleteStream, parseJsonResponse } from "./openai";
import { json, record, responseHandler } from "./runtime";
import {
  defaultVirtualSiteConfig,
  normalizeVirtualSiteConfig,
} from "./virtual-site-normalize";

const BUILD_SYSTEM_PROMPT = `You are a Website Architect.
Your task is to generate a virtual website configuration from user requirements.
Output JSON only. Do not output Markdown or extra explanations.

The output must follow this VirtualSiteConfig structure:
{
  "siteName": "string",
  "themeColor": "#RRGGBB",
  "navigation": [{ "label": "string", "href": "#section-id" }],
  "sections": [
    {
      "id": "string",
      "type": "hero | stats | feature-grid | pricing | footer",
      "content": { ...copywriting and image descriptor fields... }
    }
  ]
}

Component pool (currently available):
1) Hero
2) Stats
3) FeatureGrid
4) Pricing
5) Footer

Important constraints:
1. Always return a complete VirtualSiteConfig. Never return a partial patch.
2. Support incremental edits. If the user asks for changes like "make the background blue" or "add an about section", apply those changes on top of currentConfig and return the full updated JSON.
3. Each section content must include persuasive marketing copy and an image object:
   - image.keyword: an English keyword suitable for Unsplash search
   - image.alt: a concise English image description
4. Allowed section types are exactly: hero / stats / feature-grid / pricing / footer.
5. Response must be strict JSON (json_mode) with no comments or extra fields.
6. All user-facing website copy (navigation labels, headings, descriptions, CTAs, plan details, footer text, and image.alt) must be in English.`;

const STREAM_BUILD_SYSTEM_PROMPT = `${BUILD_SYSTEM_PROMPT}
6. Preserve the current site's language unless the user explicitly requests another language. All user-facing copy must use one consistent language.`;

const PLAN_SYSTEM_PROMPT = `You are Mycreator's planning assistant — the "Plan mode" of an AI website builder.
The user describes a website idea or a change. You discuss, plan and advise — you NEVER generate code or JSON in this mode.

Guidelines:
- Be concise and structured. Use short markdown: bold headers, bullet lists.
- Suggest a concrete section structure (hero / stats / feature-grid / pricing / footer are the available building blocks).
- Propose copy angles, color directions, and content priorities.
- If the request is ambiguous, ask 1-2 sharp clarifying questions at the end.
- End with a one-line suggestion the user could send in Build mode to generate the site.
- Answer in English.`;

function sseEncode(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function requireOpenAiKey(): Response | null {
  if (process.env.OPENAI_API_KEY) return null;
  return json(
    { error: "OPENAI_API_KEY is not configured on the server." },
    500,
  );
}

const generateSiteHandler = responseHandler({
  POST: async (request) => {
    const missing = requireOpenAiKey();
    if (missing) return missing;

    let payload: { prompt?: unknown; currentConfig?: unknown };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const prompt =
      typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      return json({ error: "Prompt cannot be empty." }, 400);
    }

    const currentConfig = normalizeVirtualSiteConfig(
      payload.currentConfig ?? defaultVirtualSiteConfig,
    );

    try {
      const content = await chatComplete(
        [
          { role: "system", content: BUILD_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify(
              {
                instruction: prompt,
                currentConfig,
                requirement:
                  "Return the fully updated VirtualSiteConfig JSON and only use these section types: hero/stats/feature-grid/pricing/footer. Ensure all user-facing website copy is English.",
              },
              null,
              2,
            ),
          },
        ],
        {
          temperature: 0.4,
          responseFormat: "json_object",
          timeoutMs: 60_000,
        },
      );

      const parsed = parseJsonResponse<unknown>(content);
      const candidate = record(parsed);
      const normalized = normalizeVirtualSiteConfig(
        candidate?.config ?? parsed ?? defaultVirtualSiteConfig,
      );
      return json({ config: normalized });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate site config. Please try again.",
        },
        500,
      );
    }
  },
});

const generateSiteStreamHandler: PluginRouteHandler = async ({ request }) => {
  if (request.method.toUpperCase() !== "POST") {
    return {
      kind: "response",
      response: json(
        { error: "Method not allowed" },
        405,
        { Allow: "POST" },
      ),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      kind: "response",
      response: json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        500,
      ),
    };
  }

  let payload: { prompt?: unknown; currentConfig?: unknown; mode?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return {
      kind: "response",
      response: json({ error: "Request body must be valid JSON." }, 400),
    };
  }

  const prompt =
    typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return {
      kind: "response",
      response: json({ error: "Prompt cannot be empty." }, 400),
    };
  }

  const mode = payload.mode === "plan" ? "plan" : "build";
  const currentConfig = normalizeVirtualSiteConfig(
    payload.currentConfig ?? defaultVirtualSiteConfig,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(sseEncode(event));
        } catch {
          /* stream closed by client */
        }
      };

      try {
        if (mode === "plan") {
          send({ type: "status", label: "Thinking about your idea" });
          for await (const delta of chatCompleteStream(
            [
              { role: "system", content: PLAN_SYSTEM_PROMPT },
              {
                role: "user",
                content: `Current site config (for context): ${JSON.stringify(currentConfig)}\n\nUser request: ${prompt}`,
              },
            ],
            { temperature: 0.6, timeoutMs: 120_000 },
          )) {
            send({ type: "delta", text: delta });
          }
          send({ type: "done" });
        } else {
          send({ type: "status", label: "Analyzing your request" });
          let raw = "";
          let sentBuilding = false;
          for await (const delta of chatCompleteStream(
            [
              { role: "system", content: STREAM_BUILD_SYSTEM_PROMPT },
              {
                role: "user",
                content: JSON.stringify(
                  {
                    instruction: prompt,
                    currentConfig,
                    requirement:
                      "Return the fully updated VirtualSiteConfig JSON and only use these section types: hero/stats/feature-grid/pricing/footer. Preserve the current site's language unless the instruction explicitly requests another one.",
                  },
                  null,
                  2,
                ),
              },
            ],
            {
              temperature: 0.4,
              responseFormat: "json_object",
              timeoutMs: 120_000,
            },
          )) {
            raw += delta;
            if (!sentBuilding && raw.length > 24) {
              send({ type: "status", label: "Writing site structure" });
              sentBuilding = true;
            }
            send({ type: "delta", text: delta });
          }

          send({ type: "status", label: "Applying changes to preview" });
          try {
            const parsed = JSON.parse(raw) as unknown;
            const candidate = record(parsed);
            const normalized = normalizeVirtualSiteConfig(
              candidate?.config ?? parsed,
            );
            send({ type: "config", config: normalized });
            send({ type: "done" });
          } catch {
            send({
              type: "error",
              error: "AI returned malformed JSON. Please try again.",
            });
          }
        }
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Generation failed. Please try again.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return {
    kind: "response",
    response: new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }),
  };
};

export const GENERATION_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/generate-site": generateSiteHandler,
  "/api/generate-site/stream": generateSiteStreamHandler,
});
