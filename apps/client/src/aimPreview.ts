import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import type { Vec3 } from '@golfwars/shared';

const MAX_DOTS = 80;

/** Dotted aim arc: a pool of tiny flat spheres positioned along the simulated path. */
export class AimPreview {
  readonly object: Object3D;
  private readonly dots: InstancedMesh;
  private readonly m = new Matrix4();

  constructor() {
    this.dots = new InstancedMesh(
      new SphereGeometry(0.045, 8, 6),
      new MeshBasicMaterial({ color: 0xfff3a0 }),
      MAX_DOTS,
    );
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    const g = new Group();
    g.add(this.dots);
    this.object = g;
  }

  set(points: Vec3[]): void {
    // Skip the very first point so the first dot is not hidden inside the ball.
    const n = Math.min(MAX_DOTS, Math.max(0, points.length - 1));
    for (let i = 0; i < n; i++) {
      const p = points[i + 1]!;
      this.m.makeTranslation(p[0], p[1], p[2]);
      this.dots.setMatrixAt(i, this.m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.dots.count = 0;
  }
}
