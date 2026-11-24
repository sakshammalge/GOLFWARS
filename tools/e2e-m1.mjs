// Local-only browser check for M1 (not run in CI: it needs a Chrome binary and WebGL).
//
//   pnpm build:libs && pnpm --filter @golfwars/client dev   # serves http://localhost:5173
//   pnpm e2e:m1                                             # or GOLFWARS_URL=... pnpm e2e:m1
//
// It must run against the Vite DEV server: the `?cheats` hook is stripped from production builds.
// Since M2 the ball is hit by walking up to it, and the Windup starts beside the ball, so the
// scripted shot below still works; M2 behaviour is covered by tools/e2e-m2.mjs.
//
// Plays a scripted round with Playwright, asserts the stroke counter / banners / scorecard and
// saves screenshots to docs/screenshots/m1-*.png. Uses the system Chrome (software GL).
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

const shot = (name) => page.screenshot({ path: `${outDir}m1-${name}.png` });
const text = (sel) => page.locator(sel).innerText();
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
};
const waitBannerGone = () =>
  page.waitForSelector('#hud-banner', { state: 'hidden', timeout: 10000 });
const waitBanner = (re) =>
  page.waitForFunction(
    (src) => new RegExp(src).test(document.querySelector('#hud-banner')?.textContent ?? ''),
    re.source,
    { timeout: 10000 },
  );

try {
  await page.goto(`${base}/?cheats`);
  await page.click('#play-solo'); // M3: the menu comes first; solo offline keeps the old game
  await page.waitForSelector('#hud-banner:not([hidden])');
  assert(/Hole 1 . Straight Shot . Par 2/.test(await text('#hud-banner')), 'hole 1 intro banner');
  await page.waitForTimeout(500);
  await shot('hole1-intro');
  await waitBannerGone();
  await page.waitForTimeout(800);
  await shot('hole1-start');
  assert(/Strokes 0/.test(await text('#hud-strokes')), 'stroke counter starts at 0');

  // Charge a shot: mouse down, wait, screenshot with meter and arc, release.
  await page.mouse.move(640, 300);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await shot('charge');
  assert(await page.locator('#hud-meter').isVisible(), 'power meter visible while charging');
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert(/Strokes 1/.test(await text('#hud-strokes')), 'stroke counter incremented after shot');
  assert(!(await page.locator('#hud-meter').isVisible()), 'power meter hidden after release');
  await page.waitForTimeout(1200);
  await shot('rolling');

  // Escape cancels a charge: no stroke.
  await page.waitForTimeout(9000); // let the ball come to rest
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert(/Strokes 1/.test(await text('#hud-strokes')), 'Escape cancels the charge (no stroke)');

  // F3 debug overlay with collider wireframe.
  await page.keyboard.press('F3');
  await page.waitForTimeout(500);
  await shot('debug');
  assert(/FPS/.test(await text('#debug')), 'F3 shows FPS overlay');
  await page.keyboard.press('F3');

  // Finish the round with cheats to see banners and the scorecard.
  const cheat = (n) => page.evaluate((s) => window.golfwars.holeOut(s), n);
  assert(await cheat(2), 'hole 1 completed (2 strokes)');
  await waitBanner(/Par/);
  await page.waitForTimeout(300);
  await shot('hole-end');
  await waitBanner(/Hole 2 . Dogleg . Par 3/);
  await waitBannerGone();
  await page.waitForTimeout(500);
  await shot('hole2-start');
  await cheat(4);
  await waitBanner(/Hole 3 . Bumper Field . Par 3/);
  await waitBannerGone();
  await page.waitForTimeout(500);
  await shot('hole3-start');
  await cheat(3);
  await page.waitForSelector('#scorecard:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  await shot('scorecard');
  const card = await text('#scorecard');
  assert(/Total/.test(card) && /\+1/.test(card), 'scorecard shows total +1 (9 vs par 8)');

  await page.click('#play-again');
  await waitBanner(/Hole 1 . Straight Shot . Par 2/);
  assert(/Strokes 0/.test(await text('#hud-strokes')), 'play again restarts at hole 1');

  assert(errors.length === 0, `no page errors (${errors.join('; ')})`);
  console.log('E2E OK, screenshots in docs/screenshots/');
} catch (err) {
  console.error(err);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
