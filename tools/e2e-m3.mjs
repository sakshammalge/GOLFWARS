// Local-only browser check for M3 online multiplayer (not run in CI: needs Chrome + WebGL).
//
//   pnpm build:libs && pnpm e2e:m3
//
// Starts its own game server (port 2599, with the GOLFWARS_CHEATS test hook) and Vite dev server
// (port 5199), then drives TWO Chrome pages with 150 ms of simulated RTT (?lag=150): both join one
// room by code, see each other's Windup, one shoots; screenshots go to docs/screenshots/m3-*.png.
// Uses the system Chrome (software GL, so ~10 fps: the netcode is meant to cope with that).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = `${root}docs/screenshots/`;
mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const SERVER_PORT = 2599;
const CLIENT_PORT = 5199;
const LAG = process.env.E2E_LAG ?? '150';
const base = `http://localhost:${CLIENT_PORT}`;

const children = [];
function run(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(p);
  return p;
}
const stopAll = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', stopAll);

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, msg, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`TIMEOUT waiting for: ${msg}`);
    await sleep(100);
  }
}
async function waitHttp(url) {
  await waitUntil(
    async () =>
      fetch(url)
        .then((r) => r.ok)
        .catch(() => false),
    url,
    60000,
  );
}

run('pnpm', ['--filter', '@golfwars/server', 'exec', 'tsx', 'src/index.ts'], {
  PORT: String(SERVER_PORT),
  GOLFWARS_CHEATS: '1',
});
run(
  'pnpm',
  ['--filter', '@golfwars/client', 'exec', 'vite', '--port', String(CLIENT_PORT), '--strictPort'],
  {
    VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}`,
  },
);
await waitHttp(`http://localhost:${SERVER_PORT}/health`);
await waitHttp(base);

const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${name}: ${m.text()}`);
  });
  return page;
}
const st = (page) => page.evaluate(() => window.golfwars?.state());
const shot = (page, name) => page.screenshot({ path: `${outDir}m3-${name}.png` });

try {
  const A = await newPlayer('A');
  const B = await newPlayer('B');
  const q = `cheats&lag=${LAG}&jitter=20`;

  // --- lobby -------------------------------------------------------------------------------
  await A.goto(`${base}/?${q}`);
  await A.fill('#nick', 'Ada');
  await A.click('#create-room');
  await A.waitForSelector('#room-code');
  const code = (await A.innerText('#room-code')).trim();
  assert(/^[A-HJ-NP-Z]{5}$/.test(code), `room code looks right (${code})`);

  // B opens the share link.
  const link = await A.inputValue('#share-link');
  assert(link.includes(`?room=${code}`), 'share link carries the room code');
  await B.goto(`${link}&${q}`);
  assert((await B.inputValue('#code')) === code, 'join box is pre-filled from the link');
  await B.fill('#nick', 'Bob');
  await B.click('#join-room');
  await B.waitForSelector('#room-code');
  await waitUntil(async () => (await A.locator('.player').count()) === 2, 'A sees 2 players');
  await waitUntil(async () => (await B.locator('.player').count()) === 2, 'B sees 2 players');
  await A.locator('.swatch').nth(2).click(); // Ada picks green
  await B.locator('.swatch').nth(5).click(); // Bob picks orange
  await A.click('#ready-toggle');
  await B.click('#ready-toggle');
  await sleep(600);
  await shot(A, 'lobby');
  assert((await A.locator('.ready.on').count()) === 2, 'both players show Ready');

  // --- match ---------------------------------------------------------------------------------
  await A.click('#start-match');
  await waitUntil(
    async () => (await st(A))?.ready && (await st(B))?.ready,
    'both clients got their first snapshot',
  );
  await waitUntil(async () => (await st(A)).phase === 'playing', 'hole 1 in play');
  const sa = await st(A);
  const sb = await st(B);
  assert(sa.slot !== sb.slot, 'two different seats');
  assert(
    sa.remotes.some((r) => r.slot === sb.slot),
    "A sees B's Windup",
  );
  assert(
    sb.remotes.some((r) => r.slot === sa.slot),
    "B sees A's Windup",
  );
  assert(sa.net.rttMs > 100, `simulated RTT is in effect (${sa.net.rttMs.toFixed(0)} ms)`);

  await sleep(500);
  await shot(A, 'both-in-view-A');
  await shot(B, 'both-in-view-B');
  await A.keyboard.press('F3');
  await sleep(400);
  await shot(A, 'netpanel');
  await A.keyboard.press('F3');

  // A runs forward; B must see A's Windup move.
  const bView = async () => (await st(B)).remotes.find((r) => r.slot === sa.slot)?.windup;
  const before = await bView();
  await A.mouse.move(640, 360);
  await A.keyboard.down('KeyW');
  await sleep(1500);
  await A.keyboard.up('KeyW');
  await waitUntil(async () => {
    const now = await bView();
    return now && Math.hypot(now[0] - before[0], now[2] - before[2]) > 1;
  }, "B sees A's Windup run");
  const a2 = await st(A);
  assert(a2.predErrorCm < 5, `A's prediction error is small (${a2.predErrorCm.toFixed(2)} cm)`);

  // A walks back to the ball and shoots towards the cup.
  const walkTo = async (page, x, z, tol = 0.5) => {
    for (let i = 0; i < 60; i++) {
      const s = await st(page);
      const dx = x - s.own.pos[0];
      const dz = z - s.own.pos[2];
      if (Math.hypot(dx, dz) < tol) return;
      // camera yaw 0: forward = -z, right = +x
      const keys = [];
      if (dz < -tol / 2) keys.push('KeyW');
      if (dz > tol / 2) keys.push('KeyS');
      if (dx > tol / 2) keys.push('KeyD');
      if (dx < -tol / 2) keys.push('KeyA');
      for (const k of keys) await page.keyboard.down(k);
      await sleep(Math.min(400, Math.hypot(dx, dz) * 120));
      for (const k of keys) await page.keyboard.up(k);
      await sleep(150);
    }
    throw new Error('walkTo failed');
  };
  await A.evaluate(() => window.golfwars.orbitCamera(-window.golfwars.state().cameraYaw));
  const ball = (await st(A)).ownBall.pos;
  await walkTo(A, ball[0] + 0.4, ball[2] + 0.4, 0.5);
  await waitUntil(async () => (await st(A)).canShoot, 'A can shoot');
  const cup = [0, 0, -7];
  await A.evaluate(([x, z]) => window.golfwars.aimCameraAt(x, z), [cup[0], cup[2]]);
  await sleep(300);
  await A.mouse.move(640, 360);
  await A.mouse.down();
  await sleep(500);
  await A.screenshot({ path: `${outDir}m3-charging.png` });
  await A.mouse.up();
  await waitUntil(async () => (await st(A)).strokes === 1, 'A stroke counted by the server');
  await waitUntil(
    async () => (await st(B)).players.find((p) => p.slot === sa.slot)?.strokes === 1,
    'B sees A on 1 stroke',
  );
  const bBall = async () => (await st(B)).allBalls.find((b) => b.slot === sa.slot).ball;
  await waitUntil(async () => {
    const b = await bBall();
    return Math.hypot(b[0] - ball[0], b[2] - ball[2]) > 1;
  }, "B sees A's ball fly");
  await sleep(400);
  await shot(A, 'ball-flight-A');
  await shot(B, 'ball-flight-B');
  assert((await st(B)).strokes === 0, "B's own stroke count is unaffected");

  // --- reconnect: B refreshes the tab (T3.5) and a network blip hits A ------------------------------
  await B.reload();
  await waitUntil(async () => (await st(B))?.ready, 'B is back in the match after a refresh');
  const sb2 = await st(B);
  assert(sb2.slot === sb.slot, `B got the same seat back after a refresh (slot ${sb2.slot})`);
  assert(
    sb2.players.find((p) => p.slot === sa.slot)?.strokes === 1,
    'B still sees the right scores',
  );
  await A.evaluate(() => window.golfwars.drop());
  await A.waitForSelector('#conn-overlay:not([hidden])', { timeout: 10000 });
  await A.waitForSelector('#conn-overlay[hidden]', { state: 'attached', timeout: 20000 });
  await waitUntil(
    async () => (await st(A)).ready && (await st(A)).strokes === 1,
    'A is back after a network blip',
  );
  assert((await st(A)).slot === sa.slot, 'A kept its seat and stroke count after the blip');

  // --- scoreboard (uses the server test hook to hole out quickly) ----------------------------------
  for (let hole = 0; hole < 3; hole++) {
    await waitUntil(
      async () => (await st(A)).phase === 'playing' && (await st(A)).hole === hole,
      `hole ${hole + 1} in play`,
      40000,
    );
    // The cheat message goes through the client connection's lag wrapper like everything else.
    for (const p of [A, B]) await p.evaluate(() => window.golfwars.cheat('holeout'));
    await sleep(500);
  }
  await A.waitForSelector('#match-board:not([hidden])', { timeout: 40000 });
  await sleep(500);
  await shot(A, 'scoreboard');
  assert(
    (await A.locator('#match-board tbody tr, #match-board tr').count()) >= 3,
    'scoreboard lists both players',
  );

  assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log('\nM3 e2e passed');
} catch (e) {
  console.error(e);
  if (errors.length) console.error('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  stopAll();
}
