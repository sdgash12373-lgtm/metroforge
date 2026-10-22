import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Conditions } from '../sim/weather';
import { SkySystem, addWindows } from './sky';
import type { AngleGuide } from '../sim/angles';
import type { City, District } from '../sim/city';
import type { GuideLine } from '../sim/guides';
import { type Quad, type Vec2, closestOnSamples, bboxNear } from '../sim/geometry';
import { roadWidth } from '../sim/roads';
import { Zone } from '../sim/zoning';
import { BuildingLayer } from './buildings';
import { CameraRig } from './cameraRig';
import type { PathPiece } from '../sim/transit';
import { buildDashedLines, buildLinePaths, buildTunnelOverlay, buildPreviewGeometry, buildRoadGeometries, buildTrafficOverlay, streetTreeSpots } from './roadMesh';
import { StopLayer } from './transit';
import { buildFacilityGeometry } from './facilities';
import { SignalLayer } from './signals';
import { HILL_TREES, LOWLAND_TREES, MAP_SIZE, type TreeSpot, buildGroundGeometry, treeSpots } from './terrainMesh';
import { FLAT, type Terrain, WATER_LEVEL } from '../sim/terrain';
import { VehicleLayer } from './vehicles';
import { PedestrianLayer } from './pedestrians';
import { RAIL_KINDS, type RailKind, TRACK_OFFSET } from '../sim/rail';
import type { RoadNetwork } from '../sim/roads';
import { buildAirportGeometry, PlaneLayer } from './airport';
import { buildTrackGeometries } from './railMesh';
import { StationLayer } from './stations';
import { TrainLayer } from './trains';

/** Everything drawn for one kind of train. */
interface RailLayer {
  tracks: THREE.Group;
  stations: StationLayer;
  trains: TrainLayer;
  /** line routes, shown while that kind's tool is active */
  lines: THREE.Mesh;
  /** underground track marked on the surface */
  tunnels: THREE.Mesh;
  version: number;
  transitVersion: number;
}

const TREE_COUNT = LOWLAND_TREES + HILL_TREES;
const STREET_TREES = 4000;

