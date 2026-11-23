import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Scene } from 'three';
import type { World } from '@dimforge/rapier3d-compat';

/** F3 toggles an FPS counter and a Rapier collider wireframe. */
export class DebugOverlay {
  visible = false;
  private readonly el = document.createElement('div');
  private readonly lines: LineSegments;
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(scene: Scene) {
    this.el.id = 'debug';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 10;
    scene.add(this.lines);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this.lines.visible = this.visible;
  }

  /** Call once per rendered frame. `extra` is appended to the text block. */
  update(dt: number, world: World | null, extra = ''): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
    }
    if (!this.visible) return;
    this.el.textContent = `${this.fps.toFixed(0)} FPS${extra ? '\n' + extra : ''}`;
    if (!world) return;
    const { vertices, colors } = world.debugRender();
    const geo = this.lines.geometry;
    geo.setAttribute('position', new BufferAttribute(vertices, 3));
    // Rapier colours are RGBA; drop alpha.
    const rgb = new Float32Array((colors.length / 4) * 3);
    for (let i = 0, j = 0; i < colors.length; i += 4, j += 3) {
      rgb[j] = colors[i]!;
      rgb[j + 1] = colors[i + 1]!;
      rgb[j + 2] = colors[i + 2]!;
    }
    geo.setAttribute('color', new BufferAttribute(rgb, 3));
    geo.computeBoundingSphere();
  }
}
