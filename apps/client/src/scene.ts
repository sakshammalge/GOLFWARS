import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

/** Spinning low-poly placeholder: a green plane (fairway) with a white ball on it. */
export function startScene(container: HTMLElement): void {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x9fd3f2);

  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0.5, 0);

  scene.add(new AmbientLight(0xffffff, 1.2));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(4, 8, 3);
  scene.add(sun);

  const spinner = new Group();
  const plane = new Mesh(
    new PlaneGeometry(6, 6, 1, 1),
    new MeshStandardMaterial({ color: 0x4caf50, flatShading: true }),
  );
  plane.rotation.x = -Math.PI / 2;
  const ball = new Mesh(
    new IcosahedronGeometry(0.6, 1),
    new MeshStandardMaterial({ color: 0xffffff, flatShading: true }),
  );
  ball.position.y = 0.6;
  spinner.add(plane, ball);
  scene.add(spinner);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop((time) => {
    spinner.rotation.y = time / 2000;
    renderer.render(scene, camera);
  });
}
