# Contributing to GolfWars

Hobby project, free, for fun. These rules keep humans and agent threads from tripping over each other.

## Setup

Node 20+ and pnpm (`corepack enable`). Then `pnpm install` and `pnpm dev`.
Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Branches

`main` is protected by convention: never push to it directly, everything goes through a PR.

Branch name: `m<milestone>/<task-id>-short-name`, for example `m1/t1.3-shot-controls`.
The foundations milestone used `m0/foundations`.

## Pull requests

- One PR per task.
- The PR description states the task ID (for example `T1.3`) and how each acceptance criterion was verified (commands run, screenshots, manual steps).
- CI must be green before merge.
- Keep PRs small and focused; do not mix in unrelated refactors.

## Commit messages

Conventional-ish: `type(scope): summary`, for example `feat(client): add shot power meter` or `fix(server): reject stale protocol`.
Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`. Imperative mood, summary under about 72 characters.

## Picking up a task (agent threads)

Task briefs live in `docs/tasks/` (format in `docs/tasks/README.md`).

1. Read the brief for your task ID completely, plus anything it links.
2. Branch from an up-to-date `main` using the naming above.
3. Touch only the files the brief lists, unless you must, and explain why in the PR.
4. Run the "How to test" steps and the full check suite.
5. Open the PR with the task ID and acceptance-criteria evidence.

## Code conventions

TypeScript strict everywhere. Shared constants and message types go in `packages/shared`. Prettier formats (`pnpm format`), ESLint lints (`pnpm lint`). Binary assets use Git LFS (see `.gitattributes`).
