import { initPhysics, normalizeRoomCode, type LagConfig } from '@golfwars/shared';
import { Game } from './game.js';
import { Connection, SERVER_URL, loadSession, type RoomState } from './net/connection.js';
import { lagFromUrl } from './net/lagPresets.js';
import { OnlineGame } from './onlineGame.js';
import { createStage, type Stage } from './scene.js';
import { LobbyUi } from './ui/lobby.js';
import { NetPanel } from './ui/netPanel.js';

/** Menu -> lobby -> match, plus the offline solo mode. Owns the stage and the connection. */
export class App {
  private readonly stage: Stage;
  private readonly ui: LobbyUi;
  private readonly panel: NetPanel;
  private lag: LagConfig = lagFromUrl();
  private conn: Connection | null = null;
  private online: OnlineGame | null = null;
  private solo: Game | null = null;
  /** Rapier's WASM must be ready before any local simulation is built. */
  private readonly physicsReady = initPhysics();

  constructor() {
    this.stage = createStage(document.getElementById('app')!);
    this.panel = new NetPanel((c) => {
      this.lag = c;
      if (this.conn) this.conn.lag.config = { ...c };
    }, this.lag);
    this.ui = new LobbyUi(
      {
        create: (nick) => void this.enter((c) => c.create({ nickname: nick })),
        join: (code, nick) => void this.enter((c) => c.join(code, { nickname: nick })),
        solo: () => void this.startSolo(),
      },
      {
        setNick: (n) => this.conn?.send('nick', { nickname: n }),
        setColor: (color) => this.conn?.send('color', { color }),
        setReady: (ready) => this.conn?.send('ready', { ready }),
        start: () => this.conn?.send('start'),
        leave: () => this.leaveRoom(),
      },
    );
    const q = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
    if (q) this.ui.prefillCode(q);
    void this.boot(q);
  }

  private async boot(linkedRoom: string | null): Promise<void> {
    // A page refresh in the middle of a room: try to take the old seat back.
    const saved = loadSession();
    if (saved && (!linkedRoom || linkedRoom === saved.roomId)) {
      this.ui.setOverlay('Reconnecting...');
      const conn = this.newConnection();
      if (await conn.resume()) {
        this.ui.setOverlay(null);
        return;
      }
      this.conn = null;
    }
    this.ui.showMenu(
      linkedRoom
        ? `You were invited to room ${linkedRoom}. Pick a nickname and press Join room.`
        : '',
    );
  }

  private newConnection(): Connection {
    const conn = new Connection(this.lag);
    this.conn = conn;
    conn.onStateChange = () => this.sync(conn);
    conn.onConnState = (s) => {
      if (this.conn !== conn) return;
      this.ui.setOverlay(s === 'reconnecting' ? 'Connection lost. Reconnecting...' : null);
    };
    conn.onClosed = (reason) => {
      if (this.conn !== conn) return;
      this.online?.end();
      this.conn = null;
      this.ui.showMenu(reason === 'left' ? '' : reason);
    };
    return conn;
  }

  private async enter(go: (c: Connection) => Promise<void>): Promise<void> {
    this.ui.showError('');
    const conn = this.newConnection();
    try {
      await go(conn);
    } catch (e) {
      this.conn = null;
      this.ui.showMenu(describeError(e));
    }
  }

  private leaveRoom(): void {
    this.conn?.leave();
    this.online?.end();
    this.conn = null;
    this.ui.showMenu();
  }

  /** Room state changed: show the lobby or hand over to the match. */
  private sync(conn: Connection): void {
    if (this.conn !== conn) return;
    const state: RoomState = conn.state;
    if (!state?.players) return;
    if (state.phase === 'lobby') {
      this.online?.end();
      this.ui.renderLobby(state, conn.sessionId, conn.clockSync.smoothedRtt);
    } else {
      this.ui.hideAll();
      void this.enterMatch(conn);
    }
  }

  private async enterMatch(conn: Connection): Promise<void> {
    await this.physicsReady;
    if (this.conn !== conn || conn.state?.phase !== 'match') return;
    if (!this.online) {
      this.online = new OnlineGame(this.stage, this.panel);
      this.stage.start((dt) => this.online?.frame(dt));
    }
    this.online.bind(conn);
    this.online.begin();
    this.online.onStateChange();
  }

  private async startSolo(): Promise<void> {
    this.ui.hideAll();
    this.solo = new Game(this.stage);
    await this.solo.start();
  }
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|invalid/i.test(msg))
    return 'No room with that code. Check the letters and try again.';
  if (/locked/i.test(msg)) return 'That match has already started.';
  if (/full|maxClients/i.test(msg)) return 'That room is full (8 players).';
  if (/version|protocol/i.test(msg)) return msg;
  if (/started/i.test(msg)) return msg;
  return `Could not reach the game server at ${SERVER_URL}. Is it running?`;
}
