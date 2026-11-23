import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Keys } from './input.js';

const MIN_PITCH = MathUtils.degToRad(15);
const MAX_PITCH = MathUtils.degToRad(70);
const MIN_DIST = 3;
const MAX_DIST = 18;
const KEY_ORBIT_SPEED = 1.8; // rad/s for Q/E
const DRAG_SPEED = 0.005; // rad/px

/**
 * Third-person orbit camera that follows a target (the ball). Orbit with right/middle mouse drag
 * or Q/E, zoom with the wheel. Pitch and distance are clamped so the camera never flips or ends
 * up inside the scene's geometry at a sensible scale.
 */
export class CameraRig {
  yaw = 0;
  pitch = MathUtils.degToRad(38);
  distance = 7;
  readonly target = new Vector3();
  private readonly goal = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    dom: HTMLElement,
    private readonly keys: Keys,
  ) {
    let dragging = false;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        dragging = true;
        dom.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (dragging && (e.button === 2 || e.button === 1)) dragging = false;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.orbit(-e.movementX * DRAG_SPEED, e.movementY * DRAG_SPEED);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
  }

  orbit(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = MathUtils.clamp(this.pitch + dPitch, MIN_PITCH, MAX_PITCH);
  }

  zoom(factor: number): void {
    this.distance = MathUtils.clamp(this.distance * factor, MIN_DIST, MAX_DIST);
  }

  /** Horizontal unit direction the camera looks along (from camera towards the target). */
  forwardXZ(out = new Vector3()): Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Jump straight to a target position (no smoothing). */
  snapTo(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.goal.copy(this.target);
    this.apply();
  }

  setFollow(x: number, y: number, z: number): void {
    this.goal.set(x, y, z);
  }

  update(dt: number): void {
    this.yaw += this.keys.axis('KeyE', 'KeyQ') * KEY_ORBIT_SPEED * dt;
    this.target.lerp(this.goal, 1 - Math.exp(-8 * dt));
    this.apply();
  }

  private apply(): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}
