// Local-only browser check for M4 (rules and gadgets; not run in CI: needs Chrome + WebGL).
//
//   pnpm build:libs && pnpm e2e:m4
//
// Starts its own game server (port 2598, GOLFWARS_CHEATS=1 test hook, a temporary dev balance
// file) and Vite dev server (port 5198), then drives TWO Chrome pages through a full 3-hole match:
// A walks into a crate and uses gadgets that visibly affect B, both hole out on every hole (A
// first), the podium appears, B votes and the host restarts the match with the same players.
// Screenshots go to docs/screenshots/m4-*.png. Uses the system Chrome (software GL, ~10 fps).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = `${root}docs/screenshots/`;
mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const SERVER_PORT = 2598;
const CLIENT_PORT = 5198;
const base = `http://localhost:${CLIENT_PORT}`;
const balanceFile = join(mkdtempSync(join(tmpdir(), 'golfwars-e2e-')), 'balance.dev.json');
// Software GL is slow: long hole timer, and effects that last long enough to be photographed.
const balance = (fan) =>
  JSON.stringify({
    match: { holeTimeSeconds: 600 },
    gadgets: {
      fan: { duration: fan },
      magnet: { duration: 9, pullAccel: 9 },
      bubble: { trapSeconds: 8 },
    },
  });
