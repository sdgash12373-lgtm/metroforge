# v3.0.0 plan: 工業種類、港口與屏東區

Claude builds the core (regions, industry rules, port placement and the trade economy). Tasks D and E (the
3D work) were first planned for Codex; in the end Claude built them too, so everything here is done.
Read `AGENTS.md` first: saves must keep loading, the simulation stays deterministic, the renderer stays
cheap on phones, touch targets are about 40 px, money is per simulation step (`DAY_STEPS` = 2400 a day)
and shown per month, and all player-facing text is Traditional Chinese.

## Already done (the base of this PR)

- `src/sim/terrain.ts`: the `kaohsiung` terrain now covers southern Taiwan. Kaohsiung (the old square, up
  to the Gaoping River) is unchanged. Pingtung lies across the river, modelled on the real county: the
  Pingtung Plain, the Central Range with Dawu Mountain in the east reaching the sea in the south, the
  Donggang and Linbian rivers, Dapeng Bay lagoon, the coast bending south-east, and Xiaoliuqiu island.
  - `Terrain.sea(x, y)`: open sea and lagoons, not rivers.
  - `Terrain.region(x, y)`: `'kaohsiung' | 'pingtung' | null` (null = off the map).
  - `Terrain.bounds`: the map's extent (the square plus the Pingtung band to its south-east).
  - `REGION_NAMES`: `{ kaohsiung: '高雄區', pingtung: '屏東區' }`.
  - `FLAT` has a single `'kaohsiung'` region, the old square.
- `src/sim/city.ts`: `FREEWAYS` per region, `freewayPoint`, `freewayTown(region)`, `REGION_COST`
  (NT$1,000,000), and `City.buildFreeway(region = 'kaohsiung')`. Pingtung's freeway is 國道 3 號 up the
  plain, with the access road ending at Pingtung city by the river.
- `tests/pingtung.test.ts`.

## Work package A: 屏東區 (regions, unlocking, new games, drawing the bigger map)

Simulation (`src/sim/city.ts`):
- `City.regions: Set<RegionName>`, default `{ 'kaohsiung' }`. `City.open(p)` is true when
  `terrain.region(p)` is in `regions`.
- Nothing can be built outside the open regions. Add the check to `terrainProblem` (also for `FLAT`;
  sample every point, including tunnels and viaducts), `occupied` (so lots there are blocked), facilities
  (`footprintGrid`), airports, roundabouts. Messages: `屏東區尚未開通（城市升級為縣轄市後，可在等級面板花 NT$100萬 開通）`
  (use `REGION_NAMES`), and `超出地圖範圍` for null.
- `UNLOCK.region = 3` in `levels.ts` (縣轄市). Add `'開通其他區域（NT$100萬）'` to 縣轄市's unlocks list.
- `City.openRegion(r)`: refuses below 縣轄市, when already open, or without the money (`spend`, so it shows
  as 建設支出). It adds the region, lays that region's freeway if the region has no highway segment in it
  yet (an extra pair of outside connections), then `landChanged()`/`roadsChanged()` and a `regionsVersion`.
- New games can start in either region: `newCity(name, terrain, region)` sets `regions = { region }` and
  builds that region's freeway. The other region opens later the same way (縣轄市 + NT$100萬).
- Save `regions` (bump `SAVE_VERSION` to 9). Saves without it load as `{ 'kaohsiung' }`.
- Weather (`weather.ts`): prefix the region label with 屏東 in Pingtung (e.g. 屏東平原, 屏東山區).

Rendering:
- `terrainMesh.ts`: build the ground from `terrain.bounds` on the same 20 m grid, emitting only cells whose
  centre has a non-null `region` (keep the vertex count sane: no full rectangle). Same for the water
  surface (only cells near water), instead of the single `MAP_SIZE` plane in `world.ts`.
