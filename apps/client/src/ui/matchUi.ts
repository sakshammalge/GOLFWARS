import {
  PLAYER_COLORS,
  formatToPar,
  holePoints,
  ordinal,
  standings,
  tallyRematch,
} from '@golfwars/shared';
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
  /** Strokes on the current hole. */
  strokes: number;
  holed: boolean;
  /** Finish order on the current hole (0 = not holed yet). */
  finish: number;
  /** Strokes of each finished hole. */
  scores: number[];
  /** Finish bonus of each finished hole. */
  bonus: number[];
  /** Placement on each finished hole. */
  places: number[];
  /** Total points (strokes + bonuses of finished holes). */
  total: number;
  vote: boolean;
}

type RawPlayer = Omit<PlayerRow, 'id' | 'scores' | 'bonus' | 'places'> & {
  scores: Iterable<number>;
  bonus: Iterable<number>;
  places: Iterable<number>;
};

/** Reads the player map of the room state into plain rows sorted by seat. */
export function readPlayers(state: RoomState): PlayerRow[] {
  const rows: PlayerRow[] = [];
  state.players.forEach((p: RawPlayer, id: string) => {
    rows.push({
      ...p,
      id,
      scores: Array.from(p.scores),
      bonus: Array.from(p.bonus),
      places: Array.from(p.places),
    });
  });
  return rows.sort((a, b) => a.slot - b.slot);
}

const colorOf = (i: number): string => hex(PLAYER_COLORS[i]?.hex ?? 0xffffff);
const dot = (color: number): HTMLElement =>
  h('span', { class: 'dot', style: `background:${colorOf(color)}` });
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Live leaderboard (top right): total points and this-hole finish order, ranked by total. */
export class Leaderboard {
  private readonly el = h('div', { id: 'leaderboard', hidden: true });

  constructor() {
    document.body.appendChild(this.el);
  }

  update(rows: PlayerRow[], myId: string): void {
    this.el.hidden = rows.length === 0;
    const place = new Map(
      standings(rows.map((r) => ({ slot: r.slot, total: r.total }))).map((s) => [s.slot, s.place]),
    );
    const ranked = [...rows].sort(
      (a, b) => (place.get(a.slot) ?? 0) - (place.get(b.slot) ?? 0) || a.slot - b.slot,
    );
    this.el.replaceChildren(
      h(
        'div',
        { class: 'lb-head' },
        h('span', {}, 'Leaderboard'),
        h('span', { title: 'finish order on this hole' }, 'Hole'),
        h('span', { title: 'total points: strokes + finish bonus' }, 'Total'),
      ),
      ...ranked.map((r) =>
        h(
          'div',
          {
            class: `lb-row${r.id === myId ? ' me' : ''}${r.connected || r.abandoned ? '' : ' away'}`,
          },
          h('span', { class: 'rk' }, String(place.get(r.slot) ?? '')),
          dot(r.color),
          h('span', { class: 'nm' }, r.abandoned ? `${r.nickname} (left)` : r.nickname),
          h(
            'span',
            { class: `hole${r.holed ? ' ok' : ''}` },
            r.holed ? ordinal(r.finish) : `${r.strokes} str`,
          ),
          h('span', { class: 'num' }, r.scores.length > 0 ? signed(r.total) : '0'),
        ),
      ),
    );
  }

  hide(): void {
    this.el.hidden = true;
  }
}

/** Per-hole results shown for the 5 s hole-end phase: placement, strokes, bonus, points, total. */
export class HoleResults {
  private readonly el = h('div', { id: 'hole-results', hidden: true });

  constructor() {
    document.body.appendChild(this.el);
  }

  hide(): void {
    this.el.hidden = true;
  }

  show(rows: PlayerRow[], holeIndex: number, holeName: string, par: number, secs: number): void {
    this.el.hidden = false;
    const have = rows.filter((r) => r.scores.length > holeIndex);
    const sorted = [...have].sort(
      (a, b) => (a.places[holeIndex] ?? 99) - (b.places[holeIndex] ?? 99) || a.slot - b.slot,
    );
    const head = h(
      'tr',
      {},
      h('th', {}, '#'),
      h('th', {}, 'Player'),
      h('th', {}, 'Strokes'),
      h('th', {}, 'Bonus'),
      h('th', {}, 'Hole'),
      h('th', {}, 'Total'),
    );
    const body = sorted.map((r) => {
      const s = r.scores[holeIndex] ?? 0;
      const b = r.bonus[holeIndex] ?? 0;
      return h(
        'tr',
        { class: (r.places[holeIndex] ?? 0) === 1 ? 'first' : '' },
        h('td', {}, ordinal(r.places[holeIndex] ?? 0)),
        h('td', { class: 'nm' }, dot(r.color), r.abandoned ? `${r.nickname} (left)` : r.nickname),
        h('td', {}, String(s)),
        h('td', { class: b < 0 ? 'bonus' : '' }, b === 0 ? '-' : signed(b)),
        h('td', {}, String(holePoints([s], [b])[0])),
        h('td', { class: 'tot' }, signed(r.total)),
      );
    });
    this.el.replaceChildren(
      h('h2', {}, `Hole ${holeIndex + 1} results`),
      h(
        'div',
        { class: 'sub' },
        `${holeName} - par ${par}. 1st to hole out -2, 2nd -1, no hole-out = par + 3`,
      ),
      h('table', {}, head, ...body),
      h('div', { class: 'next' }, secs > 0 ? `Next in ${secs}...` : ''),
    );
  }
}