writeFileSync(balanceFile, balance(8));

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
  GOLFWARS_BALANCE_FILE: balanceFile,
});
run(
  'pnpm',
  ['--filter', '@golfwars/client', 'exec', 'vite', '--port', String(CLIENT_PORT), '--strictPort'],
  { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` },
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
const gw = (page, expr) => page.evaluate(`window.golfwars.${expr}`);
const shot = (page, name) => page.screenshot({ path: `${outDir}m4-${name}.png` });

try {
  const A = await newPlayer('A');
  const B = await newPlayer('B');

  // --- lobby -------------------------------------------------------------------------------
  await A.goto(`${base}/?cheats`);
  await A.fill('#nick', 'Ada');
  await A.click('#create-room');
  await A.waitForSelector('#room-code');
  const link = await A.inputValue('#share-link');
  await B.goto(`${link}&cheats`);
  await B.fill('#nick', 'Bob');
  await B.click('#join-room');
  await B.waitForSelector('#room-code');
  await waitUntil(async () => (await A.locator('.player').count()) === 2, 'A sees 2 players');
  await A.locator('.swatch').nth(2).click();
  await B.locator('.swatch').nth(5).click();
  await A.click('#ready-toggle');
  await B.click('#ready-toggle');
  await sleep(500);

  // --- hole intro (3 s banner, nobody can act) -----------------------------------------------
  await A.click('#start-match');
  await A.waitForSelector('#hud-banner:not([hidden])', { timeout: 20000 });
  await shot(A, 'hole-intro');
  const bannerText = await A.innerText('#hud-banner');
  assert(
    /Hole 1/.test(bannerText) && /Straight Shot/.test(bannerText),
    `intro banner: ${bannerText.replace(/\n/g, ' / ')}`,
  );
  await waitUntil(async () => (await st(A))?.ready && (await st(B))?.ready, 'first snapshots');
  await waitUntil(async () => (await st(A)).phase === 'playing', 'hole 1 in play', 40000);
  const sa = await st(A);
  const sb = await st(B);
  assert(sa.slot !== sb.slot, 'two different seats');
  assert(
    (await gw(A, 'balance().fanDuration')) === 8,
    'the dev balance file was applied on the client',
  );

  // Hot reload while the match runs: both clients get the new number.
  writeFileSync(balanceFile, balance(9));
  await waitUntil(
    async () =>
      (await gw(A, 'balance().fanDuration')) === 9 && (await gw(B, 'balance().fanDuration')) === 9,
    'balance hot reload reached both clients',
  );

  // --- A walks into a crate (real keys) and gets a gadget -------------------------------------
  assert((await gw(A, 'gadget()')) === null, 'A starts with no gadget');
  await A.evaluate(() => window.golfwars.toCrate(0, -1.6)); // 1.6 m west of the east-nook crate
  await waitUntil(async () => {
    const s = await st(A);
    return Math.hypot(s.own.pos[0] - 2.4, s.own.pos[2] - 2.0) < 0.6;
  }, 'A stands in the east nook');
  await A.keyboard.down('KeyD');
  await waitUntil(async () => (await gw(A, 'gadget()')) !== null, 'A picked up the crate', 15000);
  await A.keyboard.up('KeyD');
  const got = await gw(A, 'gadget()');
  assert(
    ['bubble', 'gum', 'fan', 'magnet'].includes(got),
    `A got a gadget from the crate (${got})`,
  );
  assert(((await gw(A, 'crateMask()')) & 1) === 0, 'the crate is empty for everyone');
  assert(
    (await gw(B, 'gadget()')) === null && ((await gw(B, 'crateMask()')) & 1) === 0,
    "B sees the crate gone but not A's gadget",
  );
  await sleep(400);
  await shot(A, 'crate-pickup');

  // --- the four gadgets, A uses, B is affected ------------------------------------------------
  const noEffects = async () =>
    waitUntil(
      async () => (await A.evaluate(() => window.golfwars.effects().length)) === 0,
      'previous effects are over',
      30000,
    );
  const stage = async ({ a = [0, 4], b = [0, 1.5], bBall = [0, 0], aBall = [0.9, 6] } = {}) => {
    await noEffects();
    await A.evaluate(([x, z]) => window.golfwars.ballAt(x, z), aBall);
    await B.evaluate(([x, z]) => window.golfwars.ballAt(x, z), bBall);
    await A.evaluate(([x, z]) => window.golfwars.tp(x, z, 0), a);
    await B.evaluate(([x, z]) => window.golfwars.tp(x, z, 0), b);
    await waitUntil(async () => {
      const [x, y] = await Promise.all([st(A), st(B)]);
      return (
        Math.hypot(x.own.pos[0] - a[0], x.own.pos[2] - a[1]) < 0.3 &&
        Math.hypot(y.own.pos[0] - b[0], y.own.pos[2] - b[1]) < 0.3 &&
        y.ownBall &&
        Math.hypot(y.ownBall.pos[0] - bBall[0], y.ownBall.pos[2] - bBall[1]) < 0.3
      );
    }, 'both staged');
    await sleep(400);
  };
  const use = async (g) => {
    await A.evaluate((name) => window.golfwars.giveGadget(name), g);
    await waitUntil(async () => (await gw(A, 'gadget()')) === g, `A holds ${g}`);
    await sleep(900); // use cooldown
    await A.keyboard.press('KeyQ');
    await waitUntil(async () => (await gw(A, 'gadget()')) === null, `${g} used (slot empty)`);
  };
  const seenBy = (page, kind) =>
    page.evaluate((k) => window.golfwars.effects().some((e) => e.kind === k), kind);

  // Bubble Wand: B's ball (4 m ahead) is trapped and cannot be hit.
  await stage({ b: [1.1, -4.2], bBall: [0, -5] });
  await use('bubble');
  await sleep(450);
  await shot(A, 'gadget-bubble'); // the bubble in flight
  await waitUntil(
    async () => (await st(B)).ownBall?.phase === 'trapped',
    "B's ball is trapped by A's bubble",
  );
  await sleep(300);
  await shot(B, 'gadget-bubble-trapped'); // B's view: its own ball in the bubble
  assert((await st(B)).canShoot === false, 'B cannot hit its trapped ball');

  // Desk Fan: B, standing 2 m in front of A, is blown away without touching anything.
  await stage({ b: [0, 2], bBall: [0.6, 1.4] });
  const bz0 = (await st(B)).own.pos[2];
  await use('fan');
  await waitUntil(async () => await seenBy(B, 'fan'), 'B receives the fan effect');
  await sleep(700);
  await shot(A, 'gadget-fan');
  await shot(B, 'gadget-fan-B');
  await waitUntil(
    async () => (await st(B)).own.pos[2] < bz0 - 0.8,
    "B's Windup was pushed away by the wind",
  );

  // Fridge Magnet: B's rolling ball is bent towards A's ball.
  await stage({ a: [0, 1.4], b: [2, 4], aBall: [0, 0.5], bBall: [1.3, 3.2] });
  await use('magnet');
  await waitUntil(async () => await seenBy(B, 'magnet'), 'B receives the magnet effect');
  await B.evaluate(() => window.golfwars.shootBall(0, 0.25)); // slow roll along -z past A's ball
  await sleep(700);
  await shot(A, 'gadget-magnet');
  await waitUntil(
    async () => (await st(B)).ownBall.pos[0] < 1.12,
    "B's ball curved towards A's ball",
  );

  // Gum Blob: a patch in front of A; B's ball stops dead in it.
  await stage({ a: [0, 4], b: [1.2, 5.5], bBall: [0, 0.4], aBall: [0.9, 6.4] });
  await use('gum');
  await waitUntil(async () => await seenBy(B, 'gum'), 'B receives the gum patch');
  await B.evaluate(() => window.golfwars.shootBall(Math.PI, 0.35)); // roll towards +z into the patch
  await waitUntil(
    async () => {
      const b = (await st(B)).ownBall;
      return b.phase === 'resting' && b.pos[2] > 1.2 && b.pos[2] < 3.5;
    },
    "B's ball stopped dead in the gum",
    20000,
  );
  await shot(A, 'gadget-gum');

  // --- hole 1 ends: A holes out first (-2), B second (-1) ------------------------------------
  await A.evaluate(() => window.golfwars.cheat('holeout'));
  await waitUntil(
    async () => (await st(A)).players.find((p) => p.slot === sa.slot)?.holed,
    'A holed out',
  );
  await sleep(300);
  await B.evaluate(() => window.golfwars.cheat('holeout'));
  await A.waitForSelector('#hole-results:not([hidden])', { timeout: 20000 });
  await sleep(400);
  await shot(A, 'hole-end');
  const rows = await A.locator('#hole-results tbody tr, #hole-results tr').allInnerTexts();
  assert(
    rows.length >= 3,
    `hole results list both players (${rows.join(' | ').replace(/\s+/g, ' ')})`,
  );
  assert(/Ada/.test(rows[1]) && /-2/.test(rows[1]), 'Ada is 1st on the hole with the -2 bonus');
  assert(/Bob/.test(rows[2]) && /-1/.test(rows[2]), 'Bob is 2nd on the hole with the -1 bonus');

  // --- holes 2 and 3 ----------------------------------------------------------------------------
  for (const hole of [1, 2]) {
    await waitUntil(
      async () => (await st(A)).phase === 'playing' && (await st(A)).hole === hole,
      `hole ${hole + 1} in play`,
      60000,
    );
    await A.evaluate(() => window.golfwars.cheat('holeout'));
    await sleep(300);
    await B.evaluate(() => window.golfwars.cheat('holeout'));
    await sleep(500);
  }

  // --- results: podium and table ------------------------------------------------------------
  await A.waitForSelector('#match-board:not([hidden])', { timeout: 60000 });
  await sleep(700);
  await shot(A, 'podium');
  const podium = await A.locator('#match-board .podium .step').allInnerTexts();
  assert(
    podium.length === 2,
    `podium has both players (${podium.join(' | ').replace(/\s+/g, ' ')})`,
  );
  assert(
    /Ada/.test(podium[0]) === false || /1st/.test(podium.find((t) => /Ada/.test(t))),
    'Ada wins',
  );
  const table = (await A.locator('#match-board tr').allInnerTexts())
    .join(' | ')
    .replace(/\s+/g, ' ');
  assert(/Ada.*-3/.test(table), `Ada's total is -3 (3 strokes - 6 bonus): ${table}`);
  assert(/Bob.* 0/.test(table), "Bob's total is 0");

  // --- rematch vote, host restarts with the same players --------------------------------------
  await B.waitForSelector('#rematch-vote');
  assert((await B.locator('#rematch-again').count()) === 0, 'only the host can restart');
  await B.click('#rematch-vote');
  await waitUntil(
    async () => /1 of 2/.test(await A.innerText('#rematch-tally')),
    'the vote shows up for the host',
  );
  await A.click('#rematch-again');
  await waitUntil(async () => {
    const s = await st(A);
    return s.hole === 0 && s.roomPhase === 'match' && s.players.length === 2;
  }, 'rematch: hole 1 again, same two players');
  await A.waitForSelector('#hud-banner:not([hidden])', { timeout: 20000 });
  await shot(A, 'rematch');
  assert(
    (await st(A)).players.every((p) => p.strokes === 0),
    'scores were reset for the rematch',
  );

  assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log('\nM4 e2e passed');
} catch (e) {
  console.error(e);
  if (errors.length) console.error('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  stopAll();
}
