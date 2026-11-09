/**
 * "Budget city": an orbitable Three.js bar-field where each building is a budget line,
 * its footprint comes from a treemap and its height from dollars. Pure imperative class;
 * import it only on the client (dynamic import from onMount).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animate } from 'motion';

export interface CityBlock {
	key: string;
	/** opaque payload handed back on hover/click */
	ref: unknown;
	x0: number;
	z0: number;
	x1: number;
	z1: number;
	/** world-units height */
	h: number;
	color: string;
}
export interface CityDistrict {
	key: string;
	x0: number;
	z0: number;
	x1: number;
	z1: number;
	color: string;
}
export interface CityOptions {
	autoRotate?: boolean;
	/**
	 * Start with orbit/zoom/pan on. Off by default so the canvas never traps page scroll:
	 * touch swipes and the mouse wheel scroll the page until `setInteractive(true)`.
	 */
	interactive?: boolean;
	reducedMotion?: boolean;
	dark?: boolean;
	onHover?: (b: CityBlock | null, clientX: number, clientY: number) => void;
	onClick?: (b: CityBlock) => void;
	onFrame?: () => void;
	onContextLost?: () => void;
}

const SIZE = 100; // layout square in world units

export class CityScene {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2(-9, -9);
	private pointerClient = { x: 0, y: 0 };
	private pointerDirty = false;
	private down = { x: 0, y: 0, t: 0 };
	private raf = 0;
	private disposed = false;

