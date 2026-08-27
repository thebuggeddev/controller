import gsap from 'gsap';
import { PRODUCTS, type Product } from './data/products';
import { applyTheme, transitionTheme } from './core/theme';
import { dur, prefersReducedMotion } from './core/motion';
import { el, qs } from './core/dom';
import { getState, setState, subscribe } from './core/store';
import { CarouselControls } from './ui/CarouselControls';
import { Header } from './ui/Header';
import { Loader } from './ui/Loader';
import { MobileMenu } from './ui/MobileMenu';
import { ProductIndicator } from './ui/ProductIndicator';
import { ProductInfo } from './ui/ProductInfo';
import { ProductVariants } from './ui/ProductVariants';
import { PromoCard } from './ui/PromoCard';
import { SpecCards } from './ui/SpecCards';
import { dragHandle } from './ui/icons';
import type { ProductScene } from './three/ProductScene';

/**
 * Application shell. Owns the component tree, the WebGL scene, and — crucially
 * — the single GSAP timeline that a campaign change runs on, so the interface
 * and the 3D product resolve as one continuous motion rather than as a set of
 * animations that happen to start together.
 */
export class App {
  // The WebGL layer is code-split: the loading composition paints from HTML and
  // CSS alone, so the three.js bundle never blocks the first frame.
  private scene!: ProductScene;
  private readonly loader = new Loader();

  private header!: Header;
  private menu!: MobileMenu;
  private info!: ProductInfo;
  private variants!: ProductVariants;
  private controls!: CarouselControls;
  private promo!: PromoCard;
  private specs!: SpecCards;

  private shell!: HTMLElement;
  private heroSpace!: HTMLElement;
  private queued: number | null = null;

