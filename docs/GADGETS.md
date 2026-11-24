# Gadgets (M4)

Gadget crates (cardboard boxes with a "?") sit on side paths of every hole. Walk into one while your slot is empty to get a random gadget (you can hold one at a time; a crate you cannot take stays full). A taken crate comes back after 20 s. Press **Q** to use the gadget. The server decides everything: it must be a hole in play, you must hold a gadget, wait at least 0.5 s since you got it, and your Windup must be on its feet (not toppled, not unwound). Gadgets and crates reset at the start of every hole.

All numbers are in `BALANCE` (`packages/shared/src/balance.ts`). In dev you can change them live with `apps/server/balance.dev.json` (see `balance.dev.example.json`).

| Gadget | Effect | Numbers (`BALANCE.gadgets...`) | Counter-play |
| --- | --- | --- | --- |
| **Bubble Wand** | Fires a slow bubble straight ahead (the way your Windup faces). The first **ball** it touches, anybody's including yours, is trapped: frozen in place, cannot be hit. After the trap it comes back at rest. The bubble pops on walls. | `bubble`: speed 5 m/s, radius 0.5 m, flies 4 s, trap 4 s, starts 1 m in front of you | Hit your ball before the bubble arrives (it then misses, or catches your ball further along). Stay out of the line of fire. |
| **Gum Blob** | A sticky patch on the floor 1.6 m in front of you. A ball that enters it stops dead and rests there; a Windup inside it moves at 40% speed (you too). Max 1 patch per player; a new one replaces the old. | `gum`: radius 1 m, lasts 20 s, Windup speed x0.4 | Aim shots around the patch, or hit the ball out of it (a ball shot from inside is not caught again until it left and re-enters). Walk round it, or sprint through. |
| **Desk Fan** | A 2 s cone of wind in front of you. It pushes balls (also resting ones) and other Windups away from you; your own Windup is not pushed. Effect fades to half strength at the far end. | `fan`: duration 2 s, range 5 m, half angle 50 degrees, ball push 10 m/s^2, Windup drift 4 m/s | Stay out of the cone (50 degrees each side), keep a ball tucked behind a wall, or sprint (8 m/s beats the 4 m/s drift). |
| **Fridge Magnet** | For 5 s the **other** players' balls that are moving within 4 m of your ball are pulled gently towards your ball. Resting balls and your own ball are not affected. | `magnet`: duration 5 s, range 4 m, pull 3.5 m/s^2 | Wait until the magnet is gone to shoot, or shoot so the ball does not pass within 4 m of the magnet ball. |

Crates: pick-up radius 0.9 m, respawn 20 s, use cooldown 0.5 s (`BALANCE.crate`). Which gadget a crate gives comes from a per-match seeded random generator (the server picks a random seed for every match).

## Rules of thumb

- Gadgets only act through the server. Balls are moved by the server's ball world; Windups, which walk in private worlds, are changed by two inputs of their step: a walking-speed multiplier (gum) and a drift displacement (fan wind).
- A trapped ball cannot be shot, so the owner cannot take a stroke until it is released. A ball trapped in mid-air stays where it is and then drops with no speed.
- Players who already holed out keep their gadgets and can still use them on the others.
