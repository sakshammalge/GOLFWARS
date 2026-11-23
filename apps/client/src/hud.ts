import { formatToPar, type Scorecard } from '@golfwars/shared';

/** Plain DOM overlay: stroke counter, power meter, toasts, banners and the scorecard. */
export class Hud {
  private readonly root = document.createElement('div');
  private readonly strokes = document.createElement('div');
  private readonly meter = document.createElement('div');
  private readonly meterFill = document.createElement('div');
  private readonly meterText = document.createElement('div');
  private readonly toast = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly card = document.createElement('div');
  private toastTimer = 0;

  constructor() {
    this.root.id = 'hud';
    this.strokes.id = 'hud-strokes';
    this.meter.id = 'hud-meter';
    this.meter.hidden = true;
    this.meterFill.id = 'hud-meter-fill';
    this.meterText.id = 'hud-meter-text';
    this.meter.append(this.meterFill, this.meterText);
    this.toast.id = 'hud-toast';
    this.toast.hidden = true;
    this.banner.id = 'hud-banner';
    this.banner.hidden = true;
    this.card.id = 'scorecard';
    this.card.hidden = true;

    const hint = document.createElement('div');
    hint.id = 'hud-hint';
    hint.textContent =
      'Hold LEFT MOUSE to charge, release to shoot (Esc cancels)  |  Right-drag or Q/E: orbit  |  Wheel: zoom  |  A/D: fine aim  |  F3: debug';
    this.root.append(this.strokes, this.toast, this.banner, this.meter, hint, this.card);
    document.body.appendChild(this.root);
  }

  setStrokes(text: string): void {
    this.strokes.textContent = text;
  }

  /** `power` in 0..1, or null to hide the meter. */
  setPower(power: number | null): void {
    this.meter.hidden = power === null;
    if (power === null) return;
    this.meterFill.style.width = `${(power * 100).toFixed(1)}%`;
    this.meterText.textContent = `${Math.round(power * 100)}%`;
  }

  showToast(text: string, ms = 2200): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), ms);
  }

  /** Big centred banner; `sub` is a smaller second line. Pass null to hide. */
  setBanner(text: string | null, sub = ''): void {
    this.banner.hidden = text === null;
    if (text === null) return;
    this.banner.replaceChildren();
    const main = document.createElement('div');
    main.className = 'main';
    main.textContent = text;
    this.banner.append(main);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = sub;
      this.banner.append(s);
    }
  }

  /** End-of-course scorecard with a "Play again" button. Pass null to hide. */
  showScorecard(card: Scorecard | null, onPlayAgain: () => void = () => {}): void {
    this.card.hidden = card === null;
    if (card === null) return;
    const title = document.createElement('h2');
    title.textContent = 'Kitchen Table \u2013 Scorecard';
    const table = document.createElement('table');
    const head = table.insertRow();
    for (const t of ['Hole', 'Par', 'Strokes', '+/-']) {
      const th = document.createElement('th');
      th.textContent = t;
      head.append(th);
    }
    const addRow = (cells: string[], cls = ''): void => {
      const tr = table.insertRow();
      if (cls) tr.className = cls;
      cells.forEach((c) => (tr.insertCell().textContent = c));
    };
    card.rows.forEach((r, i) =>
      addRow(
        [`${i + 1}. ${r.name}`, String(r.par), String(r.strokes), formatToPar(r.diff)],
        r.diff < 0 ? 'under' : r.diff > 0 ? 'over' : '',
      ),
    );
    addRow(
      ['Total', String(card.totalPar), String(card.totalStrokes), formatToPar(card.totalDiff)],
      'total',
    );
    const btn = document.createElement('button');
    btn.id = 'play-again';
    btn.textContent = 'Play again';
    btn.addEventListener('click', onPlayAgain);
    this.card.replaceChildren(title, table, btn);
  }
}
