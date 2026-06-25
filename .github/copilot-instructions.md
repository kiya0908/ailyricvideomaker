# GitHub Copilot Instructions

## Project Overview

This is a monorepo SaaS application built with **Cloudflare Workers**, **TanStack Start**, and **Drizzle ORM**.

- **Package Manager**: `bun`
- **Database**: Cloudflare D1 (SQLite)
- **Authentication**: Better Auth
- **Styling**: Tailwind CSS v4

## Repository Structure

- `apps/user-application`: Frontend/Fullstack app (TanStack Start, React 19, Vite).
- `apps/data-service`: Backend API Worker (Hono).
- `packages/data-ops`: Shared library for Database (Drizzle) and Authentication (Better Auth).
- `packages/ui`: Shared UI/component library (Base UI + Tailwind v4) consumed by apps.
- `packages/typescript-config`: Shared TS config presets (apps/packages extend these).

## Critical Developer Workflows

### 1. Setup & Development

- **Initial Setup**: `bun run setup` (Installs deps & builds `data-ops`).
- **Start User App**: `bun run dev:user-application` (Runs on port 3000).
- **Start Data Service**: `bun run dev:data-service`.
- **Rebuild Shared Lib**: `bun run build:data-ops` (Run this after changing `packages/data-ops`).

### 1.1 Linting & Typechecking

- **Lint UI package**: `bun run --filter @workspace/ui lint`
- **Typecheck (any package/app)**: prefer `bunx tsc -p <dir>/tsconfig.json --noEmit` when debugging TS issues.

### 2. Database & Authentication (Cloudflare D1)

The `data-ops` package manages the database schema and auth configuration.

- **Generate Auth Schema**: `bun run --filter ./packages/data-ops better-auth:generate`
- **Generate SQL Migrations**: `bun run --filter ./packages/data-ops drizzle:generate`
- **Apply Migrations (Local)**: `npx wrangler d1 execute DB --local --file=../../packages/data-ops/src/drizzle/<migration_file>.sql` (from `apps/user-application`)
- **Apply Migrations (Remote)**: `bun run --filter ./packages/data-ops drizzle:migrate`

### 3. Type Generation
- **Generate Worker Types**: `bun run --filter ./apps/user-application cf-typegen`
  - Updates `worker-configuration.d.ts` based on `wrangler.jsonc`.
  - Run this after modifying bindings or environment variables.
- **Generate Data Service Worker Types**: `bun run --filter ./apps/data-service cf-typegen`

## Architecture & Patterns

### Environment Variables & Bindings

- **Pattern**: Use `import { env } from "cloudflare:workers"` to access bindings globally.
- **Local Secrets**: Store in `apps/user-application/.dev.vars`.
- **Drizzle Kit Secrets**: Store in `packages/data-ops/.env` (for schema generation only).
- **Wrangler Config**: Defined in `wrangler.jsonc` (supports comments).

### Shared Data Operations (`packages/data-ops`)

- Centralizes all DB schemas (`src/drizzle/auth-schema.ts`) and setup (`src/database/setup.ts`).
- Exports helper functions like `initDatabase` and `setAuth`.
- **Rule**: Do not define DB schemas in apps; always define in `data-ops` and import.

### Shared TypeScript Configs (`packages/typescript-config`)

- Apps and packages generally extend `@workspace/typescript-config/vite-react-library.json`.
- When TS settings must change, prefer changing the shared preset rather than diverging per-package.

### User Application (`apps/user-application`)

- **Framework**: TanStack Start (SSR, File-based routing).
- **Entry Point**: `src/server.ts` (Custom Cloudflare Worker entry).
- **Routing**: `src/routes/` (Auto-generated `routeTree.gen.ts`).
- **Styling**: Tailwind v4 (no `tailwind.config.js`, uses CSS variables).

### UI Package (`packages/ui`)

- Components live in `packages/ui/src/components` and are consumed via `@workspace/ui/components/*`.
- Prefer Base UI composition patterns (e.g., `render` props) over `asChild`-style APIs.
- Keep UI exports stable and consistent with the `exports` map in `packages/ui/package.json`.

## Task Management (Mandatory)

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

### 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```bash
[ ] 1. git status              # check what changed
[ ] 2. git add <files>         # stage code changes
[ ] 3. bd sync                 # commit beads changes
[ ] 4. git commit -m "..."     # commit code
[ ] 5. bd sync                 # commit any new beads changes
[ ] 6. git push                # push to remote
```

**NEVER skip this.** Work is not done until pushed.

## Coding Standards

- **TypeScript**: Strict mode enabled. Use `import type` for type-only imports.
- **React**: Use Functional Components with Hooks.
- **Imports**: Use `@/*` aliases for `src/*` in apps; use `@workspace/ui/*` for shared UI imports.
- **Files**: Kebab-case for filenames (e.g., `user-profile.tsx`).
