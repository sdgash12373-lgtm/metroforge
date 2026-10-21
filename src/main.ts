import './style.css';
import { City, type SaveData } from './sim/city';
import { World } from './render/world';
import { Hud, SPEEDS } from './ui/hud';
import { attachInput } from './ui/input';
import { ToolController } from './ui/tools';

const SAVE_KEY = 'skyline-city:save';
const TICK_SECONDS = 0.5;

function newCity(): City {
  const city = new City();
  // The highway exit the city grows from
  city.buildRoad({ kind: 'free', p: { x: -480, y: 60 } }, { x: -240, y: 40 }, { kind: 'free', p: { x: 0, y: 0 } }, true);
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

let hud: Hud | null = null;
const tools = new ToolController(city, world, {
  toast: (m) => hud?.toast(m),
  changed: () => hud?.render(),
});
hud = new Hud(document.getElementById('ui')!, tools, {
  setSpeed: (i) => {
    hud!.speed = i;
    hud!.render();
  },
  newCity: () => {
    city = newCity();
    tools.setCity(city);
    world.invalidate();
    tools.setTool('road');
    focusCity();
    save(city);
    hud!.toast('新城市已建立');
  },
});
attachInput(world.renderer.domElement, world.rig, tools);

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
  acc += dt * SPEEDS[hud!.speed];
  while (acc >= TICK_SECONDS) {
    acc -= TICK_SECONDS;
    city.tick();
  }
  saveAcc += dt;
  if (saveAcc > 10) {
    saveAcc = 0;
    save(city);
  }
  world.sync(city);
  hud!.update(city);
  hud!.updateHint();
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save(city);
});
