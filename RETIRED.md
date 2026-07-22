# RETIRED — not a production publish path

**Status:** retired for production on 2026-07-22  
**Reason:** OceanLeo production returned to independent GitHub repos →
independent Vercel projects (31 professional sites + `oceanleo.com` main).
This monorepo dual-app path (`oceanleo-sites-standard` /
`oceanleo-sites-website-privileged`) had no remaining production advantage and
caused agents to push/verify the wrong deployment topology.

## What was removed

- Vercel projects `oceanleo-sites-standard` and
  `oceanleo-sites-website-privileged` (they held only `*.vercel.app` aliases;
  no `*.oceanleo.com` production domains).
- This GitHub repository is archived read-only after this marker lands.

## Do not

- Push product or `@oceanleo/ui` rollouts here.
- Point production DNS at this repo's former Vercel apps.
- Treat tenant/cutover controllers here as the live publish authority.

## Production truth

Use `/opt/cursor-workspaces/oceandino/docs/architecture/oceanleo-shared-ui-change-workflow.md`
and `scripts/oceanleo-sites.tsv` → `oceanleo-ui-bump.sh` →
`oceanleo-sites-push.sh` → `oceanleo-sites-vercel-status.sh`.

## Evidence retained

- Local workspace clone may remain for historical cutover/retirement ledgers.
- Sealed git bundle:
  `/var/lib/oceanleo-cutover/archives/oceanleo-sites-main-20260722.bundle`
- Cutover/retirement ledgers under `/var/lib/oceanleo-cutover/` and this repo's
  `deploy/` + `retirement/` trees.
