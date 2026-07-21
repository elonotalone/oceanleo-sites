import { standardPluginDispatcher } from "@oceanleo/plugin-registry/standard";
import {
  dispatchNextPluginPage,
  type NextPluginPageSearchParams,
} from "@oceanleo/plugin-runtime/next";

import { APP_PROFILE } from "../../profile";

export const dynamic = "force-dynamic";

export default async function StandardPluginPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<NextPluginPageSearchParams>;
}>) {
  const [{ segments }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  return dispatchNextPluginPage({
    dispatcher: standardPluginDispatcher,
    profile: APP_PROFILE,
    segments,
    searchParams: resolvedSearchParams,
  });
}
