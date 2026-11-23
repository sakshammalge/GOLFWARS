import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CameraRig } from './cameraRig.js';
import { DebugOverlay } from './debugOverlay.js';
import { Keys } from './input.js';

export const SKY_COLOR = 0x9fd3f2;

export interface Stage {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  rig: CameraRig;
  keys: Keys;
  debug: DebugOverlay;
  sun: DirectionalLight;
  /** Fit the sun's shadow frustum around a course of the given XZ half-extents, centred at cx,cz. */
  fitShadows(cx: number, cz: number, halfX: number, halfZ: number): void;
  /** Starts the render loop; `frame` is called every frame with dt in seconds before rendering. */
  start(frame: (dt: number) => void): void;
}

/** Renderer, lights (hemisphere + soft-shadow sun), sky colour and the orbit camera. */
export function createStage(container: HTMLElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);

  const camera = new PerspectiveCamera(50, 1, 0.1, 200);
  const keys = new Keys();
  const rig = new CameraRig(camera, renderer.domElement, keys);

  scene.add(new HemisphereLight(0xdff1ff, 0x8a7355, 1.5));
  const sun = new DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const debug = new DebugOverlay(scene);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const fitShadows = (cx: number, cz: number, halfX: number, halfZ: number): void => {
    const r = Math.hypot(halfX, halfZ) + 2;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + r * 0.5, r * 1.1, cz + r * 0.35);
    const cam = sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };
  fitShadows(0, 0, 10, 10);

  const start = (frame: (dt: number) => void): void => {
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      frame(dt);
      rig.update(dt);
      renderer.render(scene, camera);
    });
  };

  return { scene, camera, renderer, rig, keys, debug, sun, fitShadows, start };
}
