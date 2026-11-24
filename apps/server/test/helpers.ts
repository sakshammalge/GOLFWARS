import { Client, type Room } from 'colyseus.js';
import {
  GOLF_ROOM,
  MessageType,
  NO_INPUT,
  PROTOCOL_VERSION,
  SnapshotDecoder,
  toEntry,
  type GameEvent,
  type JoinOptions,
  type ShotTuple,
  type Snapshot,
  type WindupInput,
} from '@golfwars/shared';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  fn: () => T | undefined | false | null,
  what: string,
  timeoutMs = 8000,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** A scripted game client: joins a room, decodes snapshots, sends numbered inputs. */
export class TestClient {
  snaps: Snapshot[] = [];
  events: GameEvent[] = [];
  seq = 0;
  /** Latest snapshot tick, used as the "view tick" of inputs. */
  private dec = new SnapshotDecoder();
  /** Bytes of snapshot payload received. */
  snapshotBytes = 0;

  private constructor(
    readonly room: Room,
    readonly client: Client,
  ) {
    this.attach();
  }

  private attach(): void {
    this.room.onMessage(MessageType.Snapshot, (data: Uint8Array | ArrayBuffer) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      this.snapshotBytes += bytes.length;
      this.snaps.push(this.dec.decode(bytes));
    });
    this.room.onMessage(MessageType.Event, (evs: GameEvent[]) => this.events.push(...evs));
  }

  static async create(url: string, options: JoinOptions = {}): Promise<TestClient> {
    const client = new Client(url);
    const room = await client.create(GOLF_ROOM, { protocol: PROTOCOL_VERSION, ...options });
    return new TestClient(room, client).ready();
  }

  static async join(url: string, code: string, options: JoinOptions = {}): Promise<TestClient> {
    const client = new Client(url);
    const room = await client.joinById(code, { protocol: PROTOCOL_VERSION, ...options });
    return new TestClient(room, client).ready();
  }

  /** Re-joins with the token of a dropped connection. */
  static async reconnect(url: string, token: string): Promise<TestClient> {
    const client = new Client(url);
    const room = await client.reconnect(token);
    return new TestClient(room, client).ready();
  }

  /** Waits for the first full state sync. */
  async ready(): Promise<this> {
    await waitFor(() => this.room.state?.players?.get, 'state sync');
    return this;
  }

  // `any`: the schema state is reflected at runtime and has no static type on the client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get state(): any {
    return this.room.state;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get me() {
    return this.state.players.get(this.sessionId);
  }

  get latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  /** Where this client's own ball is according to the newest snapshot. */
  ballPos(slot = this.me?.slot): [number, number, number] | undefined {
    return this.latest?.players.find((p) => p.slot === slot)?.ball.pos;
  }

  sendInput(input: WindupInput = NO_INPUT, shot?: ShotTuple): void {
    this.room.send(MessageType.Input, {
      seq: ++this.seq,
      tick: this.latest?.tick ?? 0,
      e: [toEntry(input, shot)],
    });
  }

  /** Sends `n` ticks of the same input at 60 Hz. */
  async hold(input: WindupInput, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      this.sendInput(input);
      await sleep(1000 / 60);
    }
  }

  close(): Promise<number> {
    return this.room.leave();
  }
}
