# OceanLeo sites

One pnpm monorepo for the OceanLeo tenant foundation:

- `apps/standard`: 30 standard tenants and 36 exact hosts.
- `apps/website-privileged`: the `website` tenant and its isolated server
  surface.
- `packages/tenant-registry`: immutable manifests and exact Host resolution.
- `packages/capabilities`: server-only grants and secret references.
- `packages/runtime`: tenant isolation and Next.js integration helpers.
- `packages/plugin-runtime`: typed page, API, redirect, and streaming contracts,
  capability-first dispatch, and Next.js adapters.
- `packages/plugin-registry`: fixed profile entrypoints plus the one inventory
  aggregator.

`@oceanleo/ui` is pinned through the workspace catalog to the released
`github:elonotalone/oceanleo-ui#v0.186.0` tag. The repository has one root
lockfile.

## Parallel migration ownership

Each migration owner has one exclusive package. Its plugin declarations,
inventory declaration, and tests are all inside that package:

| Owner | Exclusive write boundary | Tenants |
| --- | --- | --- |
| office | `packages/migration-office/**` | `ppt`, `excel`, `word`, `converter`, `resume` |
| media | `packages/migration-media/**` | `aihuman`, `image`, `video`, `logo`, `interior`, `threed` |
| knowledge | `packages/migration-knowledge/**` | `bizdev`, `meeting`, `paper`, `law`, `study`, `edu` |
| creation | `packages/migration-creation/**` | `ecommerce`, `novel`, `script`, `design`, `make` |
| platform | `packages/migration-platform/**` | `agent`, `chat`, `music`, `search`, `money`, `aitools`, `asset`, `game` |
| website-privileged | `packages/migration-website-privileged/**` | `website`, including its 47 pending handlers |

Batch owners do not edit another batch, either app, `packages/plugin-runtime`,
`packages/plugin-registry`, root manifests, the lockfile, `inventory/**`, or
`generated/**`. The fixed registry imports each package's `./plugins` and
`./inventory` seams, so implementation and parity updates require no shared
registry change. Generated inventory is refreshed by the integration owner,
never hand-edited.

The standard registry imports only the five standard packages. The privileged
registry imports only the website package. Pending declared routes return a
typed 501 result without invoking code; undeclared routes return 404. See
`docs/migration-ownership.md` for the route contract and exact handoff rules.

## Checks

Run Node and pnpm in the host namespace and serialize heavy work:

```sh
bash /opt/cursor-workspaces/oceandino/scripts/agent-io-guard.sh run-heavy -- \
  nsenter -t 1 -m -u -i -n -p bash -lc \
  'cd /root/projects/oceanleo-sites && pnpm install --frozen-lockfile'
bash /opt/cursor-workspaces/oceandino/scripts/agent-io-guard.sh run-heavy -- \
  nsenter -t 1 -m -u -i -n -p bash -lc \
  'cd /root/projects/oceanleo-sites && pnpm check'
```

`pnpm inventory:generate` is the only writer for
`generated/route-handler-inventory.json`; `pnpm inventory:check` validates the
schema, invariants, and byte-for-byte determinism.

This repository does not own domain cutover, Vercel project mutation, database
migration, or retirement of existing site repositories.
