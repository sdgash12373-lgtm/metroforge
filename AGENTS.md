# Metroforge：都市創造

A city builder in TypeScript + Three.js, played in the browser on phones and desktops.

- `src/sim/`: the simulation (roads, zoning, traffic, transit, money). It is plain TypeScript and does no rendering.
- `src/render/`: Three.js layers, drawn with instanced low-poly meshes.
- `src/ui/`: HUD, tools and menus. All player-facing text is in Traditional Chinese.
- `src/changelog.ts`: release notes, shown on the start screen and in the in-game ticker.

## Checks

```
npm run typecheck
npm test
npm run build
```

## Code Review Rules

- **Saves must keep loading.** A change to `SaveData` or `City.deserialize` must still load older saves.
- **Simulation is deterministic.** It takes the `rng` passed in. Flag `Math.random()` inside simulation logic in `src/sim/`; the default argument of `City.tick` is fine.
- **The renderer stays cheap.**
  - Render work runs every frame on phones.
  - Flag per-frame allocations in hot loops.
  - Flag new non-instanced meshes per building or vehicle.
  - Flag an InstancedMesh written past its capacity.
- **Touch controls must work.**
  - UI changes must work with touch: tap targets at least about 40 px, and no hover-only actions.
  - Text inputs need `user-select: text` on iOS.
- **Money stays in balance.** Taxes, upkeep and income are per simulation step (`DAY_STEPS` = 2400 a day) and shown per month. Check unit conversions.
- **Player-facing text** must be Traditional Chinese, and say 捷運 for metro.
- **No secrets or personal data** in the repo.
