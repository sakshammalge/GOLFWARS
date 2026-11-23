import RAPIER from '@dimforge/rapier3d-compat';
import { IcosahedronGeometry, Mesh, MeshStandardMaterial } from 'three';
import { KITCHEN_TABLE, loadHoleIntoWorld } from '@golfwars/courses';
import { buildHoleMeshes } from './courseMeshes.js';
import { connect, type NetStatus } from './network.js';
import { createStage } from './scene.js';

const statusEl = document.getElementById('status')!;

function render(s: NetStatus): void {
  statusEl.className = s.state === 'connected' ? 'ok' : s.state === 'disconnected' ? 'bad' : '';
  statusEl.textContent =
    s.state === 'connected'
      ? `Server: connected / ping ${s.pingMs ?? '-'} ms`
      : s.state === 'connecting'
        ? 'Server: connecting...'
        : 'Server: disconnected';
}

async function main(): Promise<void> {
  const stage = createStage(document.getElementById('app')!);

  // Interim T1.2 demo (replaced by the real game in T1.3-T1.5): load hole 1 and drop a ball on the tee.
  await RAPIER.init();
  const hole = KITCHEN_TABLE[0]!;
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  loadHoleIntoWorld(world, hole, {
    surfaces: {
      felt: { friction: 0.8, restitution: 0.2 },
      wood: { friction: 0.5, restitution: 0.3 },
      sugar: { friction: 1, restitution: 0.05 },
    },
    wallRestitution: 0.6,
    bumperRestitution: 0.9,
  });
  const [tx, ty, tz] = hole.tee;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(tx, ty + 1, tz));
  world.createCollider(RAPIER.ColliderDesc.ball(0.15).setRestitution(0.5), body);

  const ball = new Mesh(
    new IcosahedronGeometry(0.15, 1),
    new MeshStandardMaterial({ color: 0xffffff, flatShading: true }),
  );
  ball.castShadow = true;
  stage.scene.add(buildHoleMeshes(hole), ball);
  stage.fitShadows(0, 0, 3, 9);
  stage.rig.snapTo(tx, ty, tz);

  stage.start((dt) => {
    world.timestep = dt;
    world.step();
    const p = body.translation();
    ball.position.set(p.x, p.y, p.z);
    stage.rig.setFollow(p.x, p.y, p.z);
    stage.debug.update(dt, world);
  });
}

void main();
void connect(render);
