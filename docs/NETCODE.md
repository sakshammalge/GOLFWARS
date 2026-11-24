# Netcode (M3)

Server-authoritative, up to 8 players per room, over Colyseus 0.16 WebSockets. Source: `packages/shared/src/{match,net}`, `apps/server/src/GolfRoom.ts`, `apps/client/src/{onlineGame.ts,net/}`.

## Who simulates what

| | Server | Client |
| --- | --- | --- |
| Rate | `MatchSim.tick()` at a fixed **60 Hz** (accumulator on a Node timer, catches up after a stall) | Own Windup at 60 Hz (fixed step, same shared code) |
| Windups | All of them, from client inputs only | **Predicted** for the own Windup; others interpolated |
| Balls | All of them (one Rapier world, balls only see the course, never each other) | Interpolated, never simulated (aim preview uses a scratch `GolfSim`) |
| Rules, strokes, holes, timer | Yes (`rules.ts` per player, 90 s hole timer, par + 3 on timeout) | Display only |

Each Windup walks in its own private course-only Rapier world on the server (a "lane"), built exactly like the client's prediction world. Windups never collide with anything but the course, so nothing is lost, and the client's replay is **bit-identical** to the server (a single shared world made wall-seam contacts differ by mm, because Rapier's broad-phase order depends on what else is in the world). Windup state is rounded to float32 every step, so state sent as float32 round-trips exactly.

## Messages

| Type | Dir | Rate | Content |
| --- | --- | --- | --- |
| schema state | s->c | on change | Lobby + scores (`GolfState`/`PlayerState`: nickname, colour, ready, host, connected, strokes, holed, per-hole scores, match phase, hole index, whole-second timer). Not delayed by the lag simulator |
| `in` | c->s | 30 Hz (2 ticks per packet, at once on a shot/swing) | `{seq, tick, e: [[moveX, moveZ, camYaw, flags, aimYaw\|null, shot?], ...]}`; entry `i` is tick `seq+i`; flags = sprint 1, jump 2, swing 4; `shot = [aimYaw, fineAim, power]`; `tick` = the server tick the sender's screen was showing |
| `S` | s->c | 20 Hz (every 3rd tick) | Binary snapshot, per client (see below) |
| `ev` | s->c | on event | `[{k:'shot'\|'oob'\|'holed'\|'bonk'\|'fell'\|'timeout'\|'hole', ...}]` |
| `ping` / `pong` | both | 1 Hz | `{t}` / `{t, tick}` for RTT and a server tick estimate |
| `nick color ready start rematch` | c->s | rare | Lobby actions (host only: `start`, `rematch`) |

**Snapshot `S`** (big-endian): `u32 tick, u8 hole, u8 phase|hasOwn|keyframe, u32 ack`, then the receiver's own full Windup state (53 B + hit ids: float32 position, velocity, yaw, coyote, key, bonk timers), then per player `u8 slot|flags`, status, yaw, anim, key and (only if changed since the last snapshot to this client, or on a keyframe every 2 s) the Windup and ball positions as 3 x int16 at 1/128 m. Ball rotation is derived client-side from its velocity.

Input validation: every number is checked finite and clamped, packets over 12 entries or malformed are dropped, more than 120 packets/s are ignored, the per-player queue is capped at 60 and consumed one input per tick (2 or 3 to catch up after a jitter burst, paid from a credit bucket so a speed hack cannot run faster than real time). An empty queue means the player's Windup is simply not stepped that tick.

## Prediction and reconciliation (own Windup)

The client applies each input immediately (`Predictor.step`) and keeps unacked inputs by sequence number. A snapshot carries `ack` (last input the server applied) and the Windup state after it; the client rewinds to that state (`Windup.setState`), replays the unacked inputs, and measures how far the result moved. Errors below 1.5 m are smoothed away over ~100 ms by a visual offset (`VisualSmoother`); larger ones (respawn) snap. Without bonks the error is exactly 0 (tested at 150 ms RTT). The client ignores its own `fell` event; the server respawns the Windup.

## Everything else: interpolation

Remote Windups and all balls are drawn ~100 ms (6 ticks) behind the newest data. `SnapshotClock` maps local time to server ticks from a windowed minimum of arrival times (so the 100 ms is behind what arrived, independent of RTT; it never runs backwards). `SnapshotBuffer` lerps between the two bracketing snapshots, holds the newest when starved (no extrapolation) and does not lerp across jumps over 3 m (respawn, out of bounds). `ClockSync` (pings, lowest-RTT sample wins) provides RTT and a server tick estimate for the F3 panel.

## Shots and bonks

- **Shot** = an input event. The server applies it only if the hole is in play, the player has not holed, the ball is at rest, the Windup is on its feet, not frozen and within 1.0 m of the ball (checked at the Windup position of that tick). The client plays the swing at once and locks further shots for 0.7 s; the ball flight comes from snapshots.
- **Bonk** = the swing input. The server rewinds the *victims'* positions by how far behind the attacker's screen was (`server tick - input.tick`), capped at 9 ticks (150 ms), using 12 ticks (200 ms) of position history, then runs the normal hit-box test. Topple/immunity state is current, not rewound.

## Lag simulator (`?lag=150&jitter=20&loss=2`, or the F3 sliders)

`LagSim` wraps every non-schema message in both directions: delay = RTT/2 +- jitter; a "lost" message is retransmitted after max(200 ms, 1.5 RTT) (WebSocket is reliable, so loss is delay, never a drop; repeat losses up to 4x); delivery is in order per direction (a late message blocks the ones behind it, like TCP). Unit-tested in `net.test.ts`.

## Bandwidth and CPU (`pnpm --filter @golfwars/server bench -- 8 15`, bots over real WebSockets)

| Players | Snapshots per client | All server->client bytes | Server tick (avg / max) |
| --- | --- | --- | --- |
| 2 | 1.66 KB/s, 18.8/s | 1.73 KB/s | 0.38 ms / 2.6 ms (2.3% of a 16.7 ms tick) |
| 8 | 2.90 KB/s, 19.2/s | 3.01 KB/s | 0.54 ms / 4.3 ms (3.2%) |

Payload bytes (WebSocket framing adds about 4 bytes per message, so ~+0.1 KB/s). A full 8-player keyframe is under 250 bytes. Client -> server is about 30 packets/s of ~50 bytes.

## Known limits

- Hole transitions and the end-of-match scoreboard are driven by schema state, which is not delayed by the lag simulator (real networks delay both).
- A player whose input queue runs dry (very bad connection) is paused on the server, including its bonk/key timers, rather than fed invented inputs.
- No extrapolation: during a long snapshot gap remote Windups freeze, then catch up.
- Lag-compensation rewind is capped at 150 ms, so at 150 ms RTT a bonk on a fast-running target can still miss a little.
- Rooms live in one server process; room codes are unique per process only. The free Render tier sleeps after inactivity (first connect takes 30-60 s).
- One map ("Kitchen Table", 3 holes); matches cannot be joined once started (only reconnected into).
