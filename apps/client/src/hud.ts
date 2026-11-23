/** Plain DOM overlay: stroke counter, power meter, toasts and (T1.5) banners and scorecard. */
export class Hud {
  private readonly root = document.createElement('div');
  private readonly strokes = document.createElement('div');
  private readonly meter = document.createElement('div');
  private readonly meterFill = document.createElement('div');
  private readonly meterText = document.createElement('div');
  private readonly toast = document.createElement('div');
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

    const hint = document.createElement('div');
    hint.id = 'hud-hint';
    hint.textContent =
      'Hold LEFT MOUSE to charge, release to shoot (Esc cancels)  |  Right-drag or Q/E: orbit  |  Wheel: zoom  |  A/D: fine aim  |  F3: debug';
    this.root.append(this.strokes, this.toast, this.meter, hint);
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
}
