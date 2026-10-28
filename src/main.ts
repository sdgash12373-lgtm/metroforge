import './style.css';
import { City, DAY_STEPS, FREEWAYS, freewayPoint } from './sim/city';
import { type RegionName, TERRAINS, type TerrainName } from './sim/terrain';
import { clock } from './sim/weather';
import { AUTO_SLOT, SaveSlots, openStore } from './storage/saves';
import { Menu, type Settings } from './ui/menu';
import { World } from './render/world';
import { Hud, SPEEDS } from './ui/hud';
import { latestTicker, markSeen, seenLatest, watchForNewVersion } from './ui/updates';
import { attachInput } from './ui/input';
import { type Tool, ToolController } from './ui/tools';
import { DriveMode } from './ui/drive';

/** Seconds per simulation step at normal speed; DAY_STEPS of them make a 20-minute day. */
const TICK_SECONDS = 0.5;
const LOCK_KEY = 'skyline-city:build-mode';
const SETTINGS_KEY = 'skyline-city:settings';

function newCity(name = '我的城市', terrain: TerrainName = 'kaohsiung', region: RegionName = 'kaohsiung'): City {
  const city = new City(TERRAINS[terrain]);
  city.name = name;
  city.regions = new Set([region]);
  // The freeway and interchange the city grows from
  city.buildFreeway(region);
  return city;
}

function loadSettings(coarse: boolean): Settings {
  const defaults: Settings = { shadows: !coarse, autosave: 60 };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

const app = document.getElementById('app')!;
const coarse = matchMedia('(pointer: coarse)').matches;
let settings = loadSettings(coarse);
const world = new World(app, settings.shadows);
// The map behind the start screen until a game starts
let city = newCity();
// Phones get fewer vehicles to keep the frame rate up
const MAX_VEHICLES = coarse ? 220 : 450;
city.maxVehicles = MAX_VEHICLES;

let hud: Hud | null = null;
const tools = new ToolController(city, world, {
  toast: (m) => hud?.toast(m),
  changed: () => hud?.render(),
});
hud = new Hud(document.getElementById('ui')!, tools, {
  toggleBuildMode: () => {
    world.rig.locked = !world.rig.locked;
    try {
      localStorage.setItem(LOCK_KEY, world.rig.locked ? '1' : '0');
    } catch {
      // Preference only; fine to lose
    }
    return world.rig.locked;
  },
  setSpeed: (i) => {
    hud!.speed = i;
    hud!.render();
  },
  openMenu: () => {
    void autosave();
    menu.show('pause');
  },
  faceNorth: () => {
    world.rig.yaw = 0;
    world.rig.apply();
  },
  lookAt: (p) => {
    world.rig.target = { x: p.x, y: p.y };
    world.rig.distance = Math.min(world.rig.distance, 320);
    world.rig.apply();
  },
  drive: () => {
    toolBeforeDrive = tools.tool;
    tools.setTool('pan');
    if (!patrol.start(city)) tools.setTool(toolBeforeDrive);
    else {
      hud!.speed = 1;
      hud!.render();
    }
  },
});
let toolBeforeDrive: Tool = 'road';
const patrol: DriveMode = new DriveMode(document.getElementById('ui')!, world, {
  toast: (m) => hud?.toast(m),
  changed: () => {
    if (!patrol?.active && tools.tool === 'pan') tools.setTool(toolBeforeDrive);
    hud?.render();
  },
});
attachInput(world.renderer.domElement, world.rig, tools);
try {
  world.rig.locked = localStorage.getItem(LOCK_KEY) === '1';
} catch {
  // Storage blocked: start unlocked
}
hud.lockButton.setAttribute('aria-pressed', String(world.rig.locked));

/** Looks at the built-up part of town, or at the interchange and the road into town in a new city. */
function focusCity(): void {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const seg of city.net.segments.values()) {
    for (const l of seg.lots) {
      if (!l.level) continue;
      x += l.x;
      y += l.y;
      n++;
    }
  }
  // A new city: between the interchange and the end of the road into town, of the region it starts in
  const f = FREEWAYS[city.regions.has('kaohsiung') ? 'kaohsiung' : [...city.regions][0]];
  world.rig.target = n ? { x: x / n, y: y / n } : freewayPoint(f, 0, (f.exit + f.town) / 2 - 40);
  world.rig.distance = coarse ? 360 : 280;
  world.rig.pitch = 0.85;
  world.rig.apply();
}
focusCity();
tools.setTool('road');
hud.render();

