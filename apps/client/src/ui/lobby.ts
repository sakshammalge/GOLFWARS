import { NICKNAME_MAX, PLAYER_COLORS, normalizeRoomCode } from '@golfwars/shared';
import { h, hex } from './dom.js';
import type { RoomState } from '../net/connection.js';

const NICK_KEY = 'golfwars.nick';

export function savedNickname(): string {
  return localStorage.getItem(NICK_KEY) ?? '';
}

interface PlayerView {
  id: string;
  nickname: string;
  slot: number;
  color: number;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface MenuActions {
  create(nickname: string): void;
  join(code: string, nickname: string): void;
  solo(): void;
}

export interface LobbyActions {
  setNick(nickname: string): void;
  setColor(color: number): void;
  setReady(ready: boolean): void;
  start(): void;
  leave(): void;
}

/** Main menu (create / join / solo) and the room lobby, as DOM overlays. */
export class LobbyUi {
  private readonly menu = h('div', { id: 'menu', class: 'screen' });
  private readonly lobby = h('div', { id: 'lobby', class: 'screen' });
  private readonly overlay = h('div', { id: 'conn-overlay', hidden: true });
  private readonly nickInput = h('input', {
    id: 'nick',
    type: 'text',
    maxlength: NICKNAME_MAX,
    placeholder: 'Nickname',
    autocomplete: 'off',
    value: savedNickname(),
  });
  private readonly codeInput = h('input', {
    id: 'code',
    type: 'text',
    maxlength: 5,
    placeholder: 'ROOM CODE',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  private readonly error = h('div', { id: 'menu-error', class: 'error' });
  private readonly lobbyNick = h('input', {
    id: 'lobby-nick',
    type: 'text',
    maxlength: NICKNAME_MAX,
    autocomplete: 'off',
  });
  private myId = '';

  constructor(
    private readonly menuActions: MenuActions,
    private readonly lobbyActions: LobbyActions,
  ) {
    document.body.append(this.menu, this.lobby, this.overlay);
    this.buildMenu();
    this.hideAll();
  }

  private nickname(): string {
    const n = this.nickInput.value.trim();
    localStorage.setItem(NICK_KEY, n);
    return n;
  }

  private buildMenu(): void {
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    const join = (): void => {
      const code = normalizeRoomCode(this.codeInput.value);
      if (!code) return this.showError('Room codes are 5 letters, for example KQZMT.');
      this.showError('');
      this.menuActions.join(code, this.nickname());
    };
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    this.menu.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('h1', {}, 'GolfWars'),
        h('p', { class: 'tagline' }, 'Wind-up toys. Giant house. Bonk your friends.'),
        this.nickInput,
        h(
          'button',
          {
            id: 'create-room',
            class: 'primary',
            onclick: () => {
              this.showError('');
              this.menuActions.create(this.nickname());
            },
          },
          'Create room',
        ),
        h(
          'div',
          { class: 'row' },
          this.codeInput,
          h('button', { id: 'join-room', onclick: join }, 'Join room'),
        ),
        h(
          'button',
          { id: 'play-solo', class: 'link', onclick: () => this.menuActions.solo() },
          'Play solo offline',
        ),
        this.error,
      ),
    );
  }

  showError(text: string): void {
    this.error.textContent = text;
  }

  /** Pre-fills the join box (for `/?room=ABCDE` links). */
  prefillCode(code: string): void {
    this.codeInput.value = code;
  }

  hideAll(): void {
    this.menu.hidden = true;
    this.lobby.hidden = true;
  }

  showMenu(error = ''): void {
    this.hideAll();
    this.menu.hidden = false;
    this.showError(error);
    this.setOverlay(null);
  }

  /** Full-screen notice such as "Reconnecting..." (null hides it). */
  setOverlay(text: string | null): void {
    this.overlay.hidden = text === null;
    if (text !== null) this.overlay.textContent = text;
  }

  hideLobby(): void {
    this.lobby.hidden = true;
  }

