import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy `/api` UI lived under a path that collides with the API catch-all.
 * Keep a permanent redirect at the exact `/api` mount so bookmarks still land
 * on the developer API page (`/developer-api`).
 */
export function GET(request: NextRequest) {
  const destination = new URL("/developer-api", request.url);
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

export function HEAD(request: NextRequest) {
  return GET(request);
}