/** A round-crowned street tree in one geometry, coloured per vertex. */
function mergeTree(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    return g;
  };
  const trunk = paint(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 5).translate(0, 1.2, 0).toNonIndexed(), 0x6e5238);
  const crown = paint(new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3.6, 0), 0x4f8f45);
  const planter = paint(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 6).translate(0, 0.08, 0).toNonIndexed(), 0x5b4a3a);
  return mergeGeometries([trunk, crown, planter])!;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private readonly sun: THREE.DirectionalLight;
  /** day and night, clouds, rain and fog */
  private readonly sky: SkySystem;
  private readonly roadGroup = new THREE.Group();
  private readonly buildings: BuildingLayer;
  private readonly vehicles: VehicleLayer;
  private decluttered = false;
  private xray = false;
  private readonly stops: StopLayer;
  /** bus routes, shown while the bus tool is active */
  private readonly linePaths: THREE.Mesh;
  /** route of the bus line being drawn */
  private readonly draftLine: THREE.Mesh;
  /** roads cut off from the highway, in red while the warning shows */
  private readonly cutOff: THREE.Mesh;
  private cutOffKey = '';
  private transitVersion = -1;
  private readonly ground: THREE.Mesh;
  /** tunnels shown on the surface while building underground */
  private readonly tunnels: THREE.Mesh;
  private peopleAge = 0;
  private readonly rails: Record<RailKind, RailLayer>;
  private readonly airports: THREE.Mesh;
  private readonly planes: PlaneLayer;
  private readonly signals: SignalLayer;
  private aviationVersion = -1;
  /** which kind of transport's lines are shown, if any */
  private lineView: 'bus' | RailKind | null = null;
  private readonly overlay: THREE.Mesh;
  private overlayAge = Infinity;
  private readonly trees: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh; spots: TreeSpot[] };
  readonly pedestrians: PedestrianLayer;
  /** trees planted along wide sidewalks */
  private readonly streetTrees: THREE.InstancedMesh;
  private terrain: Terrain = FLAT;
  private readonly water: THREE.Mesh;
  private readonly preview: THREE.Mesh;
  private readonly cursor: THREE.Mesh;
  private readonly brush: THREE.Mesh;
  private readonly angleGroup = new THREE.Group();
  private readonly guideLines: THREE.Mesh;
  /** outline of an airport about to be placed */
  private readonly footprint: THREE.Mesh;
  private readonly districtRings = new THREE.Group();
  /** service areas while placing a facility */
  private readonly coverage = new THREE.Group();
  private readonly facilities: THREE.Mesh;
  private facilitiesVersion = -1;
  /** street and district names over the map */
  private readonly nameLayer: HTMLElement;
  private names: { at: THREE.Vector3; dir: THREE.Vector3 | null; el: HTMLElement; street: boolean }[] = [];
  private labelsVersion = -1;
  private readonly projected2 = new THREE.Vector3();
  private readonly angleLabels: HTMLElement;
  private guides: { at: THREE.Vector3; label: HTMLElement }[] = [];
  private readonly projected = new THREE.Vector3();
  private roadsVersion = -1;
  private lotsVersion = -1;
  private showEmpty = false;
  private readonly materials = {
    sidewalk: new THREE.MeshLambertMaterial({ color: 0xc4c7c2, side: THREE.DoubleSide }),
    asphalt: new THREE.MeshLambertMaterial({ color: 0x5f646b, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    markings: new THREE.MeshBasicMaterial({ color: 0xf2e6b0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
    preview: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    concrete: new THREE.MeshLambertMaterial({ color: 0xb9b6ae, side: THREE.DoubleSide, flatShading: true }),
    /** viaducts of track, kept solid when the streets fade */
    railConcrete: new THREE.MeshLambertMaterial({ color: 0xb9b6ae, side: THREE.DoubleSide, flatShading: true }),
    tunnel: new THREE.MeshBasicMaterial({ color: 0x1c1f24, side: THREE.DoubleSide }),
    ballast: new THREE.MeshLambertMaterial({ color: 0x968d82, side: THREE.DoubleSide }),
    sleepers: new THREE.MeshLambertMaterial({ color: 0x6b5a48, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    steel: new THREE.MeshLambertMaterial({ color: 0xa7adb3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
  };

  constructor(container: HTMLElement, shadows: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(1);
    const sky = 0xbcd8ea;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 1500, 4200);

    const hemi = new THREE.HemisphereLight(0xe8f2ff, 0x7b9a5a, 1.5);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.sky = new SkySystem(this.scene, this.sun, hemi, matchMedia('(pointer: coarse)').matches);

    this.ground = new THREE.Mesh(buildGroundGeometry(FLAT), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.ground.receiveShadow = true;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2).translate(0, WATER_LEVEL, 0),
      new THREE.MeshLambertMaterial({ color: 0x4f97bf, transparent: true, opacity: 0.88 }),
    );
    this.water.visible = false;
    this.scene.add(this.ground, this.water);
    this.scene.add(this.roadGroup);
    this.buildings = new BuildingLayer(shadows);
    this.scene.add(this.buildings.group);
    this.trees = this.makeTrees(shadows);
    this.streetTrees = new THREE.InstancedMesh(
      mergeTree(),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      STREET_TREES,
    );
    this.streetTrees.castShadow = shadows;
    this.streetTrees.count = 0;
    this.scene.add(this.streetTrees);
    this.vehicles = new VehicleLayer(shadows);
    this.scene.add(this.vehicles.group);
    this.pedestrians = new PedestrianLayer(shadows);
    this.scene.add(this.pedestrians.mesh);
    this.overlay = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    this.overlay.visible = false;
    this.overlay.renderOrder = 1;
    this.scene.add(this.overlay);
    this.stops = new StopLayer(shadows);
    this.scene.add(this.stops.group);
    const pathMaterial = () =>
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.linePaths = new THREE.Mesh(new THREE.BufferGeometry(), pathMaterial());
    this.linePaths.visible = false;
    this.linePaths.renderOrder = 1;
    this.draftLine = new THREE.Mesh(new THREE.BufferGeometry(), pathMaterial());
    this.draftLine.visible = false;
    this.draftLine.renderOrder = 2;
    this.scene.add(this.linePaths, this.draftLine);
    this.cutOff = new THREE.Mesh(new THREE.BufferGeometry(), pathMaterial());
    this.cutOff.visible = false;
    this.cutOff.renderOrder = 2;
    this.scene.add(this.cutOff);
    this.tunnels = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x3f8fd8, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.tunnels.visible = false;
    this.tunnels.renderOrder = 2;
    this.scene.add(this.tunnels);

    const rail = (kind: RailKind): RailLayer => {
      const layer: RailLayer = {
        tracks: new THREE.Group(),
        stations: new StationLayer(shadows),
        trains: new TrainLayer(kind, shadows),
        lines: new THREE.Mesh(new THREE.BufferGeometry(), pathMaterial()),
        tunnels: new THREE.Mesh(new THREE.BufferGeometry(), this.tunnels.material),
        version: -1,
        transitVersion: -1,
      };
      layer.lines.visible = false;
      layer.lines.renderOrder = 1;
      layer.tunnels.visible = false;
      layer.tunnels.renderOrder = 2;
      this.scene.add(layer.tracks, layer.stations.mesh, layer.trains.group, layer.lines, layer.tunnels);
      return layer;
    };
    this.rails = { metro: rail('metro'), train: rail('train'), hsr: rail('hsr') };
    this.airports = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.airports.receiveShadow = true;
    this.airports.castShadow = false;
    this.planes = new PlaneLayer(shadows);
    this.signals = new SignalLayer(shadows);
    this.facilities = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.facilities.castShadow = shadows;
    addWindows(this.buildings.material, this.sky.night);
    addWindows(this.facilities.material as THREE.MeshLambertMaterial, this.sky.night, 0.7);
    this.facilities.receiveShadow = true;
    this.scene.add(this.facilities);
    this.scene.add(this.airports, this.planes.group, this.signals.group);

    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), this.materials.preview);
    this.preview.visible = false;
    this.preview.renderOrder = 10;
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.4, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2b134, depthTest: false, transparent: true }),
    );
    this.cursor.renderOrder = 3;
    this.cursor.visible = false;
    this.brush = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.brush.renderOrder = 3;
    this.brush.visible = false;
    this.guideLines = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.guideLines.renderOrder = 4;
    this.guideLines.visible = false;
    this.footprint = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    this.footprint.renderOrder = 4;
    this.footprint.visible = false;
    this.scene.add(this.preview, this.cursor, this.brush, this.angleGroup, this.guideLines, this.footprint);
    this.angleLabels = document.createElement('div');
    this.angleLabels.className = 'angle-labels';
    this.nameLayer = document.createElement('div');
    this.nameLayer.className = 'angle-labels map-names';
    container.after(this.nameLayer, this.angleLabels);
    this.scene.add(this.districtRings, this.coverage);
  }

  private makeTrees(shadows: boolean) {
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3c, flatShading: true }),
      TREE_COUNT,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2, 5, 6).translate(0, 4.2, 0),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      TREE_COUNT,
    );
    const spots = treeSpots(FLAT);
    for (const m of [trunks, crowns]) {
      m.castShadow = shadows;
      this.scene.add(m);
    }
    return { trunks, crowns, spots };
  }

  /** Clears trees that stand on roads or zoned cells. */
  private updateTrees(city: City): void {
    const zoned = new Set<string>();
    for (const seg of city.net.segments.values()) {
      for (const l of seg.lots) if (!l.blocked && l.zone !== Zone.None) zoned.add(`${Math.round(l.x / 4)},${Math.round(l.y / 4)}`);
    }
    const near = (x: number, y: number) => {
      const gx = Math.round(x / 4);
      const gy = Math.round(y / 4);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (zoned.has(`${gx + i},${gy + j}`)) return true;
      return false;
    };
    const segs = [...city.net.segments.values()];
    const m = new THREE.Matrix4();
    let n = 0;
    for (const t of this.trees.spots) {
      if (!t.wild && (near(t.x, t.y) || city.occupied(t))) continue;
      if (segs.some((s) => bboxNear(s.bbox, t, roadWidth(s) / 2 + 2) && closestOnSamples(s.samples, t).d < roadWidth(s) / 2 + 2)) continue;
      m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.h, t.y);
      this.trees.trunks.setMatrixAt(n, m);
      this.trees.crowns.setMatrixAt(n, m);
      this.trees.crowns.setColorAt(n, t.color);
      n++;
    }
    this.trees.trunks.count = n;
    this.trees.crowns.count = n;
    this.trees.trunks.instanceMatrix.needsUpdate = true;
    this.trees.crowns.instanceMatrix.needsUpdate = true;
    if (this.trees.crowns.instanceColor) this.trees.crowns.instanceColor.needsUpdate = true;
    const street = streetTreeSpots(city.net).slice(0, STREET_TREES);
    street.forEach((t, i) => {
      const k = 0.9 + ((i * 7) % 5) * 0.06;
      m.makeScale(k, k, k).setPosition(t.x, 0, t.y);
      this.streetTrees.setMatrixAt(i, m);
    });
    this.streetTrees.count = street.length;
    this.streetTrees.instanceMatrix.needsUpdate = true;
  }

  /** Forces a full rebuild on the next sync, e.g. after switching to another city. */
  invalidate(): void {
    this.roadsVersion = -1;
    this.lotsVersion = -1;
    this.transitVersion = -1;
    this.aviationVersion = -1;
    this.facilitiesVersion = -1;
    this.labelsVersion = -1;
    for (const k of RAIL_KINDS) {
      this.rails[k].version = -1;
      this.rails[k].transitVersion = -1;
    }
  }

  /** Colours roads by congestion (the traffic view). */
  setTrafficOverlay(on: boolean): void {
    this.overlay.visible = on;
    this.overlayAge = Infinity;
  }

  setShowEmptyCells(on: boolean): void {
    if (on === this.showEmpty) return;
    this.showEmpty = on;
    this.buildings.showEmptyCells = on;
    this.lotsVersion = -1;
  }

  /** See-through ground, so tunnels and the one being drawn show beneath it. */
  setXray(on: boolean): void {
    const m = this.ground.material as THREE.MeshLambertMaterial;
    if (m.transparent === on) return;
    this.xray = on;
    this.water.visible = !on && this.terrain !== FLAT;
    m.transparent = on;
    m.opacity = on ? 0.3 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
    // The ghost road may be under the ground: draw it over everything
    this.materials.preview.depthTest = !(on || this.decluttered);
    this.materials.preview.needsUpdate = true;
    this.scene.background = new THREE.Color(on ? 0x5d6b62 : 0xbcd8ea);
  }

  /** Hides buildings, trees and traffic and fades the streets, so metro track is never hidden by the city. */
  setDeclutter(on: boolean): void {
    if (this.decluttered === on) return;
    this.decluttered = on;
    this.buildings.group.visible = !on;
    this.facilities.visible = !on;
    this.trees.trunks.visible = !on;
    this.trees.crowns.visible = !on;
    this.streetTrees.visible = !on;
    this.vehicles.group.visible = !on;
    this.pedestrians.mesh.visible = !on;
    this.signals.group.visible = !on;
    const { sidewalk, asphalt, markings, concrete } = this.materials;
    for (const m of [sidewalk, asphalt, markings, concrete]) {
      m.transparent = on;
      m.opacity = on ? 0.35 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    // Track and the ghost of new track are drawn after the faded streets, over them
    const { ballast, sleepers, steel, railConcrete } = this.materials;
    for (const m of [ballast, sleepers, steel, railConcrete]) {
      m.transparent = on;
      m.depthTest = !on;
      m.needsUpdate = true;
    }
    this.materials.preview.depthTest = !(on || this.xray);
    this.materials.preview.needsUpdate = true;
  }

  /** Shows road and track tunnels on the surface above them. */
  setUndergroundView(on: boolean): void {
    this.tunnels.visible = on;
    for (const k of RAIL_KINDS) this.rails[k].tunnels.visible = on;
  }

  /** Shows one kind of transport's routes (that tool's view), or none. */
  setLineOverlay(kind: 'bus' | RailKind | null): void {
    this.lineView = kind;
    this.linePaths.visible = kind === 'bus';
    for (const k of RAIL_KINDS) this.rails[k].lines.visible = kind === k;
  }

  /** Route of a line being planned (or a street being named), or null. */
  setDraftLine(path: PathPiece[] | null, color: number, net?: RoadNetwork, offset?: number, width = 2.2): void {
    this.draftLine.visible = !!path?.length;
    if (!path?.length) return;
    this.draftLine.geometry.dispose();
    const rail = this.lineView !== 'bus' && this.lineView !== null;
    this.draftLine.geometry = buildLinePaths(net ?? this.cityRef!.net, [{ color, path }], width, offset ?? (rail ? TRACK_OFFSET : undefined));
  }

  /** Paints the roads that can't reach the highway red (both ways along each), or hides them. */
  private syncCutOff(city: City): void {
    const segs = city.stats.disconnected ? city.disconnectedRoads() : [];
    const key = `${city.roadsVersion}:${segs.length}`;
    if (key === this.cutOffKey) return;
    this.cutOffKey = key;
    this.cutOff.visible = segs.length > 0;
    this.cutOff.geometry.dispose();
    this.cutOff.geometry = segs.length
      ? buildLinePaths(city.net, [{ color: 0xe5483b, path: segs.map((x) => ({ seg: x.id, dir: 1 as const, from: 0, to: x.length })) }], 3, 0)
      : new THREE.BufferGeometry();
  }

  /** Outlines of the districts (the district tool's view); the selected one is drawn bolder. */
  setDistrictRings(list: District[] | null, selected: number | null): void {
    for (const c of [...this.districtRings.children]) {
      (c as THREE.Mesh).geometry.dispose();
      this.districtRings.remove(c);
    }
    for (const d of list ?? []) {
      const k = d.id === selected ? 0.985 : 0.993;
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * k, d.r, 96).rotateX(-Math.PI / 2), this.ringMaterial(d.color));
      ring.position.set(d.p.x, 0.4, d.p.y);
      ring.renderOrder = 3;
      this.districtRings.add(ring);
    }
  }

  /** Areas served by facilities, as tinted discs with a ring at the edge. */
  setCoverage(list: { p: Vec2; r: number; color: number }[]): void {
    for (const c of [...this.coverage.children]) {
      (c as THREE.Mesh).geometry.dispose();
      this.coverage.remove(c);
    }
    for (const a of list) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(a.r, 64).rotateX(-Math.PI / 2), this.discMaterial(a.color));
      disc.position.set(a.p.x, 0.35, a.p.y);
      disc.renderOrder = 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(a.r * 0.99, a.r, 96).rotateX(-Math.PI / 2), this.ringMaterial(a.color));
      ring.position.set(a.p.x, 0.4, a.p.y);
      ring.renderOrder = 3;
      this.coverage.add(disc, ring);
    }
  }

  private discMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private discMaterial(color: number): THREE.MeshBasicMaterial {
    let m = this.discMaterials.get(color);
    if (!m) this.discMaterials.set(color, (m = new THREE.MeshBasicMaterial({ color, depthWrite: false, transparent: true, opacity: 0.16 })));
    return m;
  }

  private ringMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private ringMaterial(color: number): THREE.MeshBasicMaterial {
    let m = this.ringMaterials.get(color);
    if (!m) this.ringMaterials.set(color, (m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })));
    return m;
  }

  /** Street names along their roads and district names, as text over the map. */
  private rebuildNames(city: City): void {
    this.nameLayer.replaceChildren();
    this.names = [];
    const add = (text: string, x: number, y: number, h: number, cls: string, dir?: Vec2, color?: number) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      if (color !== undefined) el.style.color = `#${color.toString(16).padStart(6, '0')}`;
      this.nameLayer.append(el);
      this.names.push({ at: new THREE.Vector3(x, h + 0.5, y), dir: dir ? new THREE.Vector3(x + dir.x * 10, h + 0.5, y + dir.y * 10) : null, el, street: !!dir });
    };
    for (const d of city.districts.values()) add(d.name, d.p.x, d.p.y, 0, 'map-name district', undefined, d.color);
    // Street labels: at the middle of the longer pieces, never two of one name within 220 m
    const placed: { name: string; x: number; y: number }[] = [];
    const segs = [...city.net.segments.values()].filter((s) => s.name).sort((a, b) => b.length - a.length);
    for (const seg of segs) {
      const S = seg.samples;
      const steps = Math.max(1, Math.floor(seg.length / 260));
      for (let k = 0; k < steps; k++) {
        const target = (seg.length * (k + 0.5)) / steps;
        let i = 1;
        while (i < S.length - 1 && S[i].s < target) i++;
        const a = S[i - 1];
        const b = S[i];
        if (placed.some((p) => p.name === seg.name && Math.hypot(p.x - a.x, p.y - a.y) < 220)) continue;
        placed.push({ name: seg.name!, x: a.x, y: a.y });
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        add(seg.name!, a.x, a.y, Math.max(0, city.net.heightAt(seg, a.t)), 'map-name street', { x: (b.x - a.x) / l, y: (b.y - a.y) / l });
      }
    }
  }

  setPreview(q: Quad | null, ok: boolean, ha = 0, hb = 0): void {
    if (!q) {
      this.preview.visible = false;
      return;
    }
    this.preview.geometry.dispose();
    this.preview.geometry = buildPreviewGeometry(q, ha, hb);
    this.materials.preview.color.setHex(ok ? 0xffffff : 0xff6b5b);
    this.preview.visible = true;
  }

  /** Arcs on the ground plus degree labels between the road being drawn and the roads it meets. */
  setAngleGuides(list: AngleGuide[]): void {
    for (const child of [...this.angleGroup.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.angleGroup.remove(child);
    }
    this.angleLabels.replaceChildren();
    this.guides = [];
    const radius = Math.max(10, this.rig.snapRadius * 2.2);
    for (const g of list) {
      // RingGeometry lies in XY; after rotateX(-90°) the angle θ points along (cos θ, -sin θ) in sim space
      const t1 = Math.atan2(-g.road.y, g.road.x);
      let delta = Math.atan2(-g.other.y, g.other.x) - t1;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const start = delta < 0 ? t1 + delta : t1;
      const color = angleColor(g.degrees);
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.9, radius, 32, 1, start, Math.abs(delta)).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      arc.position.set(g.at.x, 0.35, g.at.y);
      arc.renderOrder = 4;
      this.angleGroup.add(arc);
      // Label sits on the bisector, just outside the arc
      const mid = start + Math.abs(delta) / 2;
      const at = new THREE.Vector3(g.at.x + Math.cos(mid) * radius * 1.45, 0.4, g.at.y - Math.sin(mid) * radius * 1.45);
      const label = document.createElement('div');
      label.className = 'angle-label';
      label.textContent = `${Math.round(g.degrees)}°`;
      label.style.borderColor = `#${color.toString(16).padStart(6, '0')}`;
      this.angleLabels.append(label);
      this.guides.push({ at, label });
    }
  }

  /** Dashed alignment lines from existing road ends to the snapped point. */
  setGuideLines(lines: GuideLine[]): void {
    this.guideLines.visible = lines.length > 0;
    if (!lines.length) return;
    this.guideLines.geometry.dispose();
    this.guideLines.geometry = buildDashedLines(lines, Math.max(0.6, this.rig.distance * 0.004));
  }

  /** Dashed outline of land about to be built on (an airport), red when it can't be afforded. */
  setFootprint(corners: Vec2[] | null, ok: boolean): void {
    this.footprint.visible = !!corners;
    if (!corners) return;
    this.footprint.geometry.dispose();
    const lines = corners.map((from, i) => ({ from, to: corners[(i + 1) % corners.length] }));
    this.footprint.geometry = buildDashedLines(lines, Math.max(1.2, this.rig.distance * 0.006));
    (this.footprint.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0xffffff : 0xff6b5b);
  }

  setCursor(p: Vec2 | null, snapped: boolean, h = 0): void {
    this.cursor.visible = !!p;
    if (!p) return;
    this.cursor.position.set(p.x, h + 0.3, p.y);
    const k = snapped ? 1.4 : 1;
    this.cursor.scale.setScalar(k);
  }

  setBrush(p: Vec2 | null, radius: number, color: number): void {
    this.brush.visible = !!p;
    if (!p) return;
    this.brush.position.set(p.x, 0.3, p.y);
    this.brush.scale.setScalar(radius);
    (this.brush.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /** Per-frame updates: vehicles always, the traffic colours a few times a second. */
  animate(city: City, dt: number, simDt = dt, hour = 12, rain = 0): void {
    this.pedestrians.update(city, simDt, hour, rain);
    this.vehicles.update(city.traffic, (v) => city.transit.lines.get(v.line ?? -1)?.color ?? 0xf2b134);
    for (const k of RAIL_KINDS) this.rails[k].trains.update(city.rails[k]);
    this.planes.update(city.aviation);
    this.signals.update(city.traffic, city.net);
    this.peopleAge += dt;
    if (this.peopleAge > 0.5) {
      this.peopleAge = 0;
      this.stops.updatePeople(city);
    }
    if (!this.overlay.visible) return;
    this.overlayAge += dt;
    if (this.overlayAge < 0.5) return;
    this.overlayAge = 0;
    this.overlay.geometry.dispose();
    this.overlay.geometry = buildTrafficOverlay(city.net, (seg, dir) => city.traffic.congestion(seg, dir));
  }

  private cityRef: City | null = null;

  /** Reshapes the ground, sea and forests for the land a city stands on. */
  private setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.ground.geometry.dispose();
    this.ground.geometry = buildGroundGeometry(terrain);
    this.water.visible = terrain !== FLAT && !this.xray;
    this.trees.spots = treeSpots(terrain);
  }

  sync(city: City): void {
    this.cityRef = city;
    if (city.terrain !== this.terrain) {
      this.setTerrain(city.terrain);
      this.updateTrees(city);
    }
    if (city.transit.version !== this.transitVersion || city.roadsVersion !== this.roadsVersion) {
      this.transitVersion = city.transit.version;
      this.stops.rebuild(city);
      this.linePaths.geometry.dispose();
      this.linePaths.geometry = buildLinePaths(city.net, [...city.transit.lines.values()]);
    }
    if (city.roadsVersion !== this.roadsVersion) {
      this.roadsVersion = city.roadsVersion;
      for (const child of [...this.roadGroup.children]) {
        (child as THREE.Mesh).geometry.dispose();
        this.roadGroup.remove(child);
      }
      const g = buildRoadGeometries(city.net);
      const walk = new THREE.Mesh(g.sidewalk, this.materials.sidewalk);
      walk.receiveShadow = true;
      const asphalt = new THREE.Mesh(g.asphalt, this.materials.asphalt);
      asphalt.receiveShadow = true;
      this.tunnels.geometry.dispose();
      this.tunnels.geometry = buildTunnelOverlay(city.net);
      const concrete = new THREE.Mesh(g.concrete, this.materials.concrete);
      concrete.castShadow = true;
      concrete.receiveShadow = true;
      const mouths = new THREE.Mesh(g.dark, this.materials.tunnel);
      this.roadGroup.add(walk, asphalt, new THREE.Mesh(g.markings, this.materials.markings), concrete, mouths);
      this.updateTrees(city);
    }
    for (const k of RAIL_KINDS) this.syncRail(city, k);
    this.syncCutOff(city);
    if (city.labelsVersion + city.roadsVersion * 1e6 !== this.labelsVersion) {
      this.labelsVersion = city.labelsVersion + city.roadsVersion * 1e6;
      this.rebuildNames(city);
    }
    if (city.aviation.version !== this.aviationVersion) {
      this.aviationVersion = city.aviation.version;
      this.airports.geometry.dispose();
      this.airports.geometry = buildAirportGeometry(city.aviation.airports.values());
    }
    if (city.facilitiesVersion !== this.facilitiesVersion) {
      this.facilitiesVersion = city.facilitiesVersion;
      this.facilities.geometry.dispose();
      this.facilities.geometry = buildFacilityGeometry(city.facilities.values());
    }
    if (city.lotsVersion !== this.lotsVersion) {
      const zoningChanged = this.lotsVersion !== -1;
      this.lotsVersion = city.lotsVersion;
      this.buildings.update(city);
      if (zoningChanged) this.updateTrees(city);
    }
  }

  private syncRail(city: City, kind: RailKind): void {
    const sys = city.rails[kind];
    const layer = this.rails[kind];
    const tracks = sys.version !== layer.version;
    if (tracks) {
      layer.version = sys.version;
      for (const child of [...layer.tracks.children]) {
        (child as THREE.Mesh).geometry.dispose();
        layer.tracks.remove(child);
      }
      const g = buildTrackGeometries(sys.net, kind !== 'metro');
      const ballast = new THREE.Mesh(g.ballast, this.materials.ballast);
      ballast.receiveShadow = true;
      const concrete = new THREE.Mesh(g.concrete, this.materials.railConcrete);
      concrete.castShadow = true;
      concrete.receiveShadow = true;
      const sleepers = new THREE.Mesh(g.sleepers, this.materials.sleepers);
      const steel = new THREE.Mesh(g.steel, this.materials.steel);
      // Layered bottom to top, for when track is drawn over the streets without depth testing
      [concrete, ballast, sleepers, steel].forEach((m, i) => (m.renderOrder = 3 + i));
      layer.tracks.add(ballast, sleepers, steel, concrete, new THREE.Mesh(g.dark, this.materials.tunnel));
      layer.tunnels.geometry.dispose();
      layer.tunnels.geometry = buildTunnelOverlay(sys.net);
    }
    if (tracks || sys.transit.version !== layer.transitVersion) {
      layer.transitVersion = sys.transit.version;
      layer.stations.rebuild(sys);
      layer.lines.geometry.dispose();
      layer.lines.geometry = buildLinePaths(sys.net, [...sys.transit.lines.values()], 1.4, TRACK_OFFSET);
    }
  }

  /** Moves the name labels to where their spot is on screen, turning street names along the road. */
  private placeNames(): void {
    if (!this.names.length) return;
    const el = this.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const streets = this.rig.distance < 1500;
    for (const n of this.names) {
      this.projected.copy(n.at).project(this.rig.camera);
      const hidden = this.projected.z > 1 || Math.abs(this.projected.x) > 1.2 || Math.abs(this.projected.y) > 1.2 || (n.street && !streets);
      n.el.hidden = hidden;
      if (hidden) continue;
      const x = ((this.projected.x + 1) / 2) * W;
      const y = ((1 - this.projected.y) / 2) * H;
      let turn = 0;
      if (n.dir) {
        this.projected2.copy(n.dir).project(this.rig.camera);
        turn = Math.atan2(-(this.projected2.y - this.projected.y) * H, (this.projected2.x - this.projected.x) * W);
        // Keep the text the right way up
        if (turn > Math.PI / 2) turn -= Math.PI;
        if (turn < -Math.PI / 2) turn += Math.PI;
      }
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${turn}rad)`;
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  /** A small JPEG of the current view, for save slots. */
  thumbnail(width = 240, height = 150): string | undefined {
    try {
      this.render();
      const src = this.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      // Centre crop to the thumbnail's shape
      const scale = Math.min(src.width / width, src.height / height);
      const sw = width * scale;
      const sh = height * scale;
      c.getContext('2d')?.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined;
    }
  }

  /** Time of day and the weather where the camera looks. */
  updateSky(days: number, w: Conditions, dt: number): void {
    this.sky.update(days, w, dt, this.rig.target, this.rig.distance, this.xray);
    // Unlit road paint dims with the light; street lights warm the asphalt at night
    this.materials.markings.color.setHex(0xf2e6b0).multiplyScalar(this.sky.light);
    this.materials.asphalt.emissive.setHex(0x3a2a12).multiplyScalar(this.sky.night.value);
  }

  render(): void {
    // Keep the shadow camera centered on what the player is looking at (the sky aims the sun there)
    const span = Math.min(900, Math.max(150, this.rig.distance * 1.2));
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, this.rig.camera);
    this.placeNames();
    if (this.guides.length) {
      const el = this.renderer.domElement;
      for (const g of this.guides) {
        this.projected.copy(g.at).project(this.rig.camera);
        const x = ((this.projected.x + 1) / 2) * el.clientWidth;
        const y = ((1 - this.projected.y) / 2) * el.clientHeight;
        g.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
    }
  }
}

/** Sharp junctions are hard to drive through: warn under 30°, mark right angles. */
function angleColor(deg: number): number {
  if (deg < 30) return 0xff6b5b;
  if (Math.abs(deg - 90) < 1) return 0x7ee08a;
  return 0xf2b134;
}
