# GolfWars

A free, browser-based party golf game for 2 to 8 players: wind-up toys racing to sink their balls across a giant house, bonking each other along the way. Low-poly 3D, played from a link. Hobby project, never monetised.

## Quick start

Requires Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

This starts the Colyseus server on `ws://localhost:2567` and the client on http://localhost:5173. The client is playable offline (M1 prototype, M2 Windup character): the server is optional and only drives the "Server: connected / ping N ms" label.

### Controls (M2, single player)

You are a wind-up toy (a "Windup"). Run to your ball and hit it.

| Input | Action |
| --- | --- |
| W A S D | Run, relative to the camera |
| Shift | Sprint (drains the wind-up key) |
| Space | Jump (costs a chunk of key) |
| Hold left mouse, release | Charge power (0-100%, ping-pongs) and hit the ball. Only works within 1 m of your resting ball; the Windup turns to face the aim. Esc cancels the charge |
| Right click (no drag) or F | Club "bonk": topples other Windups (not balls) |
| Middle/right mouse drag, or Q / E | Orbit the camera (the shot goes where the camera looks) |
| Mouse wheel | Zoom |
| Left / Right arrows (A / D while charging) | Fine aim |
| F3 | Debug overlay: FPS, Rapier collider wireframe, Windup and key state |

The wind-up key (top left) is your stamina: sprinting and jumping drain it, standing still rewinds it slowly, and standing next to a brass **Winding Post** (holes 2 and 3) rewinds it fast. At zero you freeze until it is rewound to 25%. A bonk topples a Windup for 1.5 s, removes 40% of its key and gives it 2 s of bonk immunity after it gets up; the swinger waits 0.8 s before the next swing. Hole 1 has two practice dummies to bonk. Falling off the table puts you back next to your ball with no penalty.

The dotted arc previews the shot. Three holes of the "Kitchen Table" course, then a scorecard.

Other scripts: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm validate-courses`. `pnpm e2e:m1` and `pnpm e2e:m2` are local Playwright checks (need Chrome and the Vite dev server, because the `?cheats` test hook only exists in dev builds; see `tools/e2e-m2.mjs`).

## Layout

```
apps/client/       Vite + Three.js browser client
apps/server/       Colyseus game server (Node, TypeScript)
packages/shared/   Shared constants, message types, ball physics and the Windup character (Rapier), key/bonk logic and golf rules
packages/courses/  Course schema (zod), Rapier collider loader and hole JSON files
packages/assets/   Game assets (Git LFS)
tools/             Dev tooling
docs/              Docs: DEPLOY.md, tasks/
```

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, PRs, commits, task briefs
- [docs/DEPLOY.md](docs/DEPLOY.md): Render + Cloudflare Pages setup
