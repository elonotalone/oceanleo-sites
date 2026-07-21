import { tenantMetadataResponse } from "@oceanleo/runtime/next";
import type { NextRequest } from "next/server";

import { APP_PROFILE } from "../../../profile";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return tenantMetadataResponse(request, APP_PROFILE);
}
