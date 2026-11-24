import type { LagConfig } from '@golfwars/shared';
import { h } from './dom.js';
import type { NetStats } from '../net/connection.js';

export interface PanelStats extends NetStats {
  /** Current / peak (last 2 s) prediction correction in centimetres. */
  predErrorCm: number;
  predErrorMaxCm: number;
  pendingInputs: number;
  corrections: number;
}

/** F3 panel: live netcode numbers and sliders for the simulated lag (RTT, jitter, loss). */
export class NetPanel {
  private readonly el = h('div', { id: 'net-panel', hidden: true });
  private readonly stats = h('div', { class: 'stats' });
  private readonly rtt = h('input', { type: 'range', min: 0, max: 400, step: 10, value: 0 });
  private readonly jitter = h('input', { type: 'range', min: 0, max: 100, step: 5, value: 0 });
  private readonly loss = h('input', { type: 'range', min: 0, max: 10, step: 0.5, value: 0 });
  private readonly rttV = h('b', {});
  private readonly jitterV = h('b', {});
  private readonly lossV = h('b', {});

  constructor(
    private readonly setLag: (c: LagConfig) => void,
    initial: LagConfig,
  ) {
    const row = (name: string, input: HTMLInputElement, v: HTMLElement): HTMLElement =>
      h('label', {}, h('span', {}, name), input, v);
    this.rtt.value = String(initial.rttMs);
    this.jitter.value = String(initial.jitterMs);
    this.loss.value = String(initial.lossPct);
    const apply = (): void => {
      const c: LagConfig = {
        rttMs: Number(this.rtt.value),
        jitterMs: Number(this.jitter.value),
        lossPct: Number(this.loss.value),
      };
      this.rttV.textContent = `${c.rttMs} ms`;
      this.jitterV.textContent = `${c.jitterMs} ms`;
      this.lossV.textContent = `${c.lossPct}%`;
      this.setLag(c);
    };
    for (const i of [this.rtt, this.jitter, this.loss]) i.addEventListener('input', apply);
    this.rttV.textContent = `${initial.rttMs} ms`;
    this.jitterV.textContent = `${initial.jitterMs} ms`;
    this.lossV.textContent = `${initial.lossPct}%`;
    this.el.append(
      this.stats,
      h('div', {}, 'Simulated lag (all game messages)'),
      row('RTT', this.rtt, this.rttV),
      row('Jitter', this.jitter, this.jitterV),
      row('Loss', this.loss, this.lossV),
    );
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') this.el.hidden = !this.el.hidden;
    });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  update(s: PanelStats): void {
    if (this.el.hidden) return;
    this.stats.textContent =
      `RTT          ${s.rttMs.toFixed(0)} ms (last ${s.rttLastMs.toFixed(0)})\n` +
      `snapshots    ${s.snapshotHz.toFixed(1)} Hz, ${(s.snapshotBytesPerSec / 1024).toFixed(2)} KB/s\n` +
      `interp buf   ${s.bufferedSnapshots} snaps\n` +
      `pred error   ${s.predErrorCm.toFixed(2)} cm (max ${s.predErrorMaxCm.toFixed(2)})\n` +
      `unacked in   ${s.pendingInputs}\n` +
      `server tick  ${s.serverTick.toFixed(0)} (render ${s.renderTick.toFixed(0)})`;
  }
}
