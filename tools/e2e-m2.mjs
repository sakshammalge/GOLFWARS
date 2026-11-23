// Local-only browser check for M2 (not run in CI: it needs a Chrome binary and WebGL).
//
//   pnpm build:libs && pnpm --filter @golfwars/client dev     # serves http://localhost:5173
//   pnpm e2e:m2                                               # or GOLFWARS_URL=... pnpm e2e:m2
//
// It must run against the Vite DEV server: the `?cheats` test hook (state read-out, hole skip,
// camera aim) is stripped from production builds. Walks the Windup to its ball and shoots,
// sprints until the key is gone, bonks a practice dummy and saves screenshots to
// docs/screenshots/m2-*.png. Uses the system Chrome (software GL).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.env.GOLFWARS_URL ?? 'http://localhost:5173';
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const outDir = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (
    m.type() === 'error' &&
    !/WebSocket|ERR_CONNECTION|Failed to load resource|Could not connect to server/.test(m.text())
  )
    errors.push(m.text());
});

const shot = (name) => page.screenshot({ path: `${outDir}m2-${name}.png` });
const text = (sel) => page.locator(sel).innerText();
const state = () => page.evaluate(() => window.golfwars.state());
const sleep = (ms) => page.waitForTimeout(ms);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
};
const waitFor = async (fn, msg, timeout = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`TIMEOUT waiting for: ${msg}`);
    await sleep(50);
  }
};

/**
 * Walks to a world point with W/A/S/D key presses (camera yaw must be 0). Software GL runs at
 * ~10 fps, so it moves in short key pulses sized to the remaining distance and re-reads the state
 * between them instead of steering continuously.
 */
async function walkTo(x, z, tol = 0.45, sprint = false) {
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    const [px, , pz] = s.player.pos;
    const dx = x - px;
    const dz = z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist < tol) break;
    if (Date.now() - t0 > 30000) throw new Error(`walkTo (${x}, ${z}) timed out at ${px}, ${pz}`);
    const speed = sprint ? 8 : 4.5;
    const pulse = Math.min(700, Math.max(160, (dist / speed) * 1000 * 0.7));
    const want = new Set();
    if (dz < -0.1) want.add('KeyW');
    if (dz > 0.1) want.add('KeyS');
    if (dx < -0.1) want.add('KeyA');
    if (dx > 0.1) want.add('KeyD');
    if (sprint) await page.keyboard.down('ShiftLeft');
    for (const k of want) await page.keyboard.down(k);
    await sleep(pulse);
    for (const k of keys) await page.keyboard.up(k);
    if (sprint) await page.keyboard.up('ShiftLeft');
    await sleep(250);
  }
}

