# GolfWars

A free, browser-based party golf game for 2 to 8 players: wind-up toys racing to sink their balls across a giant house, bonking each other along the way. Low-poly 3D, played from a link. Hobby project, never monetised.

## Quick start

Requires Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

This starts the Colyseus server on `ws://localhost:2567` and the client on http://localhost:5173. The page shows a spinning placeholder scene and "Server: connected / ping N ms".

Other scripts: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`.

## Layout

```
apps/client/       Vite + Three.js browser client
apps/server/       Colyseus game server (Node, TypeScript)
packages/shared/   Shared constants and message types
packages/courses/  Course schema and loader (M1)
packages/assets/   Game assets (Git LFS)
tools/             Dev tooling
docs/              Docs: DEPLOY.md, tasks/
```

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, PRs, commits, task briefs
- [docs/DEPLOY.md](docs/DEPLOY.md): Render + Cloudflare Pages setup
