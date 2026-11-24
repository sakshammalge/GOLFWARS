import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';

let crateTexture: CanvasTexture | null = null;

/** Cardboard texture with packing tape and a big "?" decal, drawn once on a canvas. */
function getCrateTexture(): CanvasTexture {
  if (crateTexture) return crateTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c98f4e';
  g.fillRect(0, 0, size, size);
  // Corrugation lines.
  g.strokeStyle = 'rgba(120, 72, 28, 0.25)';
  g.lineWidth = 2;
  for (let y = 8; y < size; y += 10) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
  }
  // Tape band.
  g.fillStyle = '#e8d3a0';
  g.fillRect(0, size / 2 - 7, size, 14);
  // The "?" decal.
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = '#5b3410';
  g.strokeText('?', size / 2, size / 2 + 6);
  g.fillStyle = '#ffd23f';
  g.fillText('?', size / 2, size / 2 + 6);
  // Border.
  g.strokeStyle = '#8a5a26';
  g.lineWidth = 6;
  g.strokeRect(3, 3, size - 6, size - 6);
  crateTexture = new CanvasTexture(c);
  crateTexture.colorSpace = SRGBColorSpace;
  return crateTexture;
}

/**
 * A gadget crate: a cardboard box with a "?" decal on every side. The group's origin is the box
 * centre; `animateCrate` bobs and turns it.
 */
export function createCrateMesh(size: number): Group {
  const g = new Group();
  const box = new Mesh(
    new BoxGeometry(size, size, size),
    new MeshStandardMaterial({ map: getCrateTexture(), flatShading: true, roughness: 0.9 }),
  );
  box.castShadow = true;
  g.add(box);
  return g;
}

/** Idle animation of an available crate (`t` in seconds); `baseY` is the box centre height. */
export function animateCrate(g: Group, baseY: number, t: number, phase: number): void {
  g.position.y = baseY + 0.12 + Math.sin(t * 2 + phase) * 0.06;
  g.rotation.y = t * 0.9 + phase;
}