/** Swaps in another city, keeping the view and tools in step. */
function setCity(next: City): void {
  patrol.stop();
  city = next;
  city.maxVehicles = MAX_VEHICLES;
  tools.setCity(city);
  world.invalidate();
  tools.setTool('road');
  focusCity();
  hud!.render();
}

let saveAcc = 0;
const slots = new SaveSlots(await openStore());
try {
  await slots.migrateLegacy(localStorage);
} catch {
  // No localStorage here, so no old save either
}
let saving = false;
/** Writes the game being played to the auto slot; skipped at the start screen or while a save runs. */
async function autosave(): Promise<void> {
  if (!menu.inGame || saving) return;
  saving = true;
  try {
    await slots.save(AUTO_SLOT, city, world.thumbnail());
  } catch (err) {
    console.warn('Auto-save failed', err);
    hud!.toast('自動存檔失敗（儲存空間可能已滿）');
  } finally {
    saving = false;
  }
}

const menu: Menu = new Menu(document.getElementById('ui')!, slots, {
  play: (next) => {
    setCity(next);
    hud!.speed = 1;
    hud!.render();
    saveAcc = 0;
    // Tell the player what this version brought, once, after the menu has closed
    if (!seenLatest()) setTimeout(() => hud!.ticker(latestTicker(), { loops: 2, done: markSeen }), 400);
  },
  newCity: (name, terrain, region) => newCity(name, terrain, region),
  saveTo: async (slot) => {
    try {
      await slots.save(slot, city, world.thumbnail());
    } catch (err) {
      console.warn('Save failed', err);
      hud!.toast('存檔失敗（儲存空間可能已滿）');
    }
  },
  quit: async () => {
    patrol.stop();
    await autosave();
    showcase();
  },
  settings: () => settings,
  setSettings: (s) => {
    settings = s;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // Preference only
    }
  },
  toast: (m) => hud!.toast(m),
});
// The start screen shows the last city played, if there is one
const latest = await slots.latest();
if (latest) {
  try {
    setCity(await slots.load(latest.id));
  } catch (err) {
    console.warn('Could not load the latest save', err);
  }
}
/** A wide view of the city behind the start screen. */
function showcase(): void {
  world.rig.target = { x: 0, y: 0 };
  world.rig.distance = coarse ? 1100 : 800;
  world.rig.pitch = 0.5;
  world.rig.apply();
}
showcase();
menu.show('home');
watchForNewVersion((version, title) =>
  hud!.ticker(`有新版本 v${version}${title ? `「${title}」` : ''}已發布，重新整理頁面即可更新`, {
    action: { label: '重新整理', run: () => location.reload() },
  }),
);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.open && menu.inGame) menu.close();
});

function resize(): void {
  world.resize(app.clientWidth, app.clientHeight);
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let lastSky = city.weather.sky;
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  // Paused under the menu; the start screen slowly circles the city
  const speed = menu.open ? 0 : SPEEDS[hud!.speed];
  if (menu.open && !menu.inGame) {
    world.rig.yaw += dt * 0.04;
    world.rig.apply();
  }
  acc += dt * speed;
  while (acc >= TICK_SECONDS) {
    acc -= TICK_SECONDS;
    city.tick();
  }
  // Vehicles move in real seconds, sped up with the game; small steps keep queues stable
  const drive = dt * speed;
  const steps = Math.ceil(drive / 0.1);
  for (let i = 0; i < steps; i++) city.drive(drive / steps);
  if (!menu.open && settings.autosave > 0) {
    saveAcc += dt;
    if (saveAcc > settings.autosave) {
      saveAcc = 0;
      void autosave();
    }
  }
  world.sync(city);
  patrol.update(dt);
  const days = city.day + acc / TICK_SECONDS / DAY_STEPS;
  const weather = city.weather.at(world.rig.target, days);
  world.animate(city, dt, Math.min(drive, 0.5), clock(days).hour, weather.precip);
  world.updateSky(days, weather, dt);
  hud!.setWeather(weather);
  if (city.weather.sky !== lastSky) {
    if (city.weather.sky === 'typhoon' && !menu.open) hud!.ticker('🌀 颱風警報：颱風來襲，觀光客暫停來訪，請注意風雨', { loops: 2 });
    lastSky = city.weather.sky;
  }
  hud!.update(city, acc / TICK_SECONDS / DAY_STEPS);
  hud!.setHeading(world.rig.yaw);
  hud!.updateHint();
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !menu.open) void autosave();
});