  async mount(root: HTMLElement): Promise<void> {
    const product = PRODUCTS[0];
    applyTheme(product);

    /* --- structure ---------------------------------------------------- */
    const stage = el('div', 'stage');
    stage.id = 'top';

    this.shell = el('div', 'shell');
    this.header = new Header(() => this.toggleMenu());
    this.menu = new MobileMenu(() => this.toggleMenu(false));
    this.info = new ProductInfo(product);
    this.variants = new ProductVariants(0, (index) => this.goTo(index));
    this.controls = new CarouselControls(0, (direction) => this.step(direction));
    this.promo = new PromoCard(product);
    this.specs = new SpecCards(product);

    const indicator = new ProductIndicator();
    const handle = el('div', 'stage__handle', dragHandle);
    handle.setAttribute('aria-hidden', 'true');

    // Reserves the vertical band the product is framed into on the scrolling
    // layouts; its measured position drives the camera so the two never drift.
    this.heroSpace = el('div', 'hero__space');
    this.heroSpace.setAttribute('aria-hidden', 'true');

    const hero = el('main', 'hero');
    hero.append(
      this.info.element,
      indicator.element,
      this.heroSpace,
      this.variants.element,
      handle,
      this.controls.element,
    );

    const footer = el('div', 'hero__footer');
    footer.append(this.promo.element, this.specs.element);

    this.shell.append(this.header.element, hero, footer);
    root.append(stage, this.shell, this.menu.element, this.loader.element);

    /* --- scene -------------------------------------------------------- */
    try {
      const { ProductScene } = await import('./three/ProductScene');
      this.scene = new ProductScene();
      await this.scene.init(stage, (ratio) => this.loader.set(ratio));
    } catch (error) {
      this.failGracefully(error);
      return;
    }

    // A drag inside the reserved product band turns the controller; the canvas
    // handles the same gesture where the interface does not cover it.
    this.scene.attachDragSurface(this.heroSpace);

    this.measureHeroBand();
    this.bindInput();
    setState({ phase: 'intro' });
    this.playIntro();

    // The remaining campaigns are fetched once the browser is idle, so they
    // never compete with the hero reveal for bandwidth or main-thread time.
    const idle = (window as Window & { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    if (idle) idle(() => void this.warm(), { timeout: 3000 });
    else window.setTimeout(() => void this.warm(), 1200);
  }

  /* -------------------------------------------------------------- intro -- */

  private playIntro() {
    const timeline = gsap.timeline({ onComplete: () => setState({ phase: 'idle' }) });
    timeline.add(this.loader.dismiss(), 0);
    this.scene.reveal(timeline);
    timeline.fromTo(
      this.header.element,
      { y: -22, opacity: 0 },
      { y: 0, opacity: 1, duration: dur(0.9), ease: 'power3.out' },
      0.25,
    );
    this.info.reveal(timeline, 0.35);
    this.variants.reveal(timeline, 0.45);
    this.controls.reveal(timeline, 0.6);
    this.promo.reveal(timeline, 0.55);
    this.specs.reveal(timeline, 0.6);
  }

  /**
   * Resolves the artwork for a card or the promotional panel.
   *
   * Studio photography wins where a campaign has it — it is the real product,
   * and it needs no GPU work. Everything else is rendered from that campaign's
   * own model, so no placeholder imagery is ever shown.
   */
  private async artwork(product: Product, kind: 'card' | 'promo'): Promise<string | null> {
    const photograph = kind === 'card' ? product.photography?.front : product.photography?.back;
    if (photograph) return photograph;
    return this.scene.thumbnail(product, kind === 'card' ? 'front' : 'angled');
  }

  /**
   * Prepares the remaining campaigns and every piece of product artwork.
   *
   * On a metered or slow connection only the campaign on show is prepared; the
   * others load when they are actually selected, and their cards hold a lit
   * placeholder until then.
   */
  private async warm() {
    const { ProductScene } = await import('./three/ProductScene');
    const prefetch = ProductScene.shouldPrefetch();

    // The promotional panel belongs to the campaign on show, so it goes first.
    const active = PRODUCTS[getState().index];
    const promo = await this.artwork(active, 'promo');
    if (promo && PRODUCTS[getState().index] === active) this.promo.setArtwork(promo);

    for (let i = 0; i < PRODUCTS.length; i++) {
      const product = PRODUCTS[i];
      // A photographed card needs no model, so it can be filled immediately
      // whatever the connection allows.
      if (!product.photography && !prefetch && i !== getState().index) continue;
      const art = await this.artwork(product, 'card');
      if (art) this.variants.setArtwork(i, art, product.name);
    }

    // Card artwork no longer depends on the models, so the models have to be
    // asked for in their own right — otherwise the first switch to a campaign
    // would stall mid-transition waiting on a download.
    if (!prefetch) return;
    for (let i = 0; i < PRODUCTS.length; i++) {
      if (i !== getState().index) await this.scene.preload(PRODUCTS[i]);
    }
  }

  /* --------------------------------------------------------- navigation -- */

  private step(direction: 1 | -1) {
    const { index } = getState();
    const next = (index + direction + PRODUCTS.length) % PRODUCTS.length;
    this.goTo(next);
  }

  private goTo(index: number) {
    const state = getState();
    if (index === state.index && state.phase !== 'loading') return;

    // Never let two model transitions overlap: a request mid-flight is held and
    // replayed once the current one reaches a safe state.
    if (state.phase === 'transitioning') {
      this.queued = index;
      return;
    }
    void this.transition(index);
  }

  private async transition(index: number) {
    const state = getState();
    const from = state.index;
    const product = PRODUCTS[index];
    // Shortest way round the loop decides which way the product turns.
    const forward = (index - from + PRODUCTS.length) % PRODUCTS.length;
    const backward = (from - index + PRODUCTS.length) % PRODUCTS.length;
    const direction: 1 | -1 = forward <= backward ? 1 : -1;

    setState({ phase: 'transitioning', index, previousIndex: from, direction });
    this.controls.setBusy(true);
    this.updateDocument(product);

    // The model is made ready *before* the timeline exists, never during it.
    //
    // Campaigns are preloaded on desktop, so this usually resolves in a tick.
    // On a phone they are not — the memory is better spent elsewhere — and the
    // model has to be fetched and compiled, which can take seconds. Awaiting
    // that with the timeline already running meant every tween had played out
    // by the time the scene had anything to animate: the interface changed, the
    // product did not, and the old one stayed on screen until an unrelated
    // scroll happened to make the new one visible.
    try {
      await this.scene.prepare(product);
    } catch (error) {
      console.error('[showcase] could not prepare campaign', product.id, error);
      setState({ phase: 'idle' });
      this.controls.setBusy(false);
      return;
    }

    // The visitor may have moved on while that was loading.
    if (getState().index !== index) {
      this.controls.setBusy(false);
      return;
    }

    const timeline = gsap.timeline({
      onComplete: () => {
        setState({ phase: 'idle' });
        this.controls.setBusy(false);
        this.scene.settleScrollFade();
        const queued = this.queued;
        this.queued = null;
        if (queued !== null && queued !== getState().index) void this.transition(queued);
      },
    });

    transitionTheme(product, timeline);
    this.info.transition(product, timeline, 0);
    this.variants.transition(product, index, timeline, 0.12);
    this.controls.transition(index, timeline, 0.12);
    this.promo.transition(product, timeline, 0.06);
    this.specs.transition(product, timeline, 0.08);

    // Synchronous now: everything it needs is already in memory.
    this.scene.transitionTo(product, direction, timeline);

    // Keep the promotional still in step with the campaign on show. Captures
    // are held until the change has finished so they never share a frame with
    // it — the stills are cached, so this is usually instant.
    timeline.call(
      () => {
        void this.artwork(product, 'promo').then((art) => {
          if (art && getState().index === index) this.promo.setArtwork(art);
        });
        void this.artwork(product, 'card').then((art) => {
          if (art) this.variants.setArtwork(index, art, product.name);
        });
      },
      undefined,
      '>',
    );
  }

  /**
   * Ties the camera framing to the laid-out band on the scrolling breakpoints,
   * so the product is always centred in the gap the layout leaves for it.
   */
  private measureHeroBand() {
    if (window.innerWidth >= 1024) {
      this.scene.setHeroBand(null);
      return;
    }
    const rect = this.heroSpace.getBoundingClientRect();
    if (rect.height < 40) return;
    const top = rect.top + window.scrollY;
    const centre = (top + rect.height / 2) / window.innerHeight;
    const fill = Math.min(0.34, (rect.height * 0.78) / window.innerHeight);
    this.scene.setHeroBand({ centreY: centre, fill });
  }

  private updateDocument(product: Product) {
    document.title = `${product.titleLines.join(' ')} · PlayStation DualSense`;
  }

  /* -------------------------------------------------------------- input -- */

  private toggleMenu(force?: boolean) {
    const open = force ?? !getState().menuOpen;
    setState({ menuOpen: open });
    this.header.setMenuOpen(open);
    this.menu.toggle(open);
    document.body.classList.toggle('menu-open', open);
  }

  private bindInput() {
    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && getState().menuOpen) {
        this.toggleMenu(false);
        return;
      }
      // Arrow keys only steer the carousel when focus is not inside a control
      // that owns them itself.
      const target = event.target as HTMLElement | null;
      if (target && target.closest('.variants')) return;
      if (event.key === 'ArrowRight') this.step(1);
      if (event.key === 'ArrowLeft') this.step(-1);
    });

