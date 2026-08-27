import {
  Group,
  MathUtils,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Vector2,
  WebGPURenderer,
  type Texture,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import gsap from 'gsap';
import { PRODUCTS, type Product } from '../data/products';
import { MOTION, damp, dur, prefersReducedMotion } from '../core/motion';
import { Background } from './Background';
import { GroundGlow } from './GroundGlow';
import { Lighting } from './Lighting';
import { HERO_YAW, HERO_YAW_OFFSET, ProductModel } from './ProductModel';
import { createStudioEnvironment, loadBrushTexture, loadModel } from './assets';
import { ThumbnailStudio } from './Thumbnails';

const TAU = Math.PI * 2;
/** Where a model is parked, in world units aside, while its pipeline compiles. */
const WARM_PARK = 40;
/** Bloom: high threshold, low strength — a sheen on the highlights, not a glow. */
const BLOOM_STRENGTH = 0.28;
const BLOOM_RADIUS = 0.72;
const BLOOM_THRESHOLD = 0.86;
/** Radians of yaw per pixel dragged. */
const DRAG_YAW = 0.0072;
/** Radians of pitch per pixel dragged. */
const DRAG_PITCH = 0.0038;
/** How far the product may be tipped away from level. */
const PITCH_LIMIT = 0.38;
/** Quiet time before the product drifts back to the hero pose, in seconds. */
const SETTLE_DELAY = 2.6;
/**
 * Ceiling on the momentum a throw can carry, in radians per second. Uncapped,
 * a flick spins the product several times over — energetic, but louder than
 * this composition wants. Capped here, the longest throw coasts a little under
 * a quarter-turn past where it was let go.
 */
const MAX_THROW_YAW = 2.8;
const MAX_THROW_PITCH = 1.4;
/** How quickly a throw bleeds off. */
const THROW_DECAY = 4.6;

/** How much of the viewport height the product occupies, per breakpoint. */
interface Framing {
  /** Product height as a fraction of viewport height. */
  fill: number;
  /** Product optical centre as a fraction of viewport height, from the top. */
  centreY: number;
  /** Product optical centre as a fraction of viewport width, from the left. */
  centreX: number;
  /** Camera elevation in degrees — a slight top-down read, as in the reference. */
  elevation: number;
  fov: number;
}

const FRAMING: Record<'desktop' | 'tablet' | 'mobile', Framing> = {
  desktop: { fill: 0.415, centreY: 0.476, centreX: 0.492, elevation: 9, fov: 26 },
  tablet: { fill: 0.3, centreY: 0.44, centreX: 0.5, elevation: 8, fov: 28 },
  mobile: { fill: 0.235, centreY: 0.435, centreX: 0.5, elevation: 7, fov: 30 },
};

export class ProductScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(26, 1, 0.1, 60);

  private renderer!: WebGPURenderer;
  private canvas!: HTMLCanvasElement;
  private background!: Background;
  private readonly ground = new GroundGlow();
  private readonly lighting = new Lighting();
  private readonly stage = new Group();
  private thumbnails: ThumbnailStudio | null = null;
  /**
   * Bloom pass. Only the specular highlights clear the threshold, so what it
   * adds is the halo a bright edge throws in a real lens — the thing that
   * separates a product photograph from a flat render. Optional by design: if
   * the pass cannot be built the scene renders directly and looks a little
   * plainer.
   */
  private post: RenderPipeline | null = null;

  private readonly models = new Map<string, ProductModel>();
  private current: ProductModel | null = null;
  private environment: Texture | null = null;

  private readonly pointer = new Vector2(0, 0);
  private readonly pointerTarget = new Vector2(0, 0);
  private readonly parallax = new Vector2(0, 0);

  /**
   * Direct manipulation of the product.
   *
   * `yaw` and `pitch` are the visitor's own offset from the hero pose; they are
   * composed with the idle drift and pointer parallax rather than replacing
   * them, so letting go returns the product to the same restrained motion it
   * had before. Releasing carries the throw's momentum, pitch always eases back
   * level, and after a pause the product drifts home to the nearest full turn —
   * the composition restores itself without ever snapping.
   */
  private readonly drag = {
    active: false,
    pointerId: -1,
    surface: null as HTMLElement | null,
    lastX: 0,
    lastY: 0,
    lastMove: 0,
    yaw: 0,
    pitch: 0,
    velocityYaw: 0,
    velocityPitch: 0,
    releasedAt: 0,
  };
  private idleTime = 0;
  private running = false;
  private lastTime = 0;
  private scrollFade = 1;
  private disposed = false;

  private maxAnisotropy = 16;
  private width = 1;
  private height = 1;
  private framing: Framing = FRAMING.desktop;
  private bandOverride: { centreY: number; fill: number } | null = null;

  /** Resolves once the renderer, environment and first model are ready. */
  async init(container: HTMLElement, onProgress?: (ratio: number) => void): Promise<void> {
    this.renderer = new WebGPURenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    await this.renderer.init();

    // Anisotropy is applied to every product map; the device ceiling is usually
    // 16 and the product is the one thing in the frame worth spending it on.
    const capabilities = this.renderer as unknown as { getMaxAnisotropy?: () => number };
    this.maxAnisotropy = Math.min(16, capabilities.getMaxAnisotropy?.() ?? 16);

    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x050403, 1);

    // Surfaced for diagnostics: WebGPU where available, WebGL2 otherwise.
    const backend = this.renderer.backend as unknown as { isWebGPUBackend?: boolean } | undefined;
    // Diagnostics surface. `__scene` is what the verification suite walks to
    // assert the depth invariant during a change — a class of bug that leaves
    // no trace in a screenshot taken a frame either side of it.
    const diag = window as unknown as { __backend?: string; __scene?: unknown };
    diag.__backend = backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
    diag.__scene = this;

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);

    onProgress?.(0.08);

    /* --- environment ------------------------------------------------- */
    const pmrem = new PMREMGenerator(this.renderer);
    const studio = createStudioEnvironment(256);
    this.environment = pmrem.fromEquirectangular(studio).texture;
    studio.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = PRODUCTS[0].theme.envIntensity;

    onProgress?.(0.16);

    /* --- background -------------------------------------------------- */
    let brush: Texture | null = null;
    try {
      brush = await loadBrushTexture('/brush/brush-strokes.svg');
    } catch {
      // The atmosphere still reads correctly without the artwork layer.
      brush = null;
    }
    this.background = new Background(brush);
    this.scene.backgroundNode = this.background.node;

    this.scene.add(this.stage, this.ground.group, this.lighting.group);
    this.lighting.apply(PRODUCTS[0].theme);
    this.applyTheme(PRODUCTS[0], true);

    onProgress?.(0.24);

    this.resize();
    this.bindEvents();

    this.thumbnails = new ThumbnailStudio(this.renderer, this.environment);
    this.setupBloom();

    /* --- first product ----------------------------------------------- */
    await this.ensureModel(PRODUCTS[0], (ratio) => onProgress?.(0.24 + ratio * 0.7));
    const first = this.models.get(PRODUCTS[0].id)!;
    first.resetPose();
    first.setEnvIntensity(PRODUCTS[0].theme.envIntensity);
    this.stage.add(first.group);
    this.current = first;

    onProgress?.(1);
    this.start();
  }

  /**
   * Builds the bloom chain. Kept deliberately restrained — a high threshold so
   * only genuine highlights contribute, and a low strength so the product gains
   * a sheen rather than a glow.
   */
  private setupBloom() {
    try {
      const scenePass = pass(this.scene, this.camera);
      const colour = scenePass.getTextureNode();
      const post = new RenderPipeline(this.renderer);
      post.outputNode = colour.add(bloom(colour, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
      this.post = post;
    } catch (error) {
      console.warn('[showcase] bloom unavailable, rendering directly', error);
      this.post = null;
    }
  }

  /* ---------------------------------------------------------- lifecycle -- */

  private bindEvents() {
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);

    // On desktop the interface layer does not take the pointer, so drags land
    // on the canvas directly.
    this.attachDragSurface(this.canvas);
  }

  /**
   * Makes an element turn the product when dragged.
   *
   * The canvas is registered automatically. On the scrolling layouts the
   * interface sits above it and does take the pointer, so the band reserved for
   * the product is registered too — a drag there turns the controller, while a
   * swipe anywhere else still changes campaign.
   */
  attachDragSurface(element: HTMLElement) {
    element.addEventListener('pointerdown', this.onDragStart);
    element.addEventListener('pointermove', this.onDragMove);
    element.addEventListener('pointerup', this.onDragEnd);
    element.addEventListener('pointercancel', this.onDragEnd);
    // Vertical gestures still belong to the page.
    element.style.touchAction = 'pan-y';
    element.style.cursor = 'grab';
  }

  /* ------------------------------------------------------ direct control -- */

  private onDragStart = (event: PointerEvent) => {
    if (this.drag.active || event.button !== 0) return;
    const surface = event.currentTarget as HTMLElement;
    this.drag.active = true;
    this.drag.pointerId = event.pointerId;
    this.drag.surface = surface;
    this.drag.lastX = event.clientX;
    this.drag.lastY = event.clientY;
    this.drag.lastMove = performance.now();
    this.drag.velocityYaw = 0;
    this.drag.velocityPitch = 0;
    surface.setPointerCapture(event.pointerId);
    surface.style.cursor = 'grabbing';
  };

  private onDragMove = (event: PointerEvent) => {
    if (!this.drag.active || event.pointerId !== this.drag.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(0.008, (now - this.drag.lastMove) / 1000);
    const dx = event.clientX - this.drag.lastX;
    const dy = event.clientY - this.drag.lastY;

    const yaw = dx * DRAG_YAW;
    const pitch = dy * DRAG_PITCH;

    this.drag.yaw += yaw;
    // Pitch is held to a shallow band: the product should never tip past the
    // angles a hand would hold it at.
    this.drag.pitch = MathUtils.clamp(this.drag.pitch + pitch, -PITCH_LIMIT, PITCH_LIMIT);

    this.drag.velocityYaw = MathUtils.clamp(yaw / elapsed, -MAX_THROW_YAW, MAX_THROW_YAW);
    this.drag.velocityPitch = MathUtils.clamp(
      pitch / elapsed,
      -MAX_THROW_PITCH,
      MAX_THROW_PITCH,
    );
    this.drag.lastX = event.clientX;
    this.drag.lastY = event.clientY;
    this.drag.lastMove = now;
  };

  private onDragEnd = (event: PointerEvent) => {
    if (!this.drag.active || event.pointerId !== this.drag.pointerId) return;
    this.drag.active = false;
    this.drag.pointerId = -1;
    this.drag.releasedAt = performance.now();
    // A throw that ended in a pause should not fling.
    if (performance.now() - this.drag.lastMove > 90) {
      this.drag.velocityYaw = 0;
      this.drag.velocityPitch = 0;
    }
    const surface = this.drag.surface ?? this.canvas;
    if (surface.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
    surface.style.cursor = 'grab';
    this.drag.surface = null;
  };

  /** Eases the visitor's rotation back to the hero pose during a product change. */
  private resetDrag(timeline: gsap.core.Timeline, at: number) {
    this.drag.active = false;
    this.drag.velocityYaw = 0;
    this.drag.velocityPitch = 0;
    // Unwind to the nearest whole turn so a spun product takes the short way home.
    const home = Math.round(this.drag.yaw / TAU) * TAU;
    timeline.to(
      this.drag,
      { yaw: home, pitch: 0, duration: dur(0.7), ease: MOTION.easeInOut },
      at,
    );
  }

  private onResize = () => this.resize();

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    this.pointerTarget.set(
      (event.clientX / this.width) * 2 - 1,
      (event.clientY / this.height) * 2 - 1,
    );
  };

  private breakpoint(): keyof typeof FRAMING {
    if (this.width >= 1024) return 'desktop';
    if (this.width >= 640) return 'tablet';
    return 'mobile';
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.framing = FRAMING[this.breakpoint()];

    // Cap resolution: retina desktop tops out at 2x, phones at 1.75x, and any
    // very large canvas is clamped so total pixels stay within budget.
    const raw = window.devicePixelRatio || 1;
    const cap = this.breakpoint() === 'mobile' ? 1.75 : 2;
    // Shaded-pixel ceiling. At 3.6 M a retina desktop window was held to about
    // 1.5× rather than the 2× it asked for, which cost real sharpness on the one
    // object in the frame. 5 M gets most of that back; the HDR pass, its bloom
    // chain and the multisample buffers all scale with it, so it is not free.
    const budget = this.breakpoint() === 'mobile' ? 2_500_000 : 5_000_000;
    const byArea = Math.sqrt(budget / (this.width * this.height));
    const dpr = Math.max(1, Math.min(raw, cap, byArea));

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.background?.setAspect(this.width, this.height);
    this.frameCamera();
  }

  /**
   * Positions the camera so the product occupies the same proportion of the
   * frame as the reference composition, at any window size or aspect ratio.
   */
  private frameCamera() {
    const model = this.current ?? this.models.values().next().value;
    const productHeight = model?.size.y ?? 0.668;
    const productWidth = model?.size.x ?? 0.98;
    const { elevation, fov } = this.framing;
    const centreX = this.bandOverride ? 0.5 : this.framing.centreX;
    const centreY = this.bandOverride?.centreY ?? this.framing.centreY;
    const fill = this.bandOverride?.fill ?? this.framing.fill;

    this.camera.fov = fov;
    this.camera.aspect = this.width / this.height;

    // Distance that makes the product fill `fill` of the viewport height…
    const halfFov = MathUtils.degToRad(fov) / 2;
    let distance = productHeight / fill / 2 / Math.tan(halfFov);

    // …then pull back if that would let the product crowd the frame's width on
    // narrow screens (portrait phones, split windows).
    const maxWidthFraction = this.breakpoint() === 'desktop' ? 0.46 : 0.78;
    const halfFovX = Math.atan(Math.tan(halfFov) * this.camera.aspect);
    const widthDistance = productWidth / maxWidthFraction / 2 / Math.tan(halfFovX);
    distance = Math.max(distance, widthDistance);

    // Tilt the rig slightly above the product, as in the reference where a
    // sliver of the top face and shoulder buttons is visible.
    const el = MathUtils.degToRad(elevation);
    const target = model?.centreY ?? 0.334;
    this.camera.position.set(0, target + Math.sin(el) * distance, Math.cos(el) * distance);
    this.camera.lookAt(0, target, 0);

    // Off-centre the product inside the frame by skewing the projection: this
    // keeps the model's perspective honest, unlike simply translating it.
    this.camera.setViewOffset(
      this.width,
      this.height,
      (centreX - 0.5) * -this.width,
      (centreY - 0.5) * -this.height,
      this.width,
      this.height,
    );
    this.camera.updateProjectionMatrix();

    this.background?.uCenter.value.set(centreX, 1 - centreY);
    this.ground.group.position.set(0, 0, 0);
  }

  /**
   * Overrides the camera framing with a band measured from the DOM. Used by the
   * scrolling layouts so the product lands exactly in the space reserved for it.
   */
  setHeroBand(band: { centreY: number; fill: number } | null) {
    const same =
      (band === null && this.bandOverride === null) ||
      (band !== null &&
        this.bandOverride !== null &&
        Math.abs(band.centreY - this.bandOverride.centreY) < 0.004 &&
        Math.abs(band.fill - this.bandOverride.fill) < 0.004);
    if (same) return;
    this.bandOverride = band;
    this.frameCamera();
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick = () => {
    const now = performance.now();
    const delta = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.idleTime += delta;

    const reduced = prefersReducedMotion();

    // Smoothly chase the pointer instead of tracking it directly — restrained,
    // premium motion rather than a 3D demo.
    const k = damp(3.4, delta);
    this.pointer.lerp(this.pointerTarget, k);

    const amount = reduced ? 0 : 1;
    this.updateDrag(delta, now);

    // Idle drift: a barely-there sway that keeps highlights moving. It is muted
    // while the product is being handled so the two never fight.
    const settled = this.drag.active ? 0 : 1;
    const idleYaw = Math.sin(this.idleTime * 0.28) * 0.024 * amount * settled;
    const idlePitch = Math.sin(this.idleTime * 0.21 + 1.2) * 0.012 * amount * settled;
    const parallaxAmount = amount * settled;

    const pitch = this.drag.pitch + idlePitch - this.pointer.y * 0.038 * parallaxAmount;
    this.stage.rotation.y = this.drag.yaw + idleYaw + this.pointer.x * 0.075 * parallaxAmount;
    this.stage.rotation.x = pitch;

    // The stage pivots about the floor, so tipping it would swing the product
    // through an arc. Countering the rotation of its optical centre keeps the
    // product in place and turns the motion into a true tilt.
    const centre = this.current?.centreY ?? 0.334;
    const bob = Math.sin(this.idleTime * 0.34) * 0.006 * amount * settled;
    this.stage.position.y = bob + centre * (1 - Math.cos(pitch));
    this.stage.position.z = -centre * Math.sin(pitch);

    // The atmosphere shifts a fraction of the product's response, so the light
    // feels attached to the object rather than painted on.
    this.parallax.set(this.pointer.x * -0.012 * amount, this.pointer.y * 0.01 * amount);
    this.background.uParallax.value.copy(this.parallax);

    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  };

  /**
   * Advances the visitor's rotation between frames: momentum from the throw,
   * pitch easing back level, then — once the product has been left alone — a
   * slow drift home to the nearest whole turn.
   */
  private updateDrag(delta: number, now: number) {
    const d = this.drag;
    if (d.active || prefersReducedMotion()) return;

    if (d.velocityYaw !== 0 || d.velocityPitch !== 0) {
      d.yaw += d.velocityYaw * delta;
      d.pitch = MathUtils.clamp(d.pitch + d.velocityPitch * delta, -PITCH_LIMIT, PITCH_LIMIT);
      const decay = Math.exp(-THROW_DECAY * delta);
      d.velocityYaw *= decay;
      d.velocityPitch *= decay;
      if (Math.abs(d.velocityYaw) < 0.002) d.velocityYaw = 0;
      if (Math.abs(d.velocityPitch) < 0.002) d.velocityPitch = 0;
    }

    // Level out first — a tipped product reads as unfinished long before a
    // turned one does.
    if (d.pitch !== 0) {
      d.pitch += (0 - d.pitch) * damp(2.4, delta);
      if (Math.abs(d.pitch) < 0.0005) d.pitch = 0;
    }

    const quiet = (now - d.releasedAt) / 1000;
    if (d.releasedAt > 0 && quiet > SETTLE_DELAY && d.velocityYaw === 0) {
      const home = Math.round(d.yaw / TAU) * TAU;
      d.yaw += (home - d.yaw) * damp(1.3, delta);
      if (Math.abs(home - d.yaw) < 0.0008) {
        d.yaw = home;
        d.releasedAt = 0;
      }
    }
  }

  /* ------------------------------------------------------------- models -- */

  private async ensureModel(
    product: Product,
    onProgress?: (ratio: number) => void,
  ): Promise<ProductModel> {
    const existing = this.models.get(product.id);
    if (existing) return existing;

    const root = await loadModel(product.model, {
      onProgress,
      anisotropy: this.maxAnisotropy,
    });
    const model = new ProductModel(root);
    model.setFinish(product.theme.finish);
    this.models.set(product.id, model);
    await this.warmPipeline(model);
    return model;
  }

  /**
   * Compiles a freshly loaded product against the live scene before it is ever
   * shown.
   *
   * A material's shader is built, and its textures uploaded, the first time it
   * is drawn. Left to happen naturally that lands on the frame the product
   * enters on — the product appears untextured for a beat, then snaps to its
   * finish, which is what read as flickering. Warming it here moves that cost
   * to load time, where nothing is moving.
   */
  private async warmPipeline(model: ProductModel) {
    if (this.disposed) return;

    // Parked well outside the frustum for the duration. Compiling a material
    // means putting the object in the scene, and the awaits below let real
    // frames render in between — so warming it at the hero position showed the
    // model twice on its way through the two depth states. That was the flicker
    // on load, once per campaign being prepared, and the double blink after a
    // change. Off-camera it still compiles, and paints nothing.
    model.group.position.set(WARM_PARK, model.centreY, 0);
    model.setOpacity(1);
    this.stage.add(model.group);

    try {
      // Both depth states are compiled: fading hands the depth buffer to the
      // pre-pass, settled keeps it. They are different pipelines, so warming
      // only one moves the stall to the first campaign change rather than
      // removing it. Opacity stays at 1 throughout — it is a uniform, not part
      // of the pipeline, and the model is off-camera regardless.
      model.setDepthMode(true);
      await this.renderer.compileAsync(this.scene, this.camera, this.scene);
      model.setDepthMode(false);
      await this.renderer.compileAsync(this.scene, this.camera, this.scene);
    } catch {
      // Warming is an optimisation; a failure here costs a hitch, not a break.
    }

    if (this.current !== model) model.group.removeFromParent();
    model.resetPose();
    model.settle();
  }

  /**
   * True unless the visitor has asked to save data or is on a slow connection —
   * in which case the other campaigns load on demand rather than up front.
   */
  static shouldPrefetch(): boolean {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
    };

    // Every resident controller costs about 60 MB of texture memory. Three of
    // them is a fair trade on a desktop for instant switching; on a phone it is
    // most of the budget, so there only the campaign on show is kept and the
    // others load when they are chosen.
    if (window.innerWidth < 1024) return false;
    if ((nav.deviceMemory ?? 8) <= 4) return false;

    const connection = nav.connection;
    if (!connection) return true;
    if (connection.saveData) return false;
    return !/(^| )(slow-)?2g$/.test(connection.effectiveType ?? '');
  }

  /** Loads and warms a campaign's model without displaying it. */
  async preload(product: Product): Promise<void> {
    try {
      await this.ensureModel(product);
    } catch {
      // A failed preload simply means that campaign loads on demand.
    }
  }

  /** Renders a product thumbnail; returns a data URL, or null if unavailable. */
  async thumbnail(product: Product, pose: 'front' | 'angled'): Promise<string | null> {
    if (!this.thumbnails) return null;
    try {
      const model = await this.ensureModel(product);
      return await this.thumbnails.capture(model, product, pose);
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------- transitions -- */

  private applyTheme(product: Product, immediate: boolean, timeline?: gsap.core.Timeline) {
    const bg = this.background.targets(product.theme);
    const gr = this.ground.targets(product.theme);
    const li = this.lighting.targets(product.theme);

    if (immediate) {
      this.background.uBase.value.copy(bg.base);
      this.background.uMid.value.copy(bg.mid);
      this.background.uGlow.value.copy(bg.glow);
      this.background.uGlowIntensity.value = bg.glowIntensity;
      this.background.uBrushTint.value.copy(bg.brushTint);
      this.background.uBrushOpacity.value = bg.brushOpacity;
      this.ground.uColour.value.copy(gr.colour);
      this.ground.uIntensity.value = gr.intensity;
      this.lighting.apply(product.theme);
      this.scene.environmentIntensity = product.theme.envIntensity;
      return;
    }

    const tl = timeline ?? gsap.timeline();
    const d = dur(MOTION.crossfade);
    const ease = MOTION.easeInOut;
    const at = 0;

    tl.to(this.background.uBase.value, { ...rgb(bg.base), duration: d, ease }, at)
      .to(this.background.uMid.value, { ...rgb(bg.mid), duration: d, ease }, at)
      .to(this.background.uGlow.value, { ...rgb(bg.glow), duration: d, ease }, at)
      .to(
        this.background.uGlowIntensity,
        { value: bg.glowIntensity, duration: d, ease },
        at,
      )
      .to(this.background.uBrushTint.value, { ...rgb(bg.brushTint), duration: d, ease }, at)
      .to(
        this.background.uBrushOpacity,
        { value: bg.brushOpacity, duration: d, ease },
        at,
      )
      .to(this.ground.uColour.value, { ...rgb(gr.colour), duration: d, ease }, at)
      .to(this.ground.uIntensity, { value: gr.intensity, duration: d, ease }, at)
      .to(this.lighting.key.color, { ...rgb(li.key), duration: d, ease }, at)
      .to(this.lighting.key, { intensity: li.keyIntensity, duration: d, ease }, at)
      .to(this.lighting.fill.color, { ...rgb(li.fill), duration: d, ease }, at)
      .to(this.lighting.fill, { intensity: li.fillIntensity, duration: d, ease }, at)
      .to(this.lighting.rimLeft.color, { ...rgb(li.rim), duration: d, ease }, at)
      .to(this.lighting.rimRight.color, { ...rgb(li.rim), duration: d, ease }, at)
      .to(this.lighting.rimLeft, { intensity: li.rimIntensity, duration: d, ease }, at)
      .to(
        this.lighting.rimRight,
        { intensity: li.rimIntensity * 0.85, duration: d, ease },
        at,
      )
      .to(this.lighting.bounce.color, { ...rgb(li.bounce), duration: d, ease }, at)
      .to(this.scene, { environmentIntensity: product.theme.envIntensity, duration: d, ease }, at);
  }

  /**
   * Choreographs a campaign change onto a caller-supplied timeline so the UI,
   * the model, the lighting and the atmosphere all resolve as one motion.
   */
  async transitionTo(
    product: Product,
    direction: 1 | -1,
    timeline: gsap.core.Timeline,
  ): Promise<void> {
    const next = await this.ensureModel(product);
    const outgoing = this.current;
    if (outgoing === next) {
      this.applyTheme(product, false, timeline);
      return;
    }

    const reduced = prefersReducedMotion();

    /* --- outgoing product leaves ------------------------------------- */
    if (outgoing) {
      // The first half of the revolution, accelerating. It stays fully opaque
      // the whole way and is taken out of the scene the instant it is facing
      // away — no fade, so the frame never loses the product.
      const swapYaw = HERO_YAW + HERO_YAW_OFFSET + direction * (MOTION.turn / 2);
      timeline
        .to(
          outgoing.group.rotation,
          {
            y: swapYaw,
            duration: dur(MOTION.half),
            ease: MOTION.easeIn,
            onComplete: () => {
              outgoing.group.removeFromParent();
              outgoing.settle();
              outgoing.resetPose();
            },
          },
          0,
        )
        // …drifting back as it turns, so the product pivots in the space rather
        // than on a flat plane. The incoming half returns it.
        .to(
          outgoing.group.position,
          { z: MOTION.depth, duration: dur(MOTION.half), ease: 'power2.out' },
          0,
        );
    }

    /* --- atmosphere and light cross over ------------------------------ */
    this.applyTheme(product, false, timeline);
    // Any rotation the visitor applied unwinds as part of the same gesture, so
    // the incoming product always lands in the hero pose.
    this.resetDrag(timeline, 0);

    // Shader-level sweep: a ring of the incoming product's light expanding out
    // of the centre, tying the background change to the model change.
    this.background.uSweep.value = 0;
    timeline
      .fromTo(
        this.background.uSweep,
        { value: 0 },
        { value: 1, duration: dur(MOTION.sweep), ease: 'power1.out' },
        0.05,
      )
      .fromTo(
        this.background.uSweepStrength,
        { value: 0 },
        { value: reduced ? 0 : 0.3, duration: dur(0.26), ease: 'power2.out' },
        0.05,
      )
      .to(this.background.uSweepStrength, { value: 0, duration: dur(0.6), ease: 'power2.in' }, 0.42);

    // The floor brightens fractionally as the new product settles onto it — a
    // small arrival cue that ties the model and the environment together.
    if (!reduced) {
      const settleAt = MOTION.half * 1.55;
      timeline
        // `overwrite` matters here: the crossfade above is still tweening this
        // same uniform, and the two would otherwise fight over it.
        .to(
          this.ground.uIntensity,
          {
            value: product.theme.groundIntensity * 1.22,
            duration: dur(0.22),
            ease: 'power2.out',
            overwrite: 'auto',
          },
          settleAt,
        )
        .to(
          this.ground.uIntensity,
          {
            value: product.theme.groundIntensity,
            duration: dur(0.5),
            ease: 'power2.inOut',
            overwrite: 'auto',
          },
          settleAt + dur(0.22),
        );
    }

    /* --- incoming product arrives ------------------------------------- */
    // Picks the revolution up exactly where the last product left it — same
    // angle, same depth — and decelerates the remaining half-turn into the hero
    // pose. Because it takes over at full opacity on the same frame the other
    // leaves, the product's presence in the frame never changes: no dip to read
    // as a blink, and no overlap to read as a ghost.
    const swapAt = dur(MOTION.half);
    next.resetPose();
    next.setEnvIntensity(product.theme.envIntensity);
    next.setOpacity(0);
    next.group.rotation.y = HERO_YAW + HERO_YAW_OFFSET - direction * (MOTION.turn / 2);
    next.group.position.set(0, next.centreY, MOTION.depth);
    next.group.scale.setScalar(1);
    this.stage.add(next.group);
    this.current = next;

    timeline
      .call(() => next.setOpacity(1), undefined, swapAt)
      .to(
        next.group.rotation,
        {
          y: HERO_YAW + HERO_YAW_OFFSET,
          duration: dur(MOTION.half),
          ease: 'power2.out',
        },
        swapAt,
      )
      .to(
        next.group.position,
        { z: 0, duration: dur(MOTION.half), ease: 'power2.in' },
        swapAt,
      );
  }

  /** Fades the hero in once loading completes. */
  reveal(timeline: gsap.core.Timeline) {
    const model = this.current;
    timeline.fromTo(
      this.background.uReveal,
      { value: 0 },
      { value: 1, duration: dur(1.4), ease: 'power2.out' },
      0,
    );
    timeline.fromTo(
      this.ground.uReveal,
      { value: 0 },
      { value: 1, duration: dur(1.6), ease: 'power2.out' },
      0.15,
    );
    if (!model) return;
    const appear = { value: 0 };
    model.setOpacity(0);
    timeline
      .fromTo(
        model.group.position,
        { y: model.centreY - 0.12, z: -0.35 },
        { y: model.centreY, z: 0, duration: dur(1.5), ease: 'expo.out' },
        0.05,
      )
      .fromTo(
        model.group.scale,
        { x: 0.9, y: 0.9, z: 0.9 },
        { x: 1, y: 1, z: 1, duration: dur(1.5), ease: 'expo.out' },
        0.05,
      )
      .fromTo(
        appear,
        { value: 0 },
        {
          value: 1,
          duration: dur(0.9),
          ease: 'power2.out',
          onUpdate: () => model.setOpacity(appear.value),
          onComplete: () => model.settle(),
        },
        0.05,
      );
  }

  /**
   * On the scrolling mobile/tablet layout the canvas is fixed behind the page,
   * so the product dissolves as content scrolls up to meet it — the atmosphere
   * stays, the hero never sits under the copy.
   */
  setScrollFade(value: number) {
    const clamped = MathUtils.clamp(value, 0, 1);
    if (Math.abs(clamped - this.scrollFade) < 0.004) return;
    this.scrollFade = clamped;
    const model = this.current;
    if (!model) return;
    if (clamped > 0.995) model.settle();
    else model.setOpacity(clamped);
    this.ground.uContact.value = clamped;
    this.stage.visible = clamped > 0.01;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.ground.dispose();
    this.thumbnails?.dispose();
    this.environment?.dispose();
    this.renderer.dispose();
  }
}

/** GSAP tweens colours channel-by-channel; three stores them as r/g/b floats. */
function rgb(colour: { r: number; g: number; b: number }) {
  return { r: colour.r, g: colour.g, b: colour.b };
}
