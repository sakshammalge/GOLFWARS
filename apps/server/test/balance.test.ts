import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BALANCE, MATCH, MessageType, resetBalance } from '@golfwars/shared';
import { startBalanceWatcher, type BalanceWatcher } from '../src/balanceWatcher.js';
import { createGameServer, type GameServer } from '../src/server.js';
import { TestClient, sleep, waitFor } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'golfwars-balance-'));
const file = join(dir, 'balance.dev.json');
const quiet = (): void => {};
let watcher: BalanceWatcher | null = null;

afterEach(() => {
  watcher?.stop();
  watcher = null;
  resetBalance();
  try {
    unlinkSync(file);
  } catch {
    // not there
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('balance hot reload (T4.5)', () => {
  it('applies the file at start and on every change, keeps the last good file when it breaks, and restores defaults when removed', async () => {
    writeFileSync(file, JSON.stringify({ gadgets: { fan: { duration: 7 } } }));
    watcher = startBalanceWatcher({ file, log: quiet, debounceMs: 10 });
    expect(BALANCE.gadgets.fan.duration).toBe(7);

    const seen: unknown[] = [];
    watcher.onChange((o) => seen.push(o));
    writeFileSync(
      file,
      JSON.stringify({ gadgets: { fan: { duration: 3 } }, match: { holeTimeSeconds: 45 } }),
    );
    await waitFor(() => BALANCE.gadgets.fan.duration === 3, 'new value');
    expect(MATCH.holeTimeSeconds).toBe(45);
    expect(seen.length).toBeGreaterThan(0);

    writeFileSync(file, '{ not json');
    await sleep(150);
    expect(BALANCE.gadgets.fan.duration).toBe(3); // last good override stays

    unlinkSync(file);
    await waitFor(() => BALANCE.gadgets.fan.duration === 2, 'defaults restored');
    expect(MATCH.holeTimeSeconds).toBe(90);
  });

  it('production ignores the file completely', async () => {
    writeFileSync(file, JSON.stringify({ gadgets: { fan: { duration: 9 } } }));
    watcher = startBalanceWatcher({ file, enabled: false, log: quiet, debounceMs: 10 });
    expect(BALANCE.gadgets.fan.duration).toBe(2);
    writeFileSync(file, JSON.stringify({ gadgets: { fan: { duration: 8 } } }));
    await sleep(200);
    expect(BALANCE.gadgets.fan.duration).toBe(2);
    expect(watcher.current()).toBeNull();
  });
});

describe('balance broadcast to clients (T4.5)', () => {
  let server: GameServer;
  let url: string;

  beforeAll(async () => {
    writeFileSync(file, '{}');
    watcher = startBalanceWatcher({ file, log: quiet, debounceMs: 10 });
    server = createGameServer({ balance: watcher });
    const port = 20000 + Math.floor(Math.random() * 30000);
    url = `ws://localhost:${port}`;
    await server.listen(port);
  });
  afterAll(async () => {
    await server.stop();
  });

  it('running rooms tell their clients, and late joiners get the override in force', async () => {
    const a = await TestClient.create(url, { nickname: 'Ada' });
    const got: unknown[] = [];
    a.room.onMessage(MessageType.Balance, (m: { o: unknown }) => got.push(m.o));
    writeFileSync(file, JSON.stringify({ gadgets: { bubble: { trapSeconds: 6 } } }));
    await waitFor(() => got.length > 0, 'balance message');
    expect(got.at(-1)).toEqual({ gadgets: { bubble: { trapSeconds: 6 } } });
    expect(BALANCE.gadgets.bubble.trapSeconds).toBe(6);

    const b = await TestClient.join(url, a.room.roomId, { nickname: 'Bob' });
    const late: unknown[] = [];
    b.room.onMessage(MessageType.Balance, (m: { o: unknown }) => late.push(m.o));
    // The join message may have arrived before the handler: a fresh change always arrives.
    writeFileSync(file, JSON.stringify({ gadgets: { bubble: { trapSeconds: 5 } } }));
    await waitFor(() => late.length > 0, 'balance for B');
    expect(late.at(-1)).toEqual({ gadgets: { bubble: { trapSeconds: 5 } } });
    await a.close();
    await b.close();
  });
});