try {
  await page.goto(`${base}/?cheats`);
  await page.waitForFunction(() => window.golfwars?.state, null, { timeout: 30000 });
  await waitFor(async () => (await state()).phase === 'playing', 'hole 1 in play');
  await sleep(800);

  // 1. Windup idles next to its ball, in reach.
  let s = await state();
  assert(s.canShoot, 'Windup starts within reach of its ball (can charge)');
  assert(/Hold left mouse/.test(await text('#hud-prompt')), 'prompt says how to hit the ball');
  assert(s.dummies.length === 2, 'two practice dummies on hole 1');
  await shot('idle-next-to-ball');

  // 2. Walk away: shooting is not allowed out of reach.
  await walkTo(0, 3.5, 0.5);
  s = await state();
  assert(!s.canShoot, 'cannot shoot when far from the ball');
  await page.mouse.move(640, 300);
  await page.mouse.down();
  await sleep(250);
  assert(!(await page.locator('#hud-meter').isVisible()), 'no power meter when out of reach');
  await page.mouse.up();
  assert(/Strokes 0/.test(await text('#hud-strokes')), 'no stroke when out of reach');
  assert(
    /Walk up to your ball/.test(await text('#hud-prompt')),
    'prompt tells you to walk to the ball',
  );

  // 3. Walk back to the ball, charge and shoot.
  await walkTo(s.ball[0], s.ball[2], 0.7);
  assert((await state()).canShoot, 'back within reach of the ball: can charge');
  await page.mouse.down();
  await sleep(700);
  await shot('charging');
  assert(await page.locator('#hud-meter').isVisible(), 'power meter visible while charging');
  await page.mouse.up();
  await sleep(200);
  assert(/Strokes 1/.test(await text('#hud-strokes')), 'stroke counter incremented after the shot');
  await sleep(1200);
  await shot('ball-rolling-camera-follows-ball');
  await waitFor(async () => (await state()).ballState === 'resting', 'ball at rest', 30000);
  assert(true, 'ball came to rest');

  // 4. Sprint until the key runs out (alternating directions to stay on the course).
  await page.keyboard.down('ShiftLeft');
  let lowShot = false;
  const t0 = Date.now();
  let dir = 0;
  for (;;) {
    s = await state();
    if (s.player.frozen) break;
    if (Date.now() - t0 > 30000) throw new Error('key never ran out');
    if (!lowShot && s.player.key < 0.3) {
      await shot('key-low');
      lowShot = true;
    }
    const goingUp = s.player.pos[2] > -3 && dir === 0;
    if (s.player.pos[2] < -2) dir = 1;
    if (s.player.pos[2] > 5) dir = 0;
    await page.keyboard.down(dir === 0 ? 'KeyW' : 'KeyS');
    await page.keyboard.up(dir === 0 ? 'KeyS' : 'KeyW');
    void goingUp;
    await sleep(50);
  }
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyS');
  assert(lowShot, 'key meter was seen low before freezing');
  await sleep(500);
  s = await state();
  assert(s.player.status === 'frozen', 'Windup is frozen at zero key');
  assert(await page.locator('#hud-key.frozen').count(), 'HUD key meter shows frozen');
  const frozenAt = s.player.pos;
  await page.keyboard.down('KeyW');
  await sleep(500);
  await page.keyboard.up('KeyW');
  const after = (await state()).player.pos;
  assert(
    Math.hypot(after[0] - frozenAt[0], after[2] - frozenAt[2]) < 0.05,
    'frozen Windup cannot move',
  );
  await shot('key-frozen');
  await waitFor(
    async () => !(await state()).player.frozen,
    'key rewound enough to unfreeze',
    20000,
  );
  assert(true, 'standing still rewinds the key until it unfreezes');

  // 5. Bonk a dummy with a right click.
  const target = (await state()).dummies[1];
  const aim = (d) =>
    page.evaluate(([x, z]) => window.golfwars.aimCameraAt(x, z), [d.pos[0], d.pos[2]]);
  for (;;) {
    s = await state();
    const d = s.dummies[1];
    const dist = Math.hypot(d.pos[0] - s.player.pos[0], d.pos[2] - s.player.pos[2]);
    if (dist < 1.3) break;
    await aim(d);
    await page.keyboard.down('KeyW');
    await sleep(50);
  }
  await page.keyboard.up('KeyW');
  await sleep(250);
  await aim((await state()).dummies[1]);
  await sleep(100);
  await page.mouse.click(640, 400, { button: 'right' });
  await waitFor(async () => (await state()).dummies[1].status === 'topple', 'dummy toppled', 2000);
  assert(true, 'right click bonks a dummy: it toppled');
  // Look at the scene from the side while the dummy lies on the floor.
  await page.evaluate(() => window.golfwars.orbitCamera(0.9, 0.1));
  await sleep(500);
  await shot('dummy-toppled');
  s = await state();
  assert(s.dummies[1].key < 0.7, 'bonk removed key from the dummy');
  assert(s.dummies[0].status === 'idle', 'the other dummy was not affected');
  await waitFor(async () => (await state()).dummies[1].status !== 'topple', 'dummy gets up', 3000);
  assert((await state()).dummies[1].immune, 'dummy is immune after getting up');
  assert(target.id === s.dummies[1].id, 'same dummy');

  // 6. Winding Post on hole 2: sprint a bit, then stand next to the post and watch the key refill.
  await page.evaluate(() => window.golfwars.holeOut(2));
  await waitFor(
    async () => {
      const st = await state();
      return st.hole === 1 && st.phase === 'playing';
    },
    'hole 2 in play',
    20000,
  );
  await sleep(500);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(2400);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await sleep(200);
  s = await state();
  const before = s.player.key;
  assert(before < 0.7, `sprinting drained the key (${before.toFixed(2)})`);
  await walkTo(1.05, 0.75 + 1.1, 0.45);
  const t1 = Date.now();
  await sleep(1800);
  s = await state();
  assert(
    s.player.key > before + 0.4,
    `standing by the Winding Post rewinds fast (${before.toFixed(2)} -> ${s.player.key.toFixed(2)} in ${Date.now() - t1} ms)`,
  );
  await shot('winding-post');

  assert(errors.length === 0, `no page errors (${errors.join('; ')})`);
  console.log('E2E M2 OK, screenshots in docs/screenshots/m2-*.png');
} catch (err) {
  console.error(err);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
