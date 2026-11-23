# GolfWars

A free, browser-based party golf game for 2 to 8 players: wind-up toys racing to sink their balls across a giant house, bonking each other along the way. Low-poly 3D, played from a link. Hobby project, never monetised.

## Quick start

Requires Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

This starts the Colyseus server on `ws://localhost:2567` and the client on http://localhost:5173. The client is playable offline (M1): the server is optional and only drives the "Server: connected / ping N ms" label.

### Controls (M1, single player)

| Input | Action |
| --- | --- |
| Hold left mouse, release | Charge power (0-100%, ping-pongs) and shoot. Esc cancels the charge |
| Right/middle mouse drag, or Q / E | Orbit the camera (the shot goes where the camera looks) |
| Mouse wheel | Zoom |
| A / D | Fine aim left / right |
| F3 | Debug overlay: FPS and Rapier collider wireframe |

The dotted arc previews the shot. Three holes of the "Kitchen Table" course, then a scorecard.

Other scripts: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm validate-courses`. `pnpm e2e:m1` is a local Playwright check (needs Chrome; see `tools/e2e-m1.mjs`).

## Layout

```
apps/client/       Vite + Three.js browser client
apps/server/       Colyseus game server (Node, TypeScript)
packages/shared/   Shared constants, message types, ball physics (Rapier) and golf rules
packages/courses/  Course schema (zod), Rapier collider loader and hole JSON files
packages/assets/   Game assets (Git LFS)
tools/             Dev tooling
docs/              Docs: DEPLOY.md, tasks/
```

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, PRs, commits, task briefs
- [docs/DEPLOY.md](docs/DEPLOY.md): Render + Cloudflare Pages setup
