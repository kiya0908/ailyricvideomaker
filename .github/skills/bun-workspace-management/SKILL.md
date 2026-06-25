---
name: bun-workspace-management
description: Use this when managing apps/packages in this monorepo with Bun instead of pnpm: running scripts per workspace, installing/add/removing deps, using bun run --filter, troubleshooting bun trustedDependencies, and running bun audit/bun pm commands.
---

# Bun workspace/package management (day-to-day)

This skill is for routine monorepo work *after* the repo uses Bun.
For pnpm → Bun migration steps, use the `bun-monorepo-workflows` skill.

## bun/bunx troubleshooting (PATH)

If `bun` or `bunx` prints nothing or behaves inconsistently, you likely have multiple installs and the wrong one is first on PATH.

Quick checks:

- `which bun` / `which bunx`
- `bun --version` (should print a version)

Repo standard (most reliable):

- Use `./scripts/bun ...` and `./scripts/bunx ...` from the repo root.

VS Code note: PATH overrides in `.vscode/settings.json` apply only to **new** integrated terminals.

## Run scripts (root + workspaces)

- Run a root script: `bun run <script>`

- Run a workspace script by package name:
  - `bun run --filter user-application dev`
  - `bun run --filter data-service dev`
  - `bun run --filter ./packages/data-ops build`
  - `bun run --filter @workspace/ui lint`

- Run a workspace script by path (most reliable):
  - `bun run --filter ./apps/user-application build`
  - `bun run --filter ./packages/data-ops drizzle:generate`

## Install dependencies

- Install everything: `bun install`
- Install in CI (frozen lockfile): `bun ci`

Install or run for subsets:

- Install deps for only one workspace: `bun install --filter ./apps/user-application`
- Exclude a workspace: `bun install --filter '!./apps/data-service'`

## Add / remove dependencies

- Add dependency (workspace local):
  - Prod: `bun add <pkg>`
  - Dev: `bun add -d <pkg>`

- Add dependency in a specific workspace:
  - `bun add --cwd ./apps/user-application <pkg>`
  - `bun add --cwd ./packages/ui -d <pkg>`

- Remove:
  - `bun remove --cwd ./apps/data-service <pkg>`

## Common repo workflows (Bun)

- Initial setup: `bun run setup`
- Rebuild shared lib: `bun run build:data-ops`
- Dev servers:
  - User app: `bun run dev:user-application`
  - Data service: `bun run dev:data-service`

## Wrangler / Cloudflare tooling

- Prefer running Wrangler via scripts (e.g., `bun run dev:user-application`).
- Avoid forcing Bun’s runtime for Wrangler (`bun --bun`) unless you know it works.
- If Wrangler behaves oddly under Bun, run it directly with Node (`node ./node_modules/.bin/wrangler ...`) or via the package script.

## Trusted dependencies (native postinstalls)

Bun blocks dependency lifecycle scripts by default.

- See blocked scripts: `bun pm untrusted`
- Trust a dependency (and run its scripts): `bun pm trust <name>`
- Trust everything currently blocked: `bun pm trust --all`

Prefer committing `trustedDependencies` changes to the root `package.json` if the repo needs them.

## Audit

- Run audit: `bun audit --audit-level=moderate`
- Prod-only: `bun audit --prod`

## Package manager introspection

- List installed deps: `bun pm ls` (or `bun list`)
- Why is this installed: `bun why <pkg>`
- Cache path: `bun pm cache`
- Clear cache: `bun pm cache rm`
