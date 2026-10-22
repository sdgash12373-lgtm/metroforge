import './style.css';
import { City, type SaveData } from './sim/city';
import { KAOHSIUNG } from './sim/terrain';
import { World } from './render/world';
import { Hud, SPEEDS } from './ui/hud';
import { attachInput } from './ui/input';
import { ToolController } from './ui/tools';

const SAVE_KEY = 'skyline-city:save';
const TICK_SECONDS = 0.5;
const LOCK_KEY = 'skyline-city:build-mode';

function newCity(): City {
  const city = new City(KAOHSIUNG);
  // The highway exit the city grows from
  const gate = { x: -480, y: 60 };
  city.buildRoad({ kind: 'free', p: gate }, { x: -240, y: 40 }, { kind: 'free', p: { x: 0, y: 0 } }, true);
  const node = [...city.net.nodes.values()].find((n) => n.p.x === gate.x && n.p.y === gate.y);
  if (node) city.addOutsideConnection(node.id);
  return city;
}

function loadCity(): City {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return City.deserialize(JSON.parse(raw) as SaveData);
  } catch (err) {
    console.warn('Could not load the saved city', err);
  }
  return newCity();
}

function save(city: City): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(city.serialize()));
  } catch {
    // Storage can be full or blocked (private mode); the game keeps running
  }
}

const app = document.getElementById('app')!;
const coarse = matchMedia('(pointer: coarse)').matches;
const world = new World(app, !coarse);
let city = loadCity();
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
  newCity: () => {
    city = newCity();
    city.maxVehicles = MAX_VEHICLES;
    tools.setCity(city);
    world.invalidate();
    tools.setTool('road');
    focusCity();
    save(city);
    hud!.toast('新城市已建立');
  },
});
attachInput(world.renderer.domElement, world.rig, tools);
try {
  world.rig.locked = localStorage.getItem(LOCK_KEY) === '1';
} catch {
  // Storage blocked: start unlocked
}
hud.lockButton.setAttribute('aria-pressed', String(world.rig.locked));

function focusCity(): void {
  world.rig.target = { x: -60, y: 10 };
  world.rig.distance = coarse ? 360 : 280;
  world.rig.apply();
}
focusCity();
tools.setTool('road');
hud.render();

function resize(): void {
  world.resize(app.clientWidth, app.clientHeight);
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;
let saveAcc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[hud!.speed];
  acc += dt * speed;
  while (acc >= TICK_SECONDS) {
    acc -= TICK_SECONDS;
    city.tick();
  }
  // Vehicles move in real seconds, sped up with the game; small steps keep queues stable
  const drive = dt * speed;
  const steps = Math.ceil(drive / 0.1);
  for (let i = 0; i < steps; i++) city.drive(drive / steps);
  saveAcc += dt;
  if (saveAcc > 10) {
    saveAcc = 0;
    save(city);
  }
  world.sync(city);
  world.animate(city, dt);
  hud!.update(city);
  hud!.updateHint();
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save(city);
});
