import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { BALANCE, PHYSICS, STEP_DT, type NetEffect, type RenderPlayer } from '@golfwars/shared';

/** Everything the effects need to draw one frame. */
export interface FxFrame {
  effects: readonly NetEffect[];
  /** Interpolated players (balls: position and phase). */
  players: readonly RenderPlayer[];
  /** The tick the interpolated state shows. */
  renderTick: number;
  /** Seconds, monotonic. */
  time: number;
  dt: number;
}

interface Item {
  obj: Object3D;
  update(e: NetEffect, f: FxFrame): void;
  dispose(): void;
}

const bubbleMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: 0x9fdcff,
    transparent: true,
    opacity: 0.38,
    roughness: 0.15,
    metalness: 0,
    flatShading: true,
    emissive: 0x5aaee8,
    emissiveIntensity: 0.25,
    depthWrite: false,
  });

const lifeLeft = (e: NetEffect, f: FxFrame, seconds: number): number =>
  Math.max(0, Math.min(1, ((e.endTick - f.renderTick) * STEP_DT) / seconds));

/** Translucent soap bubble with a white highlight patch. */
function makeBubble(radius: number): { group: Group; mat: MeshStandardMaterial } {
  const group = new Group();
  const mat = bubbleMat();
  const shell = new Mesh(new IcosahedronGeometry(radius, 1), mat);
  const shine = new Mesh(
    new IcosahedronGeometry(radius * 0.22, 0),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
  );
  shine.position.set(-radius * 0.45, radius * 0.5, -radius * 0.35);
  group.add(shell, shine);
  return { group, mat };
}

function bubbleItem(): Item {
  const { group, mat } = makeBubble(BALANCE.gadgets.bubble.radius);
  return {
    obj: group,
    update(e, f) {
      group.position.set(e.pos[0], e.pos[1], e.pos[2]);
      const s = 1 + Math.sin(f.time * 9) * 0.05;
      group.scale.set(s, 1 / s, s);
    },
    dispose() {
      mat.dispose();
    },
  };
}

/** Pink low-poly splat on the floor: a jagged disc plus a few satellite drips. */
function gumItem(): Item {
  const radius = BALANCE.gadgets.gum.radius;
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: 0xff6fb3,
    emissive: 0xff3d94,
    emissiveIntensity: 0.18,
    roughness: 0.35,
    flatShading: true,
    transparent: true,
    side: DoubleSide,
  });
  const main = new CircleGeometry(radius * 0.88, 11);
  // Jag the rim so it reads as a splat rather than a disc.
  const pos = main.attributes.position!;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const a = Math.atan2(y, x);
    const k = 1 + 0.18 * Math.sin(a * 3 + 0.7) + 0.1 * Math.sin(a * 7);
    pos.setXY(i, x * k, y * k);
  }
  const disc = new Mesh(main, mat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.025;
  group.add(disc);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.4;
    const r = radius * (0.95 + 0.12 * (i % 2));
    const drip = new Mesh(new CircleGeometry(0.09 + 0.04 * (i % 3), 6), mat);
    drip.rotation.x = -Math.PI / 2;
    drip.position.set(Math.cos(a) * r, 0.026, Math.sin(a) * r);
    group.add(drip);
  }
  const bump = new Mesh(new IcosahedronGeometry(0.2, 0), mat);
  bump.scale.y = 0.45;
  bump.position.set(-0.15, 0.06, 0.1);
  group.add(bump);
  const born = { t: -1 };
  return {
    obj: group,
    update(e, f) {
      if (born.t < 0) born.t = f.time;
      group.position.set(e.pos[0], e.pos[1], e.pos[2]);
      // Pop in, fade out over the last 2 s.
      const pop = Math.min(1, (f.time - born.t) * 6);
      const s = 0.4 + 0.6 * (1 - (1 - pop) * (1 - pop));
      group.scale.set(s, 1, s);
      mat.opacity = Math.min(1, lifeLeft(e, f, 2));
    },
    dispose() {
      mat.dispose();
      main.dispose();
    },
  };
}

