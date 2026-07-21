import { currentTenant, tenantPageMetadata } from "@oceanleo/runtime/next";
import { TenantShell } from "@oceanleo/runtime/shell";

import { APP_PROFILE } from "../profile";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return tenantPageMetadata(APP_PROFILE);
}

export default async function HomePage() {
  const tenant = await currentTenant(APP_PROFILE);
  return <TenantShell tenant={tenant} />;
}