- Trees: keep the existing two tree sets in Kaohsiung exactly as they are and add a third set for the
  Pingtung band (more `TREE_COUNT` capacity; mountains forested like Kaohsiung's).
- Locked regions: a translucent dark tint over the locked region's ground plus a dashed border, and a big
  map label `屏東區・縣轄市後可開通` (or `高雄區…`) like the district labels. It goes away when opened.
- `cameraRig.ts`: clamp the target to `terrain.bounds` (set by the world when the terrain changes)
  instead of ±2000.
- `main.ts` `focusCity`: a new city looks at its own region's interchange (`freewayTown`).

UI:
- New game (`menu.ts`): the terrain choices become starting regions: `高雄` (海岸、平原、河流與東北高山),
  `屏東` (屏東平原、大武山、東港與小琉球), `平地`.
- Level panel (`hud.ts` `renderLevel`): a 區域 section listing each region with a button
  `開通屏東區 NT$100萬`, disabled with the reason below 縣轄市 or without the money. On success: ticker
  `🎉 屏東區開通了！國道 3 號已經通車` and move the view there.

Tests: building in a locked region fails with the message and succeeds after `openRegion`; opening needs
縣轄市 and the money; regions survive a save; an old save loads with only Kaohsiung; a Pingtung start has
its freeway and town in Pingtung and Kaohsiung locked.

## Work package B: 五種工業區

New zones in `src/sim/zoning.ts` (append to the enum so old saves keep their numbers; the save packs
`zone * 10 + level`, which still works above 9). All use the `I` demand. Keep `Zone.Industrial` and rename it
`一般工業`. Add a helper `isIndustry(zone)` and use it wherever the code checks `Zone.Industrial` for
industry behaviour (trucks in `spawnTrips`, etc).

| Zone | name | jobs/level | max level | export value | notes |
| --- | --- | --- | --- | --- | --- |
| `Processing` = 6 | 加工工業區 | 12 | 3 | 1.4 | like 加工出口區: most value when shipped out by a cargo port |
| `Forestry` = 7 | 林業 | 6 | 3 | 0.8 | only near mountain forest: the brush skips cells with no ground over 3 m within 160 m; hint says 林業要靠近山林 |
| `Chemical` = 8 | 化工業 | 10 | 3 | 1.8 | pollutes: homes within 250 m count one service fewer and residents are less happy |
| `SciencePark` = 9 | 科學園區 | 16 | 4 | 2.5 | clean; stays at level 1 unless a school covers it (educated workers) |
| `IndustrialPark` = 10 | 產業園區 | 12 | 4 | 1.2 | tidy multi-storey 標準廠房, little pollution |

(General 工業 is export value 1.0.) Export value feeds 外貿收入 in package C; for this package put the
values in `ZONES` (e.g. `goods`) so C can use them.

Painting: `paintZone` gets an optional `allowed(lot)` filter; `City.paint` passes the forestry check.

Rendering (`src/render/buildings.ts`, instanced as now, no new per-building meshes):
- 加工工業區: long white/blue sawtooth-roof halls with loading docks.
- 林業: open-sided sawmill sheds, stacked brown log piles and timber stacks, a small office.
- 化工業: silver storage tanks (use the cylinder `stacks` mesh, wide), a tall flare stack, pipe racks.
- 科學園區: clean white fab blocks with blue glass bands and rooftop plant, lawn around.
- 產業園區: 3–4 storey beige standard factory blocks with window bands and a company sign.
- Zone tile colours distinct from the existing ones.

UI: the zone dock lists the industries after the existing zones (`hud.ts`); the hint for 林業 explains the
forest rule; the bulldoze hint keeps working with the new names.

Tests: each zone grows; forestry can't be painted on the open plain but can at the foot of the hills;
chemical plants slow nearby homes; science parks need a school to grow; old saves load unchanged.

## Work package C: 港口 (cargo and cruise ports) and 外貿/觀光 income

Ports are facilities (`src/sim/facilities.ts`) with two new kinds in the 運輸 dock as a `port` tool with
sub-options 貨櫃港 / 旅遊港:
- `cargoPort` 貨櫃港: NT$3,000,000, w 160 × d 120, modelled on 高雄港 container terminals: concrete quay,
  red-and-white ship-to-shore gantry cranes, colourful container stacks, a warehouse, a docked container ship.
- `cruisePort` 旅遊港: NT$1,500,000, w 90 × d 80, modelled on 東港渡船頭 (the Donggang ferry pier for
  Xiaoliuqiu): a white two-storey terminal with a blue-green roof and a big 東港渡船頭-style sign board, a
  covered walkway to floating pontoons, and docked white-and-blue ferries.

Placement (must be on the coastline):
- Use `facilitySpot` as now (set back from the nearest street, depth axis pointing away from it).
- The front 20% of the depth (by the road) must be buildable land; the back 30% must all be `terrain.sea`
  (not rivers); the middle may be land or sea but not hillside. Otherwise `港口要蓋在海岸線上（靠路的一側在陸地，碼頭伸進海裡）`.
- It must also pass the usual checks (road beside it, no roads or track through it, open region).
- Render the quay deck over the water down to the sea bed (it stands in the sea).

Economy (`src/sim/city.ts`):
- 外貿收入 (`budget.trade`, new row in the budget under 其他收入, and in `budgetTotals`): each month the
  industry exports goods worth `jobs × goods × 900` NT$. Industry whose road connects to a cargo port's road
  ships it: the city earns `min(goods, capacity) × 25%` as trade income, where each cargo port handles
  NT$60,000,000 of goods a month. 加工工業區 earns nothing extra without a port. Cargo ports also add
  `+min(15, ports × 6)` to industrial demand.
- Freight: trucks drive from industry to a cargo port (spawned like the existing industry trucks), and keep
  coming from the highway when there is no port.
- 旅遊港: brings tourists like a landmark (`tourists: 14`), more with every landmark in the city
  (×(1 + 0.15 per landmark)), weather-scaled like the others; counted in 觀光收入.
- Upkeep like other facilities (cargo 900, cruise 450 per step), billed every 14 days.

Ships (`src/render/`): a small instanced ship layer: every port has one ship sailing out from its berth to
sea and back on a slow loop (container ships for cargo ports, ferries for cruise ports), plus the docked one
in the port geometry. Nothing allocated per frame.

Hints and the needs panel mention trade: `外貿收入 NT$… / 月（貨櫃港 n 座，出口量 x%）`.

Tests: a port inland or on a river is refused; on the coast it builds; trade income needs industry connected
to a cargo port and is capped by capacity; a cruise port raises tourism; ports survive save/load.

## Who builds what

Claude: package A, the simulation and UI of package B (zones, forestry/chemical/science-park rules,
painting, dock), and the simulation and UI of package C (placement, economy, freight, port tool).

Already in this PR for Codex to build on: the new `Zone` values and `ZONES` entries with `goods`,
`INDUSTRY_ZONES`, `isIndustry`, the `cargoPort` / `cruisePort` facility kinds (`PORT_KINDS`, `isPort`,
`PORT_LAND`, `PORT_BERTH`), and placeholder models for both.

### Task D: industry buildings (done by Claude)

Only `src/render/buildings.ts`. Replace the plain-factory stand-in for the five new zones with the looks in
package B's rendering list (加工工業區, 林業, 化工業, 科學園區, 產業園區), keeping general 工業 as it is.
Use the existing instanced meshes and `part()` (bodies, gable roofs, cylinders, signs); no new meshes per
building; stay under the `MAX`/`MAX_PARTS` capacities; vary details by `lot.seed` and grow with
`lot.level` (science parks and industrial parks go to level 4). `buildingShape` may get a case per zone.

### Task E: port models and ships (done by Claude)

- `src/render/facilities.ts`: replace the placeholder `cargoPort` and `cruisePort` models with detailed
  low-poly ones as described in package C (高雄港 container terminal; 東港渡船頭 ferry terminal). The
  facility frame: u along the road, v away from it (road side at -d/2, sea side at +d/2); the back
  `PORT_BERTH` of the depth is open water where the docked ship sits; the deck stands from the sea bed
  (z = -7) up to about z = 0.3.
- New `src/render/ships.ts`: an instanced ship layer (container ship for each cargo port, white-and-blue
  ferry for each cruise port) sailing slowly out from the berth along the port's +v direction about 900 m
  and back, in a loop driven by time; hidden while docked so it doesn't overlap the docked model, or
  start from just beyond it. Wire it into `src/render/world.ts` like `PlaneLayer` (`update` per frame,
  rebuilt list when `city.facilitiesVersion` changes, honour `setDeclutter`). No per-frame allocations.

## Release

`src/changelog.ts`: v3.0.0 「工業、港口與屏東區」 notes plus the ticker line. Claude writes this when integrating.