/** A small desk fan (grille + spinning blades) with gust lines streaming through the cone. */
function fanItem(): Item {
  const group = new Group();
  const cfg = BALANCE.gadgets.fan;
  const dark = new MeshStandardMaterial({ color: 0x4a5560, flatShading: true });
  const blade = new MeshStandardMaterial({ color: 0x7fb8e6, flatShading: true });
  const stand = new Mesh(new CylinderGeometry(0.12, 0.16, 0.5, 8), dark);
  stand.position.y = 0.25;
  const head = new Group();
  head.position.y = 0.62;
  const ring = new Mesh(new TorusGeometry(0.3, 0.035, 5, 16), dark);
  const blades = new Group();
  for (let i = 0; i < 3; i++) {
    const b = new Mesh(new BoxGeometry(0.1, 0.27, 0.025), blade);
    b.position.y = 0.14;
    const holder = new Group();
    holder.rotation.z = (i * Math.PI * 2) / 3;
    holder.add(b);
    blades.add(holder);
  }
  head.add(ring, blades);
  group.add(stand, head);
  // The prop stands in front of the user so it is not hidden behind the Windup.
  stand.position.z = head.position.z = -0.55;

  // Gust lines: thin streaks that travel outwards through the cone and fade.
  const lineMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const lines: { m: Mesh; phase: number; angle: number; lift: number; speed: number }[] = [];
  const half = (cfg.halfAngleDeg * Math.PI) / 180;
  for (let i = 0; i < 22; i++) {
    const m = new Mesh(new BoxGeometry(0.035, 0.035, 0.7), lineMat);
    group.add(m);
    lines.push({
      m,
      phase: (i * 0.618) % 1,
      angle: ((i % 11) / 10 - 0.5) * 2 * half * 0.92,
      lift: 0.15 + (((i * 37) % 10) / 10) * 0.55,
      speed: 0.9 + ((i * 13) % 7) / 20,
    });
  }
  const dir = new Vector3();
  return {
    obj: group,
    update(e, f) {
      group.position.set(e.pos[0], e.pos[1], e.pos[2]);
      group.rotation.y = e.yaw;
      head.rotation.y = 0;
      blades.rotation.z = f.time * 40;
      const fade = Math.min(1, lifeLeft(e, f, cfg.duration) * 6);
      lineMat.opacity = 0.55 * fade;
      for (const l of lines) {
        const t = (f.time * l.speed * 0.55 + l.phase) % 1;
        const d = 0.5 + t * (cfg.range - 0.9);
        // Local frame: the fan faces -z.
        dir.set(Math.sin(-l.angle), 0, -Math.cos(l.angle));
        l.m.position.set(dir.x * d, l.lift, dir.z * d);
        l.m.rotation.y = -l.angle;
        l.m.scale.z = 0.6 + t * 0.8;
      }
    },
    dispose() {
      lineMat.dispose();
      dark.dispose();
      blade.dispose();
    },
  };
}

