# tools

Dev scripts.

- `validate-courses.mjs`: loads every `packages/courses/holes/*.json`, checks the schema and that the tee and cup sit on a floor and a ball rests on the tee in the physics sim. Run with `pnpm validate-courses` (also runs in CI).
- `e2e-m1.mjs`, `e2e-m2.mjs`: local Playwright checks (system Chrome, software GL) that play the game and save screenshots to `docs/screenshots/`. They need the Vite dev server (`pnpm --filter @golfwars/client dev`) because the `?cheats` test hook is dev-only. Not run in CI.
- `e2e-m3.mjs`: local two-browser Playwright smoke test of online multiplayer at 150 ms simulated lag (`pnpm e2e:m3`). It starts its own server (port 2599, `GOLFWARS_CHEATS=1` hole-out hook) and Vite dev server (port 5199), so nothing else needs to be running. Saves `docs/screenshots/m3-*.png`. Not run in CI.
