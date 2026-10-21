import * as THREE from 'three';
import type { AngleGuide } from '../sim/angles';
import type { City } from '../sim/city';
import type { GuideLine } from '../sim/guides';
import { type Quad, type Vec2, closestOnSamples, bboxNear, hash01 } from '../sim/geometry';
import { ROAD_WIDTH } from '../sim/roads';
import { Zone } from '../sim/zoning';
import { BuildingLayer } from './buildings';
import { CameraRig } from './cameraRig';
import type { PathPiece } from '../sim/transit';
import { buildDashedLines, buildLinePaths, buildTunnelOverlay, buildPreviewGeometry, buildRoadGeometries, buildTrafficOverlay } from './roadMesh';
import { StopLayer } from './transit';
import { VehicleLayer } from './vehicles';

const MAP_SIZE = 4000;
const TREE_COUNT = 6000;
const TREE_AREA = 1400;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private readonly sun: THREE.DirectionalLight;
  private readonly roadGroup = new THREE.Group();
  private readonly buildings: BuildingLayer;
  private readonly vehicles: VehicleLayer;
  private readonly stops: StopLayer;
  /** bus routes, shown while the bus tool is active */
  private readonly linePaths: THREE.Mesh;
  /** route of the bus line being drawn */
  private readonly draftLine: THREE.Mesh;
  private transitVersion = -1;
  /** tunnels shown on the surface while building underground */
  private readonly tunnels: THREE.Mesh;
  private peopleAge = 0;
  private readonly overlay: THREE.Mesh;
  private overlayAge = Infinity;
  private readonly trees: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh; spots: { x: number; y: number; s: number; color: THREE.Color }[] };
  private readonly preview: THREE.Mesh;
  private readonly cursor: THREE.Mesh;
  private readonly brush: THREE.Mesh;
  private readonly angleGroup = new THREE.Group();
  private readonly guideLines: THREE.Mesh;
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
    tunnel: new THREE.MeshBasicMaterial({ color: 0x1c1f24, side: THREE.DoubleSide }),
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
    this.scene.fog = new THREE.Fog(sky, 900, 2600);

    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x7b9a5a, 1.5));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.makeGround());
    this.scene.add(this.roadGroup);
    this.buildings = new BuildingLayer(shadows);
    this.scene.add(this.buildings.group);
    this.trees = this.makeTrees(shadows);
    this.vehicles = new VehicleLayer(shadows);
    this.scene.add(this.vehicles.group);
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
    this.tunnels = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x3f8fd8, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.tunnels.visible = false;
    this.tunnels.renderOrder = 2;
    this.scene.add(this.tunnels);

    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), this.materials.preview);
    this.preview.visible = false;
    this.preview.renderOrder = 2;
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
    this.scene.add(this.preview, this.cursor, this.brush, this.angleGroup, this.guideLines);
    this.angleLabels = document.createElement('div');
    this.angleLabels.className = 'angle-labels';
    container.after(this.angleLabels);
  }

  private makeGround(): THREE.Mesh {
    const seg = 160;
    const g = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg).rotateX(-Math.PI / 2).toNonIndexed();
    const pos = g.getAttribute('position');
    const colors: number[] = [];
    const base = new THREE.Color(0x9cbf74);
    const c = new THREE.Color();
    // One flat color per triangle for the low-poly look
    for (let i = 0; i < pos.count; i += 3) {
      const v = hash01(pos.getX(i) + pos.getX(i + 1), pos.getZ(i) + pos.getZ(i + 2));
      c.copy(base).offsetHSL((v - 0.5) * 0.02, 0, (v - 0.5) * 0.025);
      for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    return mesh;
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
    const spots: { x: number; y: number; s: number; color: THREE.Color }[] = [];
    // Clumped forest: trees cluster around a few hundred seeds
    let i = 0;
    while (spots.length < TREE_COUNT && i < TREE_COUNT * 4) {
      i++;
      const cx = (hash01(i, 1) - 0.5) * TREE_AREA * 2;
      const cy = (hash01(1, i) - 0.5) * TREE_AREA * 2;
      if (hash01(Math.floor(cx / 120), Math.floor(cy / 120)) < 0.45) continue;
      const s = 1.1 + hash01(cx, cy) * 1.1;
      const color = new THREE.Color().setHSL(0.27 + (s - 1.6) * 0.04, 0.42, 0.32 + hash01(cy, cx) * 0.1);
      spots.push({ x: cx, y: cy, s, color });
    }
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
    const clear = ROAD_WIDTH / 2 + 2;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const t of this.trees.spots) {
      if (near(t.x, t.y)) continue;
      if (segs.some((s) => bboxNear(s.bbox, t, clear) && closestOnSamples(s.samples, t).d < clear)) continue;
      m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.y);
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
  }

  /** Forces a full rebuild on the next sync, e.g. after switching to another city. */
  invalidate(): void {
    this.roadsVersion = -1;
    this.lotsVersion = -1;
    this.transitVersion = -1;
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

  /** Shows tunnels on the surface above them. */
  setUndergroundView(on: boolean): void {
    this.tunnels.visible = on;
  }

  /** Shows the bus routes on the roads (the bus tool's view). */
  setLineOverlay(on: boolean): void {
    this.linePaths.visible = on;
  }

  /** Route of a bus line being planned, or null. */
  setDraftLine(path: PathPiece[] | null, color: number): void {
    this.draftLine.visible = !!path?.length;
    if (!path?.length) return;
    this.draftLine.geometry.dispose();
    this.draftLine.geometry = buildLinePaths(this.cityRef!.net, [{ color, path }], 2.2);
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
  animate(city: City, dt: number): void {
    this.vehicles.update(city.traffic, (v) => city.transit.lines.get(v.line ?? -1)?.color ?? 0xf2b134);
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

  sync(city: City): void {
    this.cityRef = city;
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
    if (city.lotsVersion !== this.lotsVersion) {
      const zoningChanged = this.lotsVersion !== -1;
      this.lotsVersion = city.lotsVersion;
      this.buildings.update(city);
      if (zoningChanged) this.updateTrees(city);
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  render(): void {
    // Keep the shadow camera centered on what the player is looking at
    const t = this.rig.target;
    const span = Math.min(900, Math.max(150, this.rig.distance * 1.2));
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    this.sun.position.set(t.x + 300, 600, t.y + 200);
    this.sun.target.position.set(t.x, 0, t.y);
    this.renderer.render(this.scene, this.rig.camera);
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
