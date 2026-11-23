import RAPIER from '@dimforge/rapier3d-compat';
import { IcosahedronGeometry, Mesh, MeshStandardMaterial, BoxGeometry } from 'three';
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

  // Temporary stage demo (replaced by the course loader in T1.2): a floor and a dropping ball.
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.2, 8).setTranslation(0, -0.2, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.15).setRestitution(0.6), body);

  const floor = new Mesh(
    new BoxGeometry(8, 0.4, 16),
    new MeshStandardMaterial({ color: 0x4caf50, flatShading: true }),
  );
  floor.position.y = -0.2;
  floor.receiveShadow = true;
  const ball = new Mesh(
    new IcosahedronGeometry(0.15, 1),
    new MeshStandardMaterial({ color: 0xffffff, flatShading: true }),
  );
  ball.castShadow = true;
  stage.scene.add(floor, ball);
  stage.rig.snapTo(0, 0.2, 0);

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
