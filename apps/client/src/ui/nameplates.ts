import { Vector3, type PerspectiveCamera } from 'three';
import { h, hex } from './dom.js';

interface Plate {
  el: HTMLDivElement;
  name: string;
  away: boolean;
  color: number;
}

/** DOM labels that follow a world position (nicknames above Windups). */
export class Nameplates {
  private readonly root = h('div', { id: 'nameplates' });
  private readonly plates = new Map<number, Plate>();
  private readonly v = new Vector3();

  constructor() {
    document.body.appendChild(this.root);
  }

  /** Creates/updates a plate for `key` (the player slot). */
  set(key: number, name: string, color: number, away: boolean): void {
    let p = this.plates.get(key);
    if (!p) {
      const el = h('div', { class: 'nameplate' });
      this.root.appendChild(el);
      p = { el, name: '', away: false, color: -1 };
      this.plates.set(key, p);
    }
    if (p.name !== name || p.color !== color) {
      p.el.replaceChildren(h('span', { class: 'dot', style: `background:${hex(color)}` }), name);
      p.name = name;
      p.color = color;
    }
    if (p.away !== away) {
      p.away = away;
      p.el.classList.toggle('away', away);
    }
  }

  /** Places the plate above world point (x, y, z); hides it when behind the camera. */
  place(key: number, x: number, y: number, z: number, camera: PerspectiveCamera): void {
    const p = this.plates.get(key);
    if (!p) return;
    this.v.set(x, y, z).project(camera);
    if (this.v.z > 1 || this.v.z < -1) {
      p.el.style.display = 'none';
      return;
    }
    p.el.style.display = 'flex';
    const px = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    p.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
  }

  hide(key: number): void {
    const p = this.plates.get(key);
    if (p) p.el.style.display = 'none';
  }

  /** Removes plates whose key is not in `keep`. */
  prune(keep: Set<number>): void {
    for (const [k, p] of this.plates) {
      if (!keep.has(k)) {
        p.el.remove();
        this.plates.delete(k);
      }
    }
  }

  clear(): void {
    this.prune(new Set());
  }
}
