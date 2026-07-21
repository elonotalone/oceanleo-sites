import { tenantRobots } from "@oceanleo/runtime/next";

import { APP_PROFILE } from "../profile";

export const dynamic = "force-dynamic";

export default function robots() {
  return tenantRobots(APP_PROFILE);
}
