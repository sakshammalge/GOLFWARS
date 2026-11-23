# Contributing to GolfWars

Hobby project, free, for fun. These rules keep humans and agent threads from tripping over each other.

## Setup

Node 20+ and pnpm (`corepack enable`). Then `pnpm install` and `pnpm dev`.
Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Branches

`main` is protected by convention: never push to it directly, everything goes through a PR.

Branch name: `m<milestone>/<short-name>`, for example `m1/offline-prototype`. One branch per milestone.

## Pull requests

- One PR per milestone, one commit per task. Each commit message starts with the task ID (for example `T1.3: Ball physics in shared`). The owner merges by hand, so sequential tasks do not wait on individual merges.
- The PR description lists the task IDs it covers and how each acceptance criterion was verified (commands run, screenshots, manual steps).
- CI must be green before merge.
- Keep PRs small and focused; do not mix in unrelated refactors.

## Commit messages

Start with the task ID: `T<milestone>.<n>: summary`, for example `T1.4: Shot controls and power meter`. Imperative mood, summary under about 72 characters. Work outside a task (fixes, chores) uses `type(scope): summary`, for example `fix(server): reject stale protocol` (types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`).

## Picking up a task (agent threads)

Task briefs live in `docs/tasks/` (format in `docs/tasks/README.md`).

1. Read the brief for your task ID completely, plus anything it links.
2. Branch from an up-to-date `main` using the naming above (reuse the milestone branch if it already exists).
3. Touch only the files the brief lists, unless you must, and explain why in the PR.
4. Run the "How to test" steps and the full check suite.
5. Open (or update) the milestone PR with the task IDs and acceptance-criteria evidence.

## Code conventions

TypeScript strict everywhere. Shared constants and message types go in `packages/shared`. Prettier formats (`pnpm format`), ESLint lints (`pnpm lint`). Binary assets use Git LFS (see `.gitattributes`).
