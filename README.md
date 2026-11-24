# GolfWars

A free, browser-based party golf game for 2 to 8 players: wind-up toys racing to sink their balls across a giant house, bonking each other along the way. Low-poly 3D, played from a link. Hobby project, never monetised.

## Quick start

Requires Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

This starts the Colyseus server on `ws://localhost:2567` and the client on http://localhost:5173. Open the page and pick **Play solo offline** (no server needed), or **Create room** to play online with friends.

### Playing with friends (M3 online multiplayer)

1. Run `pnpm dev`, open http://localhost:5173 and press **Create room**. You get a 5-letter room code and a share link such as `http://localhost:5173/?room=KQZMT`.
2. Friends open that link (or enter the code under **Join room**). In the lobby everyone picks a nickname (remembered in your browser) and a unique colour, and presses **I'm ready**. The host (first player) presses **Start match**: 2 to 8 players play the three Kitchen Table holes at the same time, each with their own ball. A hole ends when everyone has holed out, or after 90 s (unfinished players score par + 3). Then a scoreboard shows everyone.
3. **Same Wi-Fi / LAN:** the client dev server listens on all interfaces and the client talks to `ws://<the page's host>:2567`, so friends just open `http://<your-LAN-IP>:5173/?room=KQZMT` (find your IP with `ip addr` / `ipconfig`; allow ports 5173 and 2567 in your firewall). If the server runs elsewhere, set `VITE_SERVER_URL=ws://host:2567` (see `apps/client/.env.example`) before `pnpm dev` / `pnpm build`.
4. Refreshing the tab or a network blip is fine: the game rejoins your seat (same colour, ball and score) for up to 60 s; after that you are scored par + 3 for unfinished holes.
5. Press **F3** for the netcode panel: RTT, snapshot rate, prediction error, and sliders to simulate lag (RTT, jitter, packet loss). `?lag=150&jitter=20&loss=2` in the URL starts with it on.

How it works: [docs/NETCODE.md](docs/NETCODE.md).

### Controls

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

Other scripts: `pnpm --filter @golfwars/server bench -- 8 15` (8 bot players, server CPU and bandwidth), `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm validate-courses`. `pnpm e2e:m1` and `pnpm e2e:m2` are local Playwright checks (need Chrome and the Vite dev server, because the `?cheats` test hook only exists in dev builds; see `tools/e2e-m2.mjs`). `pnpm e2e:m3` starts its own server and Vite and drives two Chrome pages through the lobby and a match at 150 ms simulated lag.

## Layout

```
apps/client/       Vite + Three.js browser client
apps/server/       Colyseus game server (Node, TypeScript): the `golf` room, lobby schema, match loop
packages/shared/   Shared constants, message types, ball physics, the Windup character (Rapier), key/bonk logic, golf rules, `MatchSim` and the netcode (snapshots, prediction, interpolation, lag sim)
packages/courses/  Course schema (zod), Rapier collider loader and hole JSON files
packages/assets/   Game assets (Git LFS)
tools/             Dev tooling
docs/              Docs: DEPLOY.md, tasks/
```

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, PRs, commits, task briefs
- [docs/NETCODE.md](docs/NETCODE.md): tick rates, messages, prediction, lag compensation, bandwidth
- [docs/DEPLOY.md](docs/DEPLOY.md): Render + Cloudflare Pages setup