	private boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
	private buildingMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.08 });
	private plinthMat = new THREE.MeshStandardMaterial({
		roughness: 0.9,
		transparent: true,
		opacity: 0.35
	});
	private groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
	private buildings?: THREE.InstancedMesh;
	private plinths?: THREE.InstancedMesh;
	private ground: THREE.Mesh;
	private grid: THREE.GridHelper;
	private blocks: CityBlock[] = [];
	private baseColors: THREE.Color[] = [];
	private hovered = -1;
	private grow = 1;
	private growAnim?: { stop: () => void };
	private flying = false;
	private interactive = false;
	private tmp = new THREE.Object3D();
	private ro: ResizeObserver;

	constructor(
		private canvas: HTMLCanvasElement,
		private opts: CityOptions = {}
	) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			powerPreference: 'high-performance'
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
		this.camera.position.set(95, 85, 115);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.maxPolarAngle = Math.PI * 0.47;
		this.controls.minDistance = 25;
		this.controls.maxDistance = 400;
		this.controls.autoRotate = !!opts.autoRotate && !opts.reducedMotion;
		this.controls.autoRotateSpeed = 0.6;
		this.controls.target.set(0, 4, 0);
		this.controls.listenToKeyEvents(canvas); // arrow keys pan once engaged + focused
		this.setInteractive(!!opts.interactive);

		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 2.2);
		sun.position.set(-60, 120, 40);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		const sc = sun.shadow.camera;
		sc.left = sc.bottom = -80;
		sc.right = sc.top = 80;
		sc.far = 400;
		this.scene.add(sun);

		this.ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 3, SIZE * 3), this.groundMat);
		this.ground.rotation.x = -Math.PI / 2;
		this.ground.position.y = -0.02;
		this.ground.receiveShadow = true;
		this.scene.add(this.ground);
		this.grid = new THREE.GridHelper(SIZE * 3, 30, 0x888888, 0x888888);
		(this.grid.material as THREE.Material).transparent = true;
		(this.grid.material as THREE.Material).opacity = 0.12;
		this.scene.add(this.grid);
		this.setDark(!!opts.dark);

		canvas.addEventListener('pointermove', this.onMove);
		canvas.addEventListener('pointerleave', this.onLeave);
		canvas.addEventListener('pointerdown', this.onDown);
		canvas.addEventListener('pointerup', this.onUp);
		canvas.addEventListener('webglcontextlost', this.onLost);
		this.controls.addEventListener('start', this.stopAutoRotate);

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(canvas.parentElement ?? canvas);
		this.resize();
		this.loop();
	}

	setDark(dark: boolean) {
		this.groundMat.color.set(dark ? 0x141413 : 0xf1f0ec);
	}

	/**
	 * Turn camera controls on (drag to orbit, wheel/pinch to zoom, arrows to pan) or off.
	 * When off, the page scrolls normally over the canvas; hover and click still work.
	 */
	setInteractive(on: boolean) {
		this.interactive = on;
		this.controls.enabled = on;
		// OrbitControls sets touch-action: none on connect; allow vertical page scroll when idle
		this.canvas.style.touchAction = on ? 'none' : 'pan-y';
	}

	setAutoRotate(on: boolean) {
		this.controls.autoRotate = on && !this.opts.reducedMotion;
	}

	setData(blocks: CityBlock[], districts: CityDistrict[]) {
		this.blocks = blocks;
		this.hovered = -1;
		const off = SIZE / 2;
		const replace = (old: THREE.InstancedMesh | undefined, mesh: THREE.InstancedMesh) => {
			if (old) {
				this.scene.remove(old);
				old.dispose();
			}
			this.scene.add(mesh);
			return mesh;
		};

		// plinths (districts)
		const plinths = new THREE.InstancedMesh(
			this.boxGeo,
			this.plinthMat,
			Math.max(1, districts.length)
		);
		plinths.count = districts.length;
		districts.forEach((d, i) => {
			this.tmp.position.set((d.x0 + d.x1) / 2 - off, 0, (d.z0 + d.z1) / 2 - off);
			this.tmp.scale.set(Math.max(0.01, d.x1 - d.x0), 0.35, Math.max(0.01, d.z1 - d.z0));
			this.tmp.updateMatrix();
			plinths.setMatrixAt(i, this.tmp.matrix);
			plinths.setColorAt(i, new THREE.Color(d.color));
		});
		plinths.receiveShadow = true;
		this.plinths = replace(this.plinths, plinths);

		// buildings
		const mesh = new THREE.InstancedMesh(this.boxGeo, this.buildingMat, Math.max(1, blocks.length));
		mesh.count = blocks.length;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.baseColors = blocks.map((b, i) => {
			const c = new THREE.Color(b.color);
			const hsl = { h: 0, s: 0, l: 0 };
			c.getHSL(hsl);
			c.setHSL(hsl.h, hsl.s, Math.min(0.85, hsl.l + ((i * 37) % 9) / 100 - 0.03));
			mesh.setColorAt(i, c);
			return c;
		});
		this.buildings = replace(this.buildings, mesh);

		this.growAnim?.stop();
		if (this.opts.reducedMotion) {
			this.grow = 1;
			this.writeMatrices();
		} else {
			this.grow = 0;
			this.writeMatrices();
			this.growAnim = animate(0, 1, {
				duration: 1.1,
				ease: [0.22, 1, 0.36, 1],
				onUpdate: (v) => {
					this.grow = v;
					this.writeMatrices();
				}
			});
		}
		this.resetCamera();
	}

	private writeMatrices() {
		const mesh = this.buildings;
		if (!mesh) return;
		const off = SIZE / 2;
		const n = this.blocks.length;
		this.blocks.forEach((b, i) => {
			// stagger: larger (earlier) blocks grow first
			const local = Math.min(1, Math.max(0, this.grow * 1.6 - (i / Math.max(1, n)) * 0.6));
			const w = Math.max(0.05, (b.x1 - b.x0) * 0.86);
			const d = Math.max(0.05, (b.z1 - b.z0) * 0.86);
			this.tmp.position.set((b.x0 + b.x1) / 2 - off, 0.35, (b.z0 + b.z1) / 2 - off);
			this.tmp.scale.set(w, Math.max(0.05, b.h * local), d);
			this.tmp.updateMatrix();
			mesh.setMatrixAt(i, this.tmp.matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
	}

	private resetCamera() {
		if (this.flying) return;
		this.controls.target.set(0, 4, 0);
	}

	/** Animate the camera toward a block (no-op under reduced motion). */
	flyTo(b: CityBlock): Promise<void> {
		if (this.opts.reducedMotion) return Promise.resolve();
		const off = SIZE / 2;
		const cx = (b.x0 + b.x1) / 2 - off;
		const cz = (b.z0 + b.z1) / 2 - off;
		const span = Math.max(b.x1 - b.x0, b.z1 - b.z0, 6);
		const fromP = this.camera.position.clone();
		const fromT = this.controls.target.clone();
		const toT = new THREE.Vector3(cx, b.h / 2, cz);
		const dir = fromP.clone().sub(fromT).normalize();
		const toP = toT.clone().add(dir.multiplyScalar(span * 1.6 + b.h * 0.8 + 10));
		this.flying = true;
		this.controls.autoRotate = false;
		return animate(0, 1, {
			duration: 0.7,
			ease: [0.4, 0, 0.2, 1],
			onUpdate: (p) => {
				this.camera.position.lerpVectors(fromP, toP, p);
				this.controls.target.lerpVectors(fromT, toT, p);
			}
		}).finished.then(() => {
			this.flying = false;
		});
	}

	/** Project a layout-space point (x,z in [0,SIZE], y height) to canvas pixels. */
	project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
		const v = new THREE.Vector3(x - SIZE / 2, y, z - SIZE / 2).project(this.camera);
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		return {
			x: ((v.x + 1) / 2) * w,
			y: ((1 - v.y) / 2) * h,
			visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1
		};
	}

	private resize() {
		const el = this.canvas.parentElement ?? this.canvas;
		const w = el.clientWidth || 300;
		const h = el.clientHeight || 300;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		// pull back on narrow screens so the whole city fits
		this.camera.fov = w < 640 ? 50 : 38;
		this.camera.updateProjectionMatrix();
	}

	private loop = () => {
		if (this.disposed) return;
		this.raf = requestAnimationFrame(this.loop);
		this.controls.update();
		if (this.pointerDirty) this.pick();
		this.renderer.render(this.scene, this.camera);
		this.opts.onFrame?.();
	};

	private pick() {
		this.pointerDirty = false;
		if (!this.buildings) return;
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hit = this.raycaster.intersectObject(this.buildings, false)[0];
		const idx = hit?.instanceId ?? -1;
		if (idx !== this.hovered) {
			if (this.hovered >= 0 && this.baseColors[this.hovered])
				this.buildings.setColorAt(this.hovered, this.baseColors[this.hovered]);
			if (idx >= 0)
				this.buildings.setColorAt(idx, this.baseColors[idx].clone().offsetHSL(0, 0, 0.14));
			if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
			this.hovered = idx;
			this.canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
		}
		this.opts.onHover?.(
			idx >= 0 ? this.blocks[idx] : null,
			this.pointerClient.x,
			this.pointerClient.y
		);
	}

	private onMove = (e: PointerEvent) => {
		const r = this.canvas.getBoundingClientRect();
		this.pointer.set(
			((e.clientX - r.left) / r.width) * 2 - 1,
			-((e.clientY - r.top) / r.height) * 2 + 1
		);
		this.pointerClient = { x: e.clientX - r.left, y: e.clientY - r.top };
		this.pointerDirty = true;
	};
	private onLeave = () => {
		this.pointer.set(-9, -9);
		this.pointerDirty = true;
	};
	private onDown = (e: PointerEvent) => {
		this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
	};
	private onUp = (e: PointerEvent) => {
		const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
		if (moved > 5 || performance.now() - this.down.t > 600) return;
		this.onMove(e);
		this.pick();
		// before the city is engaged, a tap only shows what is under the finger
		if (!this.interactive && e.pointerType !== 'mouse') return;
		if (this.hovered >= 0) this.opts.onClick?.(this.blocks[this.hovered]);
	};
	private stopAutoRotate = () => {
		this.controls.autoRotate = false;
	};
	private onLost = (e: Event) => {
		e.preventDefault();
		this.opts.onContextLost?.();
	};

	dispose() {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.growAnim?.stop();
		this.ro.disconnect();
		const c = this.canvas;
		c.removeEventListener('pointermove', this.onMove);
		c.removeEventListener('pointerleave', this.onLeave);
		c.removeEventListener('pointerdown', this.onDown);
		c.removeEventListener('pointerup', this.onUp);
		c.removeEventListener('webglcontextlost', this.onLost);
		this.controls.removeEventListener('start', this.stopAutoRotate);
		this.controls.stopListenToKeyEvents();
		this.controls.dispose();
		this.buildings?.dispose();
		this.plinths?.dispose();
		this.boxGeo.dispose();
		this.buildingMat.dispose();
		this.plinthMat.dispose();
		this.groundMat.dispose();
		this.ground.geometry.dispose();
		this.grid.geometry.dispose();
		(this.grid.material as THREE.Material).dispose();
		this.scene.clear();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}

export const CITY_SIZE = SIZE;