/** End-of-match screen: podium for the top 3, the full table, and the rematch vote. */
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
    course: string,
    holeNames: string[],
    pars: number[],
    myId: string,
    isHost: boolean,
    cb: { vote: (v: boolean) => void; again: () => void; lobby: () => void; leave: () => void },
  ): void {
    this.el.hidden = false;
    const table = standings(rows.map((r) => ({ slot: r.slot, total: r.total })));
    const bySlot = new Map(rows.map((r) => [r.slot, r]));
    const ranked = table.map((s) => ({ ...s, row: bySlot.get(s.slot)! }));
    const totalPar = pars.reduce((a, b) => a + b, 0);

    // Podium: 2nd, 1st, 3rd (ties share a block height).
    const top = ranked.filter((r) => r.place <= 3);
    const order = [2, 1, 3].map((p) => top.filter((r) => r.place === p)).flat();
    const podium = h(
      'div',
      { class: 'podium' },
      ...order.map((r) =>
        h(
          'div',
          { class: `step p${r.place}` },
          h('div', { class: 'who' }, dot(r.row.color), r.row.nickname),
          h('div', { class: 'pts' }, `${signed(r.total)} pts`),
          h('div', { class: 'block' }, ordinal(r.place)),
        ),
      ),
    );

    const head = h(
      'tr',
      {},
      h('th', {}, '#'),
      h('th', {}, 'Player'),
      ...holeNames.map((n, i) => h('th', { title: n }, `${i + 1}`)),
      h('th', {}, 'Total'),
      h('th', {}, '+/-'),
    );
    const body = ranked.map((r) =>
      h(
        'tr',
        { class: `${r.place === 1 ? 'first' : ''}${r.row.id === myId ? ' me' : ''}` },
        h('td', {}, ordinal(r.place)),
        h(
          'td',
          { class: 'nm' },
          dot(r.row.color),
          r.row.abandoned ? `${r.row.nickname} (left)` : r.row.nickname,
        ),
        ...holeNames.map((_, i) => {
          const s = r.row.scores[i];
          const b = r.row.bonus[i] ?? 0;
          return h(
            'td',
            { title: s === undefined ? '' : `${s} strokes ${b === 0 ? '' : signed(b)}` },
            s === undefined ? '-' : String(s + b),
          );
        }),
        h('td', {}, signed(r.total)),
        h('td', {}, formatToPar(r.total - totalPar)),
      ),
    );
    const parRow = h(
      'tr',
      { class: 'par' },
      h('td', {}, ''),
      h('td', { class: 'nm' }, 'Par'),
      ...pars.map((p) => h('td', {}, String(p))),
      h('td', {}, String(totalPar)),
      h('td', {}, ''),
    );

    const eligible = rows.filter((r) => !r.abandoned).map((r) => r.slot);
    const votes = new Map(rows.map((r) => [r.slot, r.vote]));
    const tally = tallyRematch(votes, eligible);
    const me = rows.find((r) => r.id === myId);
    const voteBtn = h(
      'button',
      { id: 'rematch-vote', class: me?.vote ? 'on' : '', onclick: () => cb.vote(!me?.vote) },
      me?.vote ? 'Rematch: yes (tap to undo)' : 'I want a rematch',
    );
    this.el.replaceChildren(
      h('h2', {}, `${course} - Final scores`),
      podium,
      h('table', {}, head, parRow, ...body),
      h(
        'div',
        { class: 'tally', id: 'rematch-tally' },
        `${tally.yes} of ${tally.total} want a rematch`,
      ),
      h(
        'div',
        { class: 'actions' },
        voteBtn,
        isHost
          ? h('button', { id: 'rematch-again', onclick: cb.again }, 'Play again (same players)')
          : h('span', { class: 'hint' }, 'The host picks: play again or back to the lobby'),
        isHost
          ? h('button', { id: 'rematch-lobby', class: 'alt', onclick: cb.lobby }, 'Back to lobby')
          : null,
        h('button', { class: 'link', id: 'leave-match', onclick: cb.leave }, 'Leave'),
      ),
    );
  }
}
