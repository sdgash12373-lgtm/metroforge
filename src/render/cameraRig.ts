import * as THREE from 'three';
import { type Vec2, clamp } from '../sim/geometry';

/** City-builder camera: orbits a target point on the ground. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target: Vec2 = { x: 0, y: 0 };
  distance = 260;
  yaw = Math.PI / 4;
  pitch = 0.85;
  /** Build mode: rotation and tilt are frozen so gestures can't swing the view while drawing. */
  locked = false;
  /** Height of the plane taps land on: raised while drawing elevated roads so the pointer sits on the deck. */
  pickHeight = 0;
  /** First-person driving moves the camera itself; the orbit controls leave it alone. */
  driving = false;
  /** How far the view may wander: the map's extent */
  bounds = { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 };
  readonly minDistance = 40;
  readonly maxDistance = 1600;
  private readonly ray = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 6000);
    this.apply();
  }

  apply(): void {
    if (this.driving) return;
    this.distance = clamp(this.distance, this.minDistance, this.maxDistance);
    this.pitch = clamp(this.pitch, 0.35, 1.45);
    this.target.x = clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.y = clamp(this.target.y, this.bounds.minY, this.bounds.maxY);
    const h = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * h,
      Math.sin(this.pitch) * this.distance,
      this.target.y + Math.cos(this.yaw) * h,
    );
    this.camera.lookAt(this.target.x, 0, this.target.y);
  }

  /** Ground point (sim coordinates) under a screen position, or null when looking at the sky. */
  groundAt(sx: number, sy: number, w: number, h: number): Vec2 | null {
    this.ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    this.ground.constant = -this.pickHeight;
    const p = this.ray.ray.intersectPlane(this.ground, this.hit);
    return p ? { x: p.x, y: p.z } : null;
  }

  /** The ground point seen behind a point at height h (same screen position). */
  toGround(p: Vec2, h: number): Vec2 {
    const c = this.camera.position;
    const k = c.y / Math.max(0.01, c.y - h);
    return { x: c.x + (p.x - c.x) * k, y: c.z + (p.y - c.z) * k };
  }

  /** Rotates and tilts the view unless it is locked. */
  orbit(dYaw: number, dPitch: number): void {
    if (this.locked) return;
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.apply();
  }

  /** Drags the ground so the point under `from` ends up under `to`. */
  pan(from: Vec2 | null, to: Vec2 | null): void {
    if (!from || !to) return;
    this.target.x += from.x - to.x;
    this.target.y += from.y - to.y;
    this.apply();
  }

  /** Zooms keeping the ground point under the cursor in place. */
  zoomAt(factor: number, anchor: Vec2 | null): void {
    const before = this.distance;
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
    if (anchor) {
      const k = 1 - this.distance / before;
      this.target.x += (anchor.x - this.target.x) * k;
      this.target.y += (anchor.y - this.target.y) * k;
    }
    this.apply();
  }

  /** World-space snap radius that feels the same size on screen at any zoom. */
  get snapRadius(): number {
    return Math.max(6, this.distance * 0.03);
  }
}
