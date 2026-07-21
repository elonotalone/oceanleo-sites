const PRIVATE_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Host",
  "X-Content-Type-Options": "nosniff",
});

export function jsonResponse(
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

export function binaryResponse(
  body: BodyInit,
  init: Readonly<{ status?: number; headers?: HeadersInit }> = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      ...PRIVATE_RESPONSE_HEADERS,
      ...init.headers,
    },
  });
}
