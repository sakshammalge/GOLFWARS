import { PLAYER_COLORS, formatToPar } from '@golfwars/shared';
import { h, hex } from './dom.js';
import type { RoomState } from '../net/connection.js';

export interface PlayerRow {
  id: string;
  nickname: string;
  slot: number;
  color: number;
  connected: boolean;
  abandoned: boolean;
  host: boolean;
  strokes: number;
  holed: boolean;
  total: number;
  scores: number[];
}

/** Reads the player map of the room state into plain rows sorted by seat. */
export function readPlayers(state: RoomState): PlayerRow[] {
  const rows: PlayerRow[] = [];
  state.players.forEach(
    (p: Omit<PlayerRow, 'id' | 'scores'> & { scores: Iterable<number> }, id: string) => {
      rows.push({ ...p, id, scores: Array.from(p.scores) });
    },
  );
  return rows.sort((a, b) => a.slot - b.slot);
}

const colorOf = (i: number): string => hex(PLAYER_COLORS[i]?.hex ?? 0xffffff);

/** Live mini leaderboard: strokes this hole, a check when holed, and the running total. */
export class Leaderboard {
  private readonly el = h('div', { id: 'leaderboard', hidden: true });

  constructor() {
    document.body.appendChild(this.el);
  }

  update(rows: PlayerRow[], myId: string, parTotal: number[]): void {
    this.el.hidden = rows.length === 0;
    const done = rows[0]?.scores.length ?? 0;
    const par = parTotal.slice(0, done).reduce((a, b) => a + b, 0);
    this.el.replaceChildren(
      h('div', { class: 'lb-head' }, h('span', {}, 'Players'), h('span', {}, 'Hole  /  Total')),
      ...rows.map((r) =>
        h(
          'div',
          {
            class: `lb-row${r.id === myId ? ' me' : ''}${r.connected || r.abandoned ? '' : ' away'}`,
          },
          h('span', { class: 'dot', style: `background:${colorOf(r.color)}` }),
          h('span', { class: 'nm' }, r.abandoned ? `${r.nickname} (left)` : r.nickname),
          h('span', { class: 'num' }, String(r.strokes)),
          h('span', { class: r.holed ? 'ok' : '' }, r.holed ? '✓' : ''),
          h('span', { class: 'num' }, done > 0 ? formatToPar(r.total - par) : '-'),
        ),
      ),
    );
  }

  hide(): void {
    this.el.hidden = true;
  }
}

/** End-of-course scoreboard for all players with a "back to lobby" button for the host. */
export class MatchBoard {
  private readonly el = h('div', { id: 'match-board', hidden: true });

  constructor() {
    document.body.appendChild(this.el);
  }

  hide(): void {
    this.el.hidden = true;
  }

  show(
    rows: PlayerRow[],
    holeNames: string[],
    pars: number[],
    isHost: boolean,
    onRematch: () => void,
    onLeave: () => void,
  ): void {
    this.el.hidden = false;
    const sorted = [...rows].sort((a, b) => a.total - b.total || a.slot - b.slot);
    const best = sorted[0]?.total;
    const totalPar = pars.reduce((a, b) => a + b, 0);
    const head = h(
      'tr',
      {},
      h('th', {}, 'Player'),
      ...holeNames.map((n, i) => h('th', { title: n }, `${i + 1}`)),
      h('th', {}, 'Total'),
      h('th', {}, '+/-'),
    );
    const body = sorted.map((r) =>
      h(
        'tr',
        { class: r.total === best ? 'first' : '' },
        h(
          'td',
          {},
          h('span', { class: 'dot', style: `background:${colorOf(r.color)}` }),
          r.abandoned ? `${r.nickname} (left)` : r.nickname,
        ),
        ...holeNames.map((_, i) => h('td', {}, String(r.scores[i] ?? '-'))),
        h('td', {}, String(r.total)),
        h('td', {}, formatToPar(r.total - totalPar)),
      ),
    );
    const parRow = h(
      'tr',
      { class: 'par' },
      h('td', {}, 'Par'),
      ...pars.map((p) => h('td', {}, String(p))),
      h('td', {}, String(totalPar)),
      h('td', {}, ''),
    );
    this.el.replaceChildren(
      h('h2', {}, 'Kitchen Table – Final scores'),
      h('table', {}, head, parRow, ...body),
      h(
        'div',
        { class: 'actions' },
        isHost
          ? h('button', { id: 'rematch', onclick: onRematch }, 'Back to lobby')
          : h('span', { class: 'hint' }, 'Waiting for the host...'),
        h('button', { class: 'link', id: 'leave-match', onclick: onLeave }, 'Leave'),
      ),
    );
  }
}
