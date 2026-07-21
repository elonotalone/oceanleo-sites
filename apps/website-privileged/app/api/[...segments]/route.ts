import { websitePrivilegedPluginDispatcher } from "@oceanleo/plugin-registry/website-privileged";
import { dispatchNextPluginApi } from "@oceanleo/plugin-runtime/next";
import type { NextRequest } from "next/server";

import { APP_PROFILE } from "../../../profile";

export const dynamic = "force-dynamic";

function handle(request: NextRequest) {
  return dispatchNextPluginApi({
    dispatcher: websitePrivilegedPluginDispatcher,
    profile: APP_PROFILE,
    request,
  });
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
