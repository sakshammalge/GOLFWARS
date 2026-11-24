/** The four MVP gadgets. Numbers live in `BALANCE.gadgets`; the table is `docs/GADGETS.md`. */
export const GADGETS = ['bubble', 'gum', 'fan', 'magnet'] as const;
export type GadgetType = (typeof GADGETS)[number];

export const GADGET_INFO: Record<GadgetType, { name: string; blurb: string }> = {
  bubble: { name: 'Bubble Wand', blurb: 'Fires a bubble that traps the first ball it touches' },
  gum: { name: 'Gum Blob', blurb: 'Sticky patch: balls stop dead, Windups slow down' },
  fan: { name: 'Desk Fan', blurb: 'A cone of wind pushes balls and other Windups away' },
  magnet: { name: 'Fridge Magnet', blurb: 'Pulls other moving balls towards your ball' },
};

/** Wire id: 0 = nothing held, 1.. = index + 1. */
export function gadgetId(g: GadgetType | null): number {
  return g === null ? 0 : GADGETS.indexOf(g) + 1;
}

export function gadgetFromId(id: number): GadgetType | null {
  return id >= 1 && id <= GADGETS.length ? GADGETS[id - 1]! : null;
}
