# tools

Dev scripts.

- `validate-courses.mjs`: loads every `packages/courses/holes/*.json`, checks the schema and that the tee and cup sit on a floor and a ball rests on the tee in the physics sim. Run with `pnpm validate-courses` (also runs in CI).
- `e2e-m1.mjs`, `e2e-m2.mjs`: local Playwright checks (system Chrome, software GL) that play the game and save screenshots to `docs/screenshots/`. They need the Vite dev server (`pnpm --filter @golfwars/client dev`) because the `?cheats` test hook is dev-only. Not run in CI.
