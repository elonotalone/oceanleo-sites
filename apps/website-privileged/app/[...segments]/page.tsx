import { websitePrivilegedPluginDispatcher } from "@oceanleo/plugin-registry/website-privileged";
import { dispatchNextPluginPage } from "@oceanleo/plugin-runtime/next";

import { APP_PROFILE } from "../../profile";

export const dynamic = "force-dynamic";

export default async function WebsitePrivilegedPluginPage({
  params,
}: Readonly<{ params: Promise<{ segments: string[] }> }>) {
  const { segments } = await params;
  return dispatchNextPluginPage({
    dispatcher: websitePrivilegedPluginDispatcher,
    profile: APP_PROFILE,
    segments,
  });
}
