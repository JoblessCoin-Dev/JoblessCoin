import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Mesh,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial, WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { gsap } from "gsap";
import { buildLogo, type LogoGeometry } from "./logo";
import { atmosphereFragment, compositeFragment, particleFragment, particleVertex, quadVertex } from "./shaders";

const FOV = 35;
const CAM_Z = 5;
const HALF_H = Math.tan(((FOV / 2) * Math.PI) / 180) * CAM_Z;
const TICK = (6 * Math.PI) / 180; // a second hand moves 6 degrees

export interface BreakoutOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  mobile: boolean;
  onBreak?: () => void;
}

/** The hero particle system plus the page-wide atmosphere, on one WebGL canvas. */
export class Breakout {
  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 50);
  private scene = new Scene();
  private bg = { scene: new Scene(), target: new WebGLRenderTarget(1, 1), mat: null as unknown as ShaderMaterial };
  private comp = { scene: new Scene(), mat: null as unknown as ShaderMaterial };
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private logo: LogoGeometry;
  private particles: Points;
  private arcs: LineSegments;
  private arcPositions: Float32Array;
  private u: Record<string, { value: any }>;

  private t = 0;
  private last = 0;
  private rot = 0;
  private shockStart = -1;
  private broke = false;
  private scrollTarget = 0;
  private mouseTarget = { x: 9, y: 9 };
  private mouseUv = { x: 0.5, y: 0.5 };
  private mouseStrTarget = 0;
  private flash = { value: 0 };
  private layout = { scale: 1, x: 0, y: 0, halfW: 1 };
  private running = false;
  private paused = false;
  private raf = 0;
  private quality = 0;
  private frameTimes: number[] = [];
  private bgScale: number;
  private total: number;
  private timeline?: gsap.core.Timeline;

  constructor(private opts: BreakoutOptions) {
    const { canvas, mobile } = opts;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(new Color(0x0a0c0b), 1);
    this.bgScale = mobile ? 0.35 : 0.5;

    const ringN = mobile ? 2600 : 7000;
    const jN = mobile ? 1700 : 4300;
    const dustN = mobile ? 700 : 1800;
    this.total = ringN + jN + dustN;
    this.logo = buildLogo(ringN + jN, jN);

    this.u = {
      uTime: { value: 0 }, uRot: { value: 0 }, uForm: { value: 0 }, uBreak: { value: 0 }, uShock: { value: -1 },
      uScroll: { value: 0 }, uPixel: { value: 1 }, uSize: { value: mobile ? 3.2 : 3.6 }, uScale: { value: 1 },
      uGapA: { value: this.logo.gapAngle }, uGapHalf: { value: this.logo.gapHalf },
      uPulseT: { value: -100 }, uPulseA: { value: 0 }, uPage: { value: 0 }, uAlive: { value: 1 },
      uMouseStr: { value: 0 }, uCenter: { value: this.logo.center }, uOffset: { value: [0, 0] },
      uMouse: { value: [9, 9] }, uJCenter: { value: this.logo.jCentroid },
    };

    this.particles = this.buildParticles(ringN, jN, dustN);
    this.scene.add(this.particles);

    this.arcPositions = new Float32Array(14 * 4 * 2 * 3);
    const arcGeo = new BufferGeometry();
    arcGeo.setAttribute("position", new BufferAttribute(this.arcPositions, 3));
    this.arcs = new LineSegments(arcGeo, new LineBasicMaterial({
      color: 0x36ff6f, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false,
    }));
    this.arcs.frustumCulled = false;
    this.scene.add(this.arcs);

    this.bg.mat = new ShaderMaterial({
      vertexShader: quadVertex, fragmentShader: atmosphereFragment, depthTest: false, depthWrite: false,
      uniforms: {
        uRes: { value: [1, 1] }, uTime: { value: 0 }, uLight: { value: [0.7, 0.55] }, uLightStr: { value: 0.3 },
        uMouse: { value: [0.5, 0.5] }, uPage: { value: 0 }, uFlash: this.flash,
      },
    });
    this.bg.scene.add(new Mesh(new PlaneGeometry(2, 2), this.bg.mat));
    this.comp.mat = new ShaderMaterial({
      vertexShader: quadVertex, fragmentShader: compositeFragment, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: this.bg.target.texture }, uTime: { value: 0 } },
    });
    this.comp.scene.add(new Mesh(new PlaneGeometry(2, 2), this.comp.mat));

    this.camera.position.z = CAM_Z;
    this.resize();
    addEventListener("resize", () => this.resize());
    if (!opts.reducedMotion) this.bindInput();
    document.addEventListener("visibilitychange", () => (document.hidden ? this.stop() : this.play()));
  }

  // ---------- setup ----------

  private buildParticles(ringN: number, jN: number, dustN: number): Points {
    const n = ringN + jN + dustN;
    // Shuffle so a shorter draw range (lower quality) thins every kind evenly.
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [order[i], order[k]] = [order[k], order[i]];
    }
    const position = new Float32Array(n * 3);
    const polar = new Float32Array(n * 2);
    const target = new Float32Array(n * 2);
    const seedA = new Float32Array(n * 4);
    const kind = new Float32Array(n);
    const { ring, j } = this.logo;
    order.forEach((src, dst) => {
      for (let s = 0; s < 4; s++) seedA[dst * 4 + s] = Math.random();
      if (src < ringN + jN) {
        polar[dst * 2] = ring[src * 2];
        polar[dst * 2 + 1] = ring[src * 2 + 1];
        if (src >= ringN) {
          kind[dst] = 1;
          target[dst * 2] = j[(src - ringN) * 2];
          target[dst * 2 + 1] = j[(src - ringN) * 2 + 1];
        }
      } else {
        kind[dst] = 2;
        position[dst * 3] = (Math.random() - 0.5) * 12;
        position[dst * 3 + 1] = (Math.random() - 0.5) * 9;
        position[dst * 3 + 2] = -Math.random() * 4 + 0.8;
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(position, 3));
    geo.setAttribute("aPolar", new BufferAttribute(polar, 2));
    geo.setAttribute("aTarget", new BufferAttribute(target, 2));
    geo.setAttribute("aSeed", new BufferAttribute(seedA, 4));
    geo.setAttribute("aKind", new BufferAttribute(kind, 1));
    const mat = new ShaderMaterial({
      vertexShader: particleVertex, fragmentShader: particleFragment, uniforms: this.u,
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.quality > 0 ? 1 : 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const halfW = HALF_H * this.camera.aspect;
    const wide = w / h > 1.05;
    // Desktop: the loop sits right of the headline. Phones: centered, in the top half.
    this.layout = wide
      ? { scale: Math.min(1.12, (halfW * 0.5) / 0.95), x: halfW * 0.44, y: -0.02, halfW }
      : { scale: Math.min(0.82, (halfW * 0.92) / 0.95), x: 0, y: HALF_H * 0.4, halfW };
    this.u.uScale.value = this.layout.scale;
    this.u.uOffset.value = [this.layout.x, this.layout.y];
    this.u.uPixel.value = dpr * (h / 900);
    const tw = Math.max(1, Math.round(w * dpr * this.bgScale)), th = Math.max(1, Math.round(h * dpr * this.bgScale));
    this.bg.target.setSize(tw, th);
    this.bg.mat.uniforms.uRes.value = [tw, th];
    if (!this.running) this.render();
  }

  private bindInput() {
    const toWorld = (cx: number, cy: number) => ({
      x: ((cx / innerWidth) * 2 - 1) * this.layout.halfW,
      y: (1 - (cy / innerHeight) * 2) * HALF_H,
    });
    addEventListener("pointermove", (e) => {
      this.mouseTarget = toWorld(e.clientX, e.clientY);
      this.mouseUv = { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight };
      this.mouseStrTarget = 1;
    }, { passive: true });
    addEventListener("pointerleave", () => (this.mouseStrTarget = 0));
    addEventListener("pointerdown", (e) => {
      if (scrollY > innerHeight * 0.8) return;
      const w = toWorld(e.clientX, e.clientY);
      const svg = this.worldToSvg(w.x, w.y);
      const [cx, cy] = this.logo.center;
      const r = Math.hypot(svg.x - cx, svg.y - cy);
      if (r > this.logo.innerR * 0.7 && r < this.logo.outerR * 1.3) {
        this.u.uPulseT.value = this.t;
        this.u.uPulseA.value = Math.atan2(svg.y - cy, svg.x - cx) - this.rot;
      }
    }, { passive: true });
  }

  private worldToSvg(x: number, y: number) {
    const { scale, x: ox, y: oy } = this.layout;
    return { x: ((x - ox) / scale) * 420 + 512, y: -((y - oy) / scale) * 420 + 512 };
  }

  private svgToWorld(x: number, y: number) {
    const { scale, x: ox, y: oy } = this.layout;
    return { x: ((x - 512) / 420) * scale + ox, y: (-(y - 512) / 420) * scale + oy };
  }

  // ---------- story ----------

  /** Start the show: machine runs, J assembles, J breaks out. */
  start() {
    if (this.opts.reducedMotion) {
      this.u.uForm.value = 1;
      this.u.uBreak.value = 1;
      this.shockStart = -10;
      this.t = 42;
      this.render();
      return;
    }
    this.timeline = gsap.timeline()
      .to(this.u.uForm, { value: 1, duration: 1.9, ease: "power2.inOut" }, 1.1)
      .add(() => this.breakout(), 3.35);
    this.play();
  }

  /** Skip ahead to the breakout (e.g. when the visitor scrolls early). */
  finishNow() {
    if (this.broke || !this.timeline) return;
    this.timeline.kill();
    gsap.to(this.u.uForm, { value: 1, duration: 0.35, ease: "power2.out", onComplete: () => this.breakout() });
  }

  private breakout() {
    if (this.broke) return;
    this.broke = true;
    this.shockStart = this.t;
    gsap.to(this.u.uBreak, { value: 1, duration: 0.9, ease: "expo.out" });
    gsap.fromTo(this.flash, { value: 1 }, { value: 0, duration: 1.6, ease: "power2.out" });
    this.opts.onBreak?.();
  }

  setHeroProgress(p: number) {
    this.scrollTarget = p;
    if (p > 0.02) this.finishNow();
    if (!this.running) {
      this.u.uScroll.value = p;
      this.render();
    }
  }

  setPage(y: number) {
    this.u.uPage.value = y / Math.max(innerHeight, 1);
    this.bg.mat.uniforms.uPage.value = this.u.uPage.value;
    if (!this.running) this.render();
  }

  // ---------- loop ----------

  play() {
    if (this.running || this.paused || this.opts.reducedMotion || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.update(dt);
      this.render();
      this.adapt(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Boss mode: freeze everything. */
  setPaused(paused: boolean) {
    this.paused = paused;
    paused ? this.stop() : this.play();
  }

  private update(dt: number) {
    this.t += dt;
    const u = this.u;
    // A running machine: steady spin plus a second-hand jolt every second. Dies after the break.
    const alive = this.broke ? Math.max(0, 1 - (this.t - this.shockStart) / 1.5) : 1;
    const k = 18;
    this.rot += dt * (0.28 + TICK * k * Math.exp(-k * (this.t % 1))) * alive;

    u.uTime.value = this.t;
    u.uRot.value = this.rot;
    u.uShock.value = this.shockStart >= 0 ? this.t - this.shockStart : -1;
    u.uScroll.value += (this.scrollTarget - u.uScroll.value) * Math.min(1, dt * 7);
    const m = u.uMouse.value as number[];
    u.uMouse.value = [m[0] + (this.mouseTarget.x - m[0]) * Math.min(1, dt * 10), m[1] + (this.mouseTarget.y - m[1]) * Math.min(1, dt * 10)];
    u.uMouseStr.value += (this.mouseStrTarget - u.uMouseStr.value) * Math.min(1, dt * 3);
    this.mouseStrTarget *= Math.exp(-dt * 0.6);

    // Light follows the J; after the hero it drifts up and softens for the rest of the page.
    const s = u.uScroll.value;
    const jc = this.svgToWorld(this.logo.jCentroid[0], this.logo.jCentroid[1]);
    const light = {
      x: (jc.x / this.layout.halfW) * 0.5 + 0.5,
      y: (jc.y / HALF_H) * 0.5 + 0.5 + s * 0.25,
    };
    const bu = this.bg.mat.uniforms;
    bu.uTime.value = this.t;
    bu.uLight.value = [light.x, light.y];
    bu.uLightStr.value = (0.25 + u.uForm.value * 0.35 + u.uBreak.value * 0.3) * (1 - s * 0.45);
    const bm = bu.uMouse.value as number[];
    bu.uMouse.value = [bm[0] + (this.mouseUv.x - bm[0]) * dt * 3, bm[1] + (this.mouseUv.y - bm[1]) * dt * 3];
    this.comp.mat.uniforms.uTime.value = this.t;

    this.updateArcs(alive * (1 - s));
  }

  /** Short flickering sparks of current along the loop while the machine runs. */
  private arcTimer = 0;
  private updateArcs(strength: number) {
    const mat = this.arcs.material as LineBasicMaterial;
    mat.opacity = 0.45 * strength * (0.6 + Math.random() * 0.4);
    this.arcTimer -= 1;
    if (this.arcTimer > 0 || strength <= 0) return;
    this.arcTimer = 4;
    const [cx, cy] = this.logo.center;
    const { innerR, outerR } = this.logo;
    const a = this.arcPositions;
    let o = 0;
    for (let b = 0; b < 14; b++) {
      let ang = Math.random() * Math.PI * 2 + this.rot;
      let rad = innerR + Math.random() * (outerR - innerR);
      let prev = this.svgToWorld(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      for (let s = 0; s < 4; s++) {
        ang += 0.025 + Math.random() * 0.05;
        rad = Math.min(outerR, Math.max(innerR, rad + (Math.random() - 0.5) * 30));
        const next = this.svgToWorld(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
        a.set([prev.x, prev.y, 0.05, next.x, next.y, 0.05], o);
        o += 6;
        prev = next;
      }
    }
    (this.arcs.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }

  private render() {
    const r = this.renderer;
    r.setRenderTarget(this.bg.target);
    r.clear();
    r.render(this.bg.scene, this.quadCam);
    r.setRenderTarget(null);
    r.clear();
    r.render(this.comp.scene, this.quadCam);
    r.render(this.scene, this.camera);
  }

  /** If frames drop below ~48 fps, trade detail for smoothness, one step at a time. */
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg < 1 / 48 || this.quality >= 3) return;
    this.quality++;
    if (this.quality === 1) this.bgScale *= 0.7;
    if (this.quality >= 2) this.particles.geometry.setDrawRange(0, Math.floor(this.total * (this.quality === 2 ? 0.65 : 0.45)));
    this.resize();
  }
}
