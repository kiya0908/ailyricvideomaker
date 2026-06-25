---
name: shadcn-ui-builder
description: Use this when adding/updating shadcn/ui components or blocks in this monorepo (Tailwind v4, shared UI package, CSS variable theming).
---

# shadcn/ui builder (monorepo + Tailwind v4)

Use this skill when you need to add or update UI components/blocks via the shadcn CLI, or when refactoring UI to follow the repo’s conventions.

## Hard rules (this repo)

- Don’t hardcode Tailwind palette colors. Use semantic tokens like `bg-background`, `text-foreground`, `border-border`, etc.
- Prefer shared components from `@workspace/ui/*`.
- Keep filenames kebab-case.

## Where components live

- Shared UI components: `packages/ui/src/components/*` (import as `@workspace/ui/components/<name>`)
- Shared UI styles: `packages/ui/src/styles/globals.css`
- App-specific composition/components: `apps/user-application/src/components/*`

## shadcn CLI (latest)

The shadcn CLI supports monorepos. In this repo, each workspace has a `components.json` that tells the CLI where to write files.

### Inspect registry items before adding

- View an item: `bunx shadcn@latest view button`
- Search/list items: `bunx shadcn@latest search @shadcn -q "dialog"`

### Add components (recommended)

Run from the app workspace so the CLI can resolve monorepo paths correctly:

- Most reliable (cd first):
	- `cd apps/user-application && ../../scripts/bunx --bun shadcn@latest add button --yes`
- Alternative (if your `bunx` is healthy):
	- `cd apps/user-application && bunx --bun shadcn@latest add button --yes`
- If you must run from repo root, ensure shadcn runs with the correct working directory (support varies by CLI version):
	- Prefer `cd apps/user-application` over relying on a `--cwd` flag.

Notes:
- Adding a “block” (e.g. `login-01`) may install primitives into `packages/ui` and the composed block into the app.
- If you need to control where files land, use `--path` (and prefer app-level composition in `apps/user-application/src/components`).

Troubleshooting:

- If shadcn says it can’t detect a supported framework or can’t find `components.json`, you’re probably in the wrong directory. Run from `apps/user-application`.
- If `bunx` outputs nothing, check `which bunx`. If it points to a package-manager shim (pnpm, etc.), use `../../scripts/bunx` or `bun x`.
- VS Code note: PATH overrides in `.vscode/settings.json` apply only to **new** integrated terminals.

### Updating existing components

Shadcn recommends re-adding components to pick up upstream improvements. This overwrites local modifications.

- Commit first.
- Then (example): `bunx shadcn@latest add --all --overwrite --cwd apps/user-application`

## Tailwind v4 + React 19 notes (upstream)

- Tailwind v4 shadcn components use CSS variables and `@theme inline` patterns.
- Many components removed `forwardRef` and added `data-slot` attributes for styling.
- `toast` is deprecated upstream in favor of `sonner`.

## Quick repo sanity checks after UI changes

- Lint UI package: `bun run --filter @workspace/ui lint`
- Typecheck user app: `bunx tsc -p apps/user-application/tsconfig.json --noEmit`
- Typecheck UI package: `bunx tsc -p packages/ui/tsconfig.json --noEmit`