    /* --- swipe -------------------------------------------------------- */
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const surface = this.shell;

    surface.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length !== 1) return;
        // A gesture that begins on the product turns it instead of changing
        // campaign, so it must not also register as a swipe.
        if ((event.target as HTMLElement | null)?.closest('.hero__space')) return;
        tracking = true;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      },
      { passive: true },
    );

    surface.addEventListener(
      'touchend',
      (event) => {
        if (!tracking) return;
        tracking = false;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        // Horizontal intent only — vertical drags belong to the page.
        if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        this.step(dx < 0 ? 1 : -1);
      },
      { passive: true },
    );

    /* --- scroll ------------------------------------------------------- */
    // Below the desktop breakpoint the canvas is fixed behind a scrolling page,
    // so the product dissolves before the content can reach it.
    const onScroll = () => {
      if (window.innerWidth >= 1024) {
        this.scene.setScrollFade(1);
        return;
      }
      this.measureHeroBand();
      const ratio = window.scrollY / Math.max(1, window.innerHeight);
      const fade = 1 - Math.min(1, Math.max(0, (ratio - 0.16) / 0.42));
      this.scene.setScrollFade(prefersReducedMotion() ? 1 : fade);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => {
      this.measureHeroBand();
      onScroll();
    }, { passive: true });
    this.measureHeroBand();
    onScroll();

    subscribe((state) => {
      document.body.classList.toggle('is-transitioning', state.phase === 'transitioning');
    });
  }

  /* --------------------------------------------------------- resilience -- */

  private failGracefully(error: unknown) {
    console.error('[showcase] WebGL initialisation failed', error);
    this.loader.element.remove();
    document.body.classList.add('no-webgl');
    const notice = el(
      'p',
      'webgl-notice',
      'This showcase needs WebGL to render the DualSense in 3D. Enable hardware acceleration or try a different browser.',
    );
    qs(this.shell, '.hero').append(notice);
  }
}
