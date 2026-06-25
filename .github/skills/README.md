# Copilot Agent Skills (repo-local)

This repository uses GitHub Copilot Agent Skills.

Skills live under `.github/skills/<skill-name>/SKILL.md`.

## Included skills

- `beads-issue-tracking`: bd (beads) workflow + mandatory end-of-session push steps
- `bun-monorepo-workflows`: bun install/run/filter workflows + pnpm → bun migration checklist for this monorepo
- `bun-workspace-management`: day-to-day Bun workflows for managing apps/packages (bun run --filter, add/remove deps, trustedDependencies, bun audit)
- `pnpm-monorepo-workflows`: legacy pnpm workflows (deprecated)
- `d1-drizzle-migrations`: D1 + Drizzle + Better Auth schema/migration workflow
- `cloudflare-worker-typegen`: regenerate worker binding types when `wrangler.jsonc` changes
- `shadcn-ui-builder`: add/update shadcn/ui components and blocks (monorepo + Tailwind v4)
- `tanstack-server-functions`: TanStack Start server functions + middleware patterns
- `skill-creator`: create new Copilot Agent skills following repo conventions
- `mcp-builder`: guidance for setting up/using MCP servers in this repo
- `pdf`: guidance for working with PDFs
- `pptx`: guidance for working with PowerPoint files
- `xlsx`: guidance for working with Excel files

## Notes

- Skills are loaded automatically by Copilot when relevant to your prompt.
- Keep always-on conventions in `.github/copilot-instructions.md` and use skills for deeper, task-specific procedures.
