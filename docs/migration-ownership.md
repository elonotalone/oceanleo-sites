# Migration ownership and plugin dispatch

## Mechanical ownership boundary

Six owners may work concurrently because every implementation, declaration,
and focused test they change is contained by one directory:

| Batch | Exclusive directory | Tenant keys | Declaration | Focused test |
| --- | --- | --- | --- | --- |
| 1 office | `packages/migration-office/**` | `ppt`, `excel`, `word`, `converter`, `resume` | `src/inventory.ts` | `tests/office.test.ts` |
| 2 media | `packages/migration-media/**` | `aihuman`, `image`, `video`, `logo`, `interior`, `threed` | `src/inventory.ts` | `tests/media.test.ts` |
| 3 knowledge | `packages/migration-knowledge/**` | `bizdev`, `meeting`, `paper`, `law`, `study`, `edu` | `src/inventory.ts` | `tests/knowledge.test.ts` |
| 4 creation | `packages/migration-creation/**` | `ecommerce`, `novel`, `script`, `design`, `make` | `src/inventory.ts` | `tests/creation.test.ts` |
| 5 platform | `packages/migration-platform/**` | `agent`, `chat`, `music`, `search`, `money`, `aitools`, `asset`, `game` | `src/inventory.ts` | `tests/platform.test.ts` |
| 6 website-privileged | `packages/migration-website-privileged/**` | `website` | `src/inventory.ts` and `src/handlers.ts` | `tests/website-privileged.test.ts` |

Within a batch, `src/plugins.ts` owns route implementation and
`src/inventory.ts` owns parity evidence. The pre-created package manifest and
TypeScript config already expose the fixed seams and common dependencies.
Batch work must not require edits to the root package or lockfile.

The following remain integration-owned and are outside every batch boundary:

- `apps/**`
- `packages/plugin-runtime/**`
- `packages/plugin-registry/**`
- `packages/tenant-registry/**`, `packages/capabilities/**`, and
  `packages/runtime/**`
- `inventory/**`, `generated/**`, `schemas/**`, and `scripts/**`
- root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and TypeScript
  configs

The generated JSON is an output. Batch owners update only their declaration;
the integration owner runs generation and reviews the aggregate output.

## Fixed import seams

`@oceanleo/plugin-registry/standard` statically imports office, media,
knowledge, creation, and platform. It has no import edge to the website
package.

`@oceanleo/plugin-registry/website-privileged` statically imports only the
website package. It has no import edge to any standard package.

`@oceanleo/plugin-registry/inventory` is the only all-profile aggregator. It
imports the six `./inventory` subpaths for tooling and is never imported by
either runtime dispatcher. Consequently, a batch owner does not edit a shared
registry when routes or parity change.

## Route contract

Each tenant plugin declares routes with:

- a stable route ID, app surface, HTTP methods, and exact path pattern;
- a trusted capability checked before any active handler is invoked;
- parity source and evidence;
- optional exact source hosts for alias redirects;
- an optional static redirect target; and
- an active handler only after the route is no longer pending.

Patterns support literal segments, `:param`, and a final `:param*` catch-all.
Handlers receive extracted params as strings or string arrays. Handler results
represent React pages, Web `Response` APIs, redirects, or
`ReadableStream<Uint8Array>` streaming responses.

Dispatch is deterministic: profile and tenant are selected first, candidates
are ordered by priority, path specificity, and stable route ID, then
authorization runs before handler invocation. A declared pending route returns
501 without calling a handler. An undeclared route returns 404. A tenant from
the other app profile returns 421.

Alias redirects are exact-host declarations with explicit destination host,
status, and either preserved or fixed paths. No arbitrary subdomain-derived
redirect is permitted.

## App and inventory integration

Both apps have pre-created page and API catch-alls. The standard catch-alls
import only the standard registry entrypoint; the privileged catch-alls import
only the privileged entrypoint. Owners therefore never add app route files.

The inventory builder consumes all six declarations through the fixed tooling
aggregator. The website package itself owns the complete 47-path list; all 47
entries and route stubs remain pending until the website owner supplies
handler-level parity evidence.

An owner completes a route by changing only its own package:

1. Add or replace route handlers in `src/plugins.ts`.
2. Change the corresponding `src/inventory.ts` entry from pending only when
   parity evidence exists.
3. Add evidence and behavior tests under the package's `tests/**`.
4. Run that package test and typecheck, then the repository check; do not edit
   shared files to accommodate the batch.
