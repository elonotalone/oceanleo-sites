import { tenantSitemapRoute } from "@oceanleo/runtime/next";

import { APP_PROFILE } from "../profile";

export const dynamic = "force-dynamic";

export default function sitemap() {
  return tenantSitemapRoute(APP_PROFILE);
}