  /** Redraws the lobby from the room state. */
  renderLobby(state: RoomState, myId: string, pingMs: number): void {
    // Do not rebuild the lobby under the cursor while the nickname is being typed.
    if (!this.lobby.hidden && document.activeElement === this.lobbyNick) return;
    this.hideMenu();
    this.lobby.hidden = false;
    this.myId = myId;
    const players: PlayerView[] = [];
    state.players.forEach((p: PlayerView, id: string) => players.push({ ...p, id }));
    players.sort((a, b) => a.slot - b.slot);
    const me = players.find((p) => p.id === myId);
    const isHost = state.hostId === myId;
    const taken = new Map<number, string>();
    players.forEach((p) => taken.set(p.color, p.id));
    const link = `${location.origin}${location.pathname}?room=${state.code}`;

    if (me && document.activeElement !== this.lobbyNick) this.lobbyNick.value = me.nickname;
    this.lobbyNick.onchange = () => {
      localStorage.setItem(NICK_KEY, this.lobbyNick.value.trim());
      this.lobbyActions.setNick(this.lobbyNick.value);
    };

    const swatches = PLAYER_COLORS.map((c, i) => {
      const owner = taken.get(i);
      const mine = owner === myId;
      return h('button', {
        class: `swatch${mine ? ' mine' : ''}`,
        style: `background:${hex(c.hex)}`,
        title: owner && !mine ? `${c.name} (taken)` : c.name,
        disabled: owner !== undefined && !mine,
        onclick: () => this.lobbyActions.setColor(i),
      });
    });

    const rows = players.map((p) =>
      h(
        'div',
        { class: `player${p.id === myId ? ' me' : ''}${p.connected ? '' : ' away'}` },
        h('span', {
          class: 'dot',
          style: `background:${hex(PLAYER_COLORS[p.color]?.hex ?? 0xffffff)}`,
        }),
        h('span', { class: 'pname' }, p.nickname),
        p.host ? h('span', { class: 'badge' }, 'HOST') : null,
        p.connected ? null : h('span', { class: 'badge away' }, 'reconnecting'),
        h('span', { class: `ready${p.ready ? ' on' : ''}` }, p.ready ? 'Ready' : 'Not ready'),
      ),
    );
    const readyCount = players.filter((p) => p.ready).length;

    this.lobby.replaceChildren(
      h(
        'div',
        { class: 'card wide' },
        h(
          'div',
          { class: 'room-head' },
          h('span', { class: 'label' }, 'Room'),
          h('span', { id: 'room-code' }, state.code),
        ),
        h(
          'div',
          { class: 'share' },
          h('input', {
            id: 'share-link',
            type: 'text',
            readonly: true,
            value: link,
            onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
          }),
          h(
            'button',
            {
              id: 'copy-link',
              onclick: async (e: Event) => {
                const btn = e.target as HTMLButtonElement;
                try {
                  await navigator.clipboard.writeText(link);
                  btn.textContent = 'Copied!';
                } catch {
                  (this.lobby.querySelector('#share-link') as HTMLInputElement).select();
                  btn.textContent = 'Press Ctrl+C';
                }
                setTimeout(() => (btn.textContent = 'Copy link'), 1500);
              },
            },
            'Copy link',
          ),
        ),
        h('label', { class: 'label' }, 'Your nickname'),
        this.lobbyNick,
        h('label', { class: 'label' }, 'Your colour'),
        h('div', { class: 'swatches' }, ...swatches),
        h('div', { class: 'players', id: 'player-list' }, ...rows),
        h(
          'div',
          { class: 'row actions' },
          h(
            'button',
            {
              id: 'ready-toggle',
              class: me?.ready ? 'on' : '',
              onclick: () => this.lobbyActions.setReady(!me?.ready),
            },
            me?.ready ? 'Not ready' : "I'm ready",
          ),
          isHost
            ? h(
                'button',
                { id: 'start-match', class: 'primary', onclick: () => this.lobbyActions.start() },
                'Start match',
              )
            : h('span', { class: 'hint' }, 'Waiting for the host to start...'),
          h(
            'button',
            { id: 'leave-room', class: 'link', onclick: () => this.lobbyActions.leave() },
            'Leave',
          ),
        ),
        h(
          'div',
          { class: 'hint' },
          `${players.length} player${players.length === 1 ? '' : 's'}, ${readyCount} ready` +
            (isHost ? ' - you can start any time (even solo)' : '') +
            (pingMs > 0 ? `  |  ping ${Math.round(pingMs)} ms` : ''),
        ),
      ),
    );
  }

  private hideMenu(): void {
    this.menu.hidden = true;
  }

  get currentId(): string {
    return this.myId;
  }
}
