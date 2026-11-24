import { MathUtils } from 'three';
import type { Keys } from './input.js';

/** Seconds for the meter to sweep 0 -> 100%. It then ping-pongs back down. */
const SWEEP_SECONDS = 1.1;
/** Fine aim speed with A/D (degrees per second) and its clamp. */
const FINE_AIM_DEG_PER_S = 20;
const FINE_AIM_MAX_DEG = 30;
/** Releasing below this power cancels the shot instead of dribbling the ball. */
const MIN_POWER = 0.03;

export interface ShotControlsEvents {
  /** Player released the button: take the shot. `aimOffset` is the A/D fine-aim in radians. */
  onShoot(power: number, aimOffset: number): void;
}

/**
 * Hold left mouse to charge (power ping-pongs 0-100%), release to shoot, Escape cancels.
 * Left/Right arrows (and A/D while charging, when the Windup is planted) nudge the aim left/right
 * of the camera direction.
 */
export class ShotControls {
  charging = false;
  power = 0;
  /** Last released power; used for the idle aim preview. */
  lastPower = 0.5;
  /** Fine-aim offset from the camera direction, radians (positive = left / counter-clockwise). */
  aimOffset = 0;
  private t = 0;
  private enabled = false;

  constructor(
    dom: HTMLElement,
    private readonly keys: Keys,
    private readonly events: ShotControlsEvents,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      this.charging = true;
      this.t = 0;
      this.power = 0;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.charging) return;
      this.release();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.cancel();
    });
    window.addEventListener('blur', () => this.cancel());
  }

  /** The Windup must be next to a resting ball (and the round in play) for shots to be allowed. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.cancel();
  }

  cancel(): void {
    this.charging = false;
    this.power = 0;
  }

  resetAim(): void {
    this.aimOffset = 0;
  }

  update(dt: number): void {
    if (this.enabled) {
      // Left = +, right = -. A/D only aim while charging; otherwise they run the Windup.
      const arrows = this.keys.axis('ArrowRight', 'ArrowLeft');
      const dir = this.charging ? arrows + this.keys.axis('KeyD', 'KeyA') : arrows;
      const max = MathUtils.degToRad(FINE_AIM_MAX_DEG);
      this.aimOffset = MathUtils.clamp(
        this.aimOffset + dir * MathUtils.degToRad(FINE_AIM_DEG_PER_S) * dt,
        -max,
        max,
      );
    }
    if (this.charging) {
      this.t += dt / SWEEP_SECONDS;
      const phase = this.t % 2;
      this.power = phase < 1 ? phase : 2 - phase;
    }
  }

  private release(): void {
    const power = this.power;
    this.charging = false;
    this.power = 0;
    if (!this.enabled || power < MIN_POWER) return;
    this.lastPower = power;
    this.events.onShoot(power, this.aimOffset);
  }
}
