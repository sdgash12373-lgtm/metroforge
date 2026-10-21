import * as THREE from 'three';
import { type Vec2, clamp } from '../sim/geometry';

/** City-builder camera: orbits a target point on the ground. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target: Vec2 = { x: 0, y: 0 };
  distance = 260;
  yaw = Math.PI / 4;
  pitch = 0.85;
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
    this.distance = clamp(this.distance, this.minDistance, this.maxDistance);
    this.pitch = clamp(this.pitch, 0.35, 1.45);
    const lim = 2000;
    this.target.x = clamp(this.target.x, -lim, lim);
    this.target.y = clamp(this.target.y, -lim, lim);
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
    const p = this.ray.ray.intersectPlane(this.ground, this.hit);
    return p ? { x: p.x, y: p.z } : null;
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
