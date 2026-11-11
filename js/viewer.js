// 3D preview. Scene units are millimetres, Z up, model corner at the origin.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

const SUN_ELEVATION = (38 * Math.PI) / 180;
const PLAIN = { print: 0xc9cdd3, laser: 0xd9b985 };

export class Viewer {
  constructor(container, compass) {
    this.container = container;
    this.compass = compass;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
    this.camera.up.set(0, 0, 1);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9a9488, 1.45);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);
    this.sunAzimuth = 315;

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.ground);

    this.topMaterial = new THREE.MeshStandardMaterial({ color: PLAIN.print, roughness: 0.95, metalness: 0 });
    this.sideMaterial = new THREE.MeshStandardMaterial({ color: PLAIN.print, roughness: 0.9, metalness: 0, flatShading: true });
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => { this.userMoved = true; });
    this.userMoved = false;
    this.insets = { top: 16, right: 16, bottom: 16, left: 16 };

    this.surface = 'satellite';
    this.mode = 'print';
    this.texture = null;
    this.dims = null;
    this.pending = false;
    this.frames = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setTheme();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    if (this.dims && !this.userMoved) this.resetView();
    this.invalidate();
  }

  // Free area of the canvas, in CSS pixels from each edge, that overlays leave open.
  setInsets(insets) {
    const same = ['top', 'right', 'bottom', 'left'].every((k) => this.insets[k] === insets[k]);
    if (same) return;
    this.insets = { ...insets };
    this.applyViewOffset();
    if (this.dims && !this.userMoved) this.resetView();
    this.invalidate();
  }

  // Shift the image so the orbit centre sits in the middle of the free area.
  applyViewOffset() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const { top, right, bottom, left } = this.insets;
    const sx = (left - right) / 2;
    const sy = (top - bottom) / 2;
    if (sx || sy) this.camera.setViewOffset(w, h, -sx, -sy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  invalidate() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderer.render(this.scene, this.camera);
      this.frames++;
      this.updateCompass();
    });
  }

  setTheme() {
    const bg = getComputedStyle(this.container).getPropertyValue('--view-bg').trim() || '#eef0f3';
    this.scene.background = new THREE.Color(bg);
    this.invalidate();
  }

  // model: { positions, index, topIndexCount, nx, ny, widthMm, depthMm, zMax }
  setModel(model, { refit = true } = {}) {
    this.clearMeshes();
    const { positions, index, topIndexCount, nx, ny } = model;
    const position = new THREE.BufferAttribute(positions, 3);
    const uv = new Float32Array((positions.length / 3) * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const o = (j * nx + i) * 2;
        uv[o] = i / (nx - 1);
        uv[o + 1] = 1 - j / (ny - 1);
      }
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', position);
    top.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    top.setIndex(new THREE.BufferAttribute(index.subarray(0, topIndexCount), 1));
    const sides = new THREE.BufferGeometry();
    sides.setAttribute('position', position);
    sides.setIndex(new THREE.BufferAttribute(index.subarray(topIndexCount), 1));

    this.topMesh = new THREE.Mesh(top, this.topMaterial);
    this.sideMesh = new THREE.Mesh(sides, this.sideMaterial);
    for (const mesh of [this.topMesh, this.sideMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.position = position;
    this.ground.visible = true;
    const previous = this.dims;
    this.dims = null;
    this.applyDims(model, refit || !previous);
  }

  // Same grid, new size settings. The positions array was refilled in place.
  updateModel(model) {
    if (!this.topMesh) return;
    this.applyDims(model, false);
  }

  applyDims(model, refit) {
    const { widthMm, depthMm, zMax } = model;
    this.position.needsUpdate = true;
    this.topMesh.geometry.computeVertexNormals();
    const previous = this.dims;
    this.dims = { widthMm, depthMm, zMax };
    const radius = 0.5 * Math.hypot(widthMm, depthMm, zMax);
    this.radius = radius;
    this.ground.scale.setScalar(radius * 6);
    this.ground.position.set(widthMm / 2, depthMm / 2, -0.02);
    this.camera.near = radius / 200;
    this.camera.far = radius * 60;
    this.controls.minDistance = radius * 0.25;
    this.controls.maxDistance = radius * 12;
    if (refit || !this.userMoved) {
      this.resetView();
    } else if (previous) {
      // Keep the framing when the model is resized: scale the camera about the origin corner.
      const f = widthMm / previous.widthMm;
      this.camera.position.multiplyScalar(f);
      this.controls.target.multiplyScalar(f);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
    this.placeSun();
    this.invalidate();
  }

  // Frame the model inside the free area of the canvas, using its real vertices:
  // the bounding box overstates a slab whose high ground sits in the middle.
  resetView() {
    if (!this.dims || !this.position) return;
    const { widthMm, depthMm, zMax } = this.dims;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const { top, right, bottom, left } = this.insets;
    const freeW = Math.max(80, w - left - right);
    const freeH = Math.max(80, h - top - bottom);
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanFreeV = tanV * (freeH / h);
    const tanFreeH = tanV * (freeW / h);

    // Look from the south-south-west; tilt down more in a tall pane so the slab fills it.
    const tilt = ((freeW / freeH < 1 ? 50 : 36) * Math.PI) / 180;
    const dir = new THREE.Vector3(-0.287 * Math.cos(tilt), -0.958 * Math.cos(tilt), Math.sin(tilt)); // target -> camera
    const rightAxis = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 0, 1)).normalize();
    const upAxis = new THREE.Vector3().crossVectors(rightAxis, dir.clone().negate()).normalize();
    const target = new THREE.Vector3(widthMm / 2, depthMm / 2, zMax / 2);
    let distance = this.radius / Math.min(tanFreeH, tanFreeV);

    const a = this.position.array;
    const step = 3 * Math.max(1, Math.floor(a.length / 3 / 120000));
    for (let pass = 0; pass < 6; pass++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < a.length; i += step) {
        const px = a[i] - target.x;
        const py = a[i + 1] - target.y;
        const pz = a[i + 2] - target.z;
        const depth = distance - (px * dir.x + py * dir.y + pz * dir.z);
        if (depth <= 0) continue;
        const x = (px * rightAxis.x + py * rightAxis.y + pz * rightAxis.z) / depth;
        const y = (px * upAxis.x + py * upAxis.y + pz * upAxis.z) / depth;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      target.addScaledVector(rightAxis, ((x0 + x1) / 2) * distance);
      target.addScaledVector(upAxis, ((y0 + y1) / 2) * distance);
      distance *= Math.max((x1 - x0) / 2 / tanFreeH, (y1 - y0) / 2 / tanFreeV) * 1.06;
    }
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.controls.target.copy(target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.userMoved = false;
    this.invalidate();
  }

  placeSun() {
    if (!this.dims) return;
    const { widthMm, depthMm, zMax } = this.dims;
    const az = (this.sunAzimuth * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(SUN_ELEVATION), Math.cos(az) * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION));
    const r = this.radius;
    this.sun.target.position.set(widthMm / 2, depthMm / 2, zMax / 2);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, r * 3);
    const cam = this.sun.shadow.camera;
    cam.left = -r * 1.6; cam.right = r * 1.6; cam.top = r * 1.6; cam.bottom = -r * 1.6;
    cam.near = r * 0.5; cam.far = r * 6;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = r * 0.002;
  }

  setSun(azimuth) {
    this.sunAzimuth = azimuth;
    this.placeSun();
    this.invalidate();
  }

  setDrape(canvas) {
    if (this.texture) { this.texture.dispose(); this.texture = null; }
    if (canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.texture = texture;
    }
    this.applyMaterial();
  }

  setSurface(surface) {
    this.surface = surface;
    this.applyMaterial();
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMaterial();
  }

  applyMaterial() {
    const draped = this.surface === 'satellite' && this.texture;
    this.topMaterial.map = draped ? this.texture : null;
    this.topMaterial.color.setHex(draped ? 0xffffff : PLAIN[this.mode]);
    this.sideMaterial.color.setHex(PLAIN[this.mode]);
    this.topMaterial.needsUpdate = true;
    this.invalidate();
  }

  updateCompass() {
    if (!this.compass || !this.dims) return;
    const a = this.controls.target.clone().project(this.camera);
    const b = this.controls.target.clone().add(new THREE.Vector3(0, this.radius * 0.1, 0)).project(this.camera);
    const angle = (Math.atan2((b.x - a.x) * this.camera.aspect, b.y - a.y) * 180) / Math.PI;
    this.compass.style.transform = `rotate(${angle.toFixed(1)}deg)`;
  }

  clearMeshes() {
    for (const mesh of [this.topMesh, this.sideMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.topMesh = null;
    this.sideMesh = null;
  }

  clear() {
    this.clearMeshes();
    this.dims = null;
    this.ground.visible = false;
    this.invalidate();
  }
}
