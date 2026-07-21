import { tenantProxyResponse } from "@oceanleo/runtime/next";
import type { NextRequest } from "next/server";

import { APP_PROFILE } from "./profile";

export function proxy(request: NextRequest) {
  return tenantProxyResponse(request, APP_PROFILE);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