/** Red horseshoe magnet floating above its owner's ball, with faint pull lines to ball in range. */
function magnetItem(): Item {
  const group = new Group();
  const red = new MeshStandardMaterial({
    color: 0xe5484d,
    flatShading: true,
    roughness: 0.5,
    emissive: 0x7a1014,
    emissiveIntensity: 0.3,
  });
  const tip = new MeshStandardMaterial({ color: 0xf2f2f2, flatShading: true });
  const horse = new Group();
  const arc = new Mesh(new TorusGeometry(0.22, 0.07, 6, 10, Math.PI), red);
  horse.add(arc);
  for (const sx of [-1, 1]) {
    const leg = new Mesh(new CylinderGeometry(0.07, 0.07, 0.28, 6), red);
    leg.position.set(sx * 0.22, -0.14, 0);
    const cap = new Mesh(new CylinderGeometry(0.075, 0.075, 0.09, 6), tip);
    cap.position.set(sx * 0.22, -0.3, 0);
    horse.add(leg, cap);
  }
  horse.rotation.z = Math.PI; // open end pointing down at the ball
  horse.position.y = 0.45;
  group.add(horse);
  const lineMat = new MeshBasicMaterial({
    color: 0xff6b6b,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const links: Mesh[] = [];
  const range = BALANCE.gadgets.magnet.range;
  const up = new Vector3(0, 0, 1);
  const dir = new Vector3();
  return {
    obj: group,
    update(e, f) {
      const mine = f.players.find((p) => p.slot === e.owner);
      if (!mine) {
        group.visible = false;
        return;
      }
      group.visible = true;
      const m = mine.ball.pos;
      group.position.set(m[0], m[1] + 0.4 + Math.sin(f.time * 3) * 0.05, m[2]);
      horse.rotation.y = f.time * 1.6;
      const pulled = f.players.filter(
        (p) =>
          p.slot !== e.owner &&
          p.ball.phase === 'moving' &&
          Math.hypot(p.ball.pos[0] - m[0], p.ball.pos[2] - m[2]) <= range,
      );
      while (links.length < pulled.length) {
        const l = new Mesh(new BoxGeometry(0.03, 0.03, 1), lineMat);
        links.push(l);
        group.add(l);
      }
      links.forEach((l, i) => {
        const p = pulled[i];
        l.visible = !!p;
        if (!p) return;
        // Line from the pulled ball to the magnet ball (group origin is above the magnet ball).
        const bx = p.ball.pos[0] - m[0];
        const by = p.ball.pos[1] - group.position.y;
        const bz = p.ball.pos[2] - m[2];
        dir.set(-bx, m[1] - group.position.y - by, -bz);
        const len = dir.length();
        l.position.set(bx + dir.x / 2, by + dir.y / 2, bz + dir.z / 2);
        l.scale.z = len;
        l.quaternion.setFromUnitVectors(up, dir.normalize());
      });
    },
    dispose() {
      red.dispose();
      tip.dispose();
      lineMat.dispose();
    },
  };
}

/** A bubble around every trapped ball. */
function trapBubble(): { group: Group; mat: MeshStandardMaterial } {
  return makeBubble(PHYSICS.ball.radius * 2.4);
}

/** Draws every active gadget effect (and bubbles around trapped balls) from snapshot data. */
export class GadgetFx {
  readonly group = new Group();
  private readonly items = new Map<string, Item>();
  private readonly traps = new Map<number, { group: Group; mat: MeshStandardMaterial }>();

  update(f: FxFrame): void {
    const seen = new Set<string>();
    for (const e of f.effects) {
      const key = `${e.kind}:${e.id}:${e.owner}:${e.kind === 'fan' ? e.endTick : ''}`;
      seen.add(key);
      let item = this.items.get(key);
      if (!item) {
        item =
          e.kind === 'bubble'
            ? bubbleItem()
            : e.kind === 'gum'
              ? gumItem()
              : e.kind === 'fan'
                ? fanItem()
                : magnetItem();
        this.items.set(key, item);
        this.group.add(item.obj);
      }
      item.update(e, f);
    }
    for (const [key, item] of this.items) {
      if (seen.has(key)) continue;
      this.group.remove(item.obj);
      item.dispose();
      this.items.delete(key);
    }

    const trapped = new Set<number>();
    for (const p of f.players) {
      if (p.ball.phase !== 'trapped') continue;
      trapped.add(p.slot);
      let t = this.traps.get(p.slot);
      if (!t) {
        t = trapBubble();
        this.traps.set(p.slot, t);
        this.group.add(t.group);
      }
      t.group.position.set(p.ball.pos[0], p.ball.pos[1], p.ball.pos[2]);
      const s = 1 + Math.sin(f.time * 6 + p.slot) * 0.05;
      t.group.scale.setScalar(s);
    }
    for (const [slot, t] of this.traps) {
      if (trapped.has(slot)) continue;
      this.group.remove(t.group);
      t.mat.dispose();
      this.traps.delete(slot);
    }
  }

  clear(): void {
    this.update({ effects: [], players: [], renderTick: 0, time: 0, dt: 0 });
  }
}
