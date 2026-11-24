import { GADGET_INFO, type GadgetType } from '@golfwars/shared';

/** Hand-drawn SVG icons of the four gadgets (no external assets). */
const SVG: Record<GadgetType, string> = {
  bubble: `<circle cx="24" cy="24" r="17" fill="#9fdcff" fill-opacity="0.45" stroke="#d9f3ff" stroke-width="3"/><path d="M14 20 Q16 12 24 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="31" cy="32" r="3" fill="#fff" fill-opacity="0.7"/>`,
  gum: `<path d="M24 8 L30 14 L40 14 L36 22 L42 30 L33 33 L30 42 L24 36 L17 42 L14 33 L6 30 L12 22 L8 14 L18 14 Z" fill="#ff7eb6" stroke="#c9407f" stroke-width="2.5" stroke-linejoin="round"/><circle cx="19" cy="22" r="3" fill="#ffc2dc"/>`,
  fan: `<circle cx="24" cy="24" r="4" fill="#4a5560"/><path d="M24 24 L21 6 Q24 3 27 6 Z" fill="#7fb8e6"/><path d="M24 24 L42 21 Q45 24 42 27 Z" fill="#7fb8e6"/><path d="M24 24 L27 42 Q24 45 21 42 Z" fill="#7fb8e6"/><path d="M24 24 L6 27 Q3 24 6 21 Z" fill="#7fb8e6"/><circle cx="24" cy="24" r="21" fill="none" stroke="#4a5560" stroke-width="2.5"/>`,
  magnet: `<path d="M11 40 L11 22 A13 13 0 0 1 37 22 L37 40 L29 40 L29 22 A5 5 0 0 0 19 22 L19 40 Z" fill="#e5484d" stroke="#8c1f24" stroke-width="2" stroke-linejoin="round"/><rect x="11" y="33" width="8" height="7" fill="#f2f2f2"/><rect x="29" y="33" width="8" height="7" fill="#f2f2f2"/>`,
};

/** An <svg> element with the gadget's icon (48x48). */
export function gadgetIcon(g: GadgetType, size = 44): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${GADGET_INFO[g].name}">${SVG[g]}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
