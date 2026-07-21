# OceanLeo sites

One pnpm monorepo for the OceanLeo tenant foundation:

- `apps/standard`: 30 standard tenants and 36 exact hosts.
- `apps/website-privileged`: the `website` tenant and its isolated server
  surface.
- `packages/tenant-registry`: immutable manifests and exact Host resolution.
- `packages/capabilities`: server-only grants and secret references.
- `packages/runtime`: tenant isolation and Next.js integration helpers.

`@oceanleo/ui` is pinned through the workspace catalog to the released
`github:elonotalone/oceanleo-ui#v0.186.0` tag. The repository has one root
lockfile.

## Checks

Run Node and pnpm in the host namespace and serialize heavy work:

```sh
bash /opt/cursor-workspaces/oceandino/scripts/agent-io-guard.sh run-heavy -- \
  nsenter -t 1 -m -u -i -n -p pnpm test
bash /opt/cursor-workspaces/oceandino/scripts/agent-io-guard.sh run-heavy -- \
  nsenter -t 1 -m -u -i -n -p pnpm typecheck
```

`pnpm inventory:generate` is the only writer for
`generated/route-handler-inventory.json`; `pnpm inventory:check` validates the
schema, invariants, and byte-for-byte determinism.

This repository does not own domain cutover, Vercel project mutation, database
migration, or retirement of existing site repositories.
