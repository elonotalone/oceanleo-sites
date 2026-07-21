import { standardPluginDispatcher } from "@oceanleo/plugin-registry/standard";
import { dispatchNextPluginPage } from "@oceanleo/plugin-runtime/next";

import { APP_PROFILE } from "../../profile";

export const dynamic = "force-dynamic";

export default async function StandardPluginPage({
  params,
}: Readonly<{ params: Promise<{ segments: string[] }> }>) {
  const { segments } = await params;
  return dispatchNextPluginPage({
    dispatcher: standardPluginDispatcher,
    profile: APP_PROFILE,
    segments,
  });
}
