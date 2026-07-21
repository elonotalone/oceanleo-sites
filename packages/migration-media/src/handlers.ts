import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";
import { createElement } from "react";

export interface MediaPageContract {
  readonly title: string;
  readonly summary: string;
  readonly workspaceHref: `/${string}`;
}

/**
 * Keeps an inventoried media route active while its legacy client-heavy
 * workbench is progressively moved into the shared application. The handler is
 * intentionally server-only and carries no provider credentials.
 */
export function createMediaPageHandler(
  contract: MediaPageContract,
): PluginRouteHandler {
  return ({ tenant, request, pathname, params, route }) => {
    const search = new URL(request.url).searchParams.toString();
    const routeParams = JSON.stringify(params);

    return {
      kind: "page",
      node: createElement(
        "main",
        {
          "data-media-plugin": tenant.plugin.id,
          "data-media-route": route.id,
          "data-media-site": tenant.manifest.siteKey,
          "data-media-status": route.parity.status,
          "data-request-path": pathname,
          "data-request-search": search,
          "data-route-params": routeParams,
          style: {
            margin: "0 auto",
            maxWidth: "72rem",
            padding: "3rem 2rem",
          },
        },
        createElement("p", null, `${tenant.manifest.brand.name} media plugin`),
        createElement("h1", null, contract.title),
        createElement("p", null, contract.summary),
        createElement(
          "a",
          {
            href: contract.workspaceHref,
          },
          "Open canonical workbench",
        ),
      ),
    };
  };
}
