import gsap from 'gsap';
import { PRODUCTS, type Product } from '../data/products';
import { el, esc, qsa } from '../core/dom';
import { dur, prefersReducedMotion } from '../core/motion';

/**
 * The right-hand variant rail.
 *
 * It shows the campaigns you are *not* looking at — the product on show is
 * already the hero, so a card for it would be redundant. With three campaigns
 * that means two cards, always: the one up next reads larger and nearer, the
 * one after it sits smaller and further back, which is where the composition
 * gets its sense of a catalogue continuing past the edge of the frame.
 *
 * Cards keep their identity across a change and are tweened between slots, so
 * switching campaigns shuffles the rail rather than rebuilding it.
 */

/** Slot geometry, in multiples of `--card-w`, taken from the reference. */
const SLOTS = [
  { width: 1, height: 1.316, opacity: 1 },
  { width: 0.786, height: 1.113, opacity: 0.82 },
];
const GAP = 0.133;

export class ProductVariants {
  readonly element: HTMLElement;
  private readonly cards: HTMLButtonElement[];
  private readonly items: HTMLElement[];
  private index: number;

  constructor(
    initialIndex: number,
    private readonly onSelect: (index: number) => void,
  ) {
    this.index = initialIndex;
    this.element = el('div', 'variants');
    this.element.innerHTML = `
      <i class="variants__probe" aria-hidden="true"></i>
      <ul class="variants__track" aria-label="Other controllers">
        ${PRODUCTS.map(
          (product, i) => `
          <li class="variants__item" data-index="${i}">
            <button class="variant-card" type="button" data-index="${i}">
              <span class="variant-card__surface" aria-hidden="true"></span>
              <span class="variant-card__media">
                <img class="variant-card__image" alt="" decoding="async" />
              </span>
              <span class="visually-hidden">Show ${esc(product.name)}</span>
            </button>
          </li>`,
        ).join('')}
      </ul>
    `;

    this.items = qsa(this.element, '.variants__item');
    this.cards = qsa<HTMLButtonElement>(this.element, '.variant-card');

    for (const card of this.cards) {
      card.addEventListener('click', () => {
        const target = Number(card.dataset.index);
        if (target !== this.index) this.onSelect(target);
      });
      card.addEventListener('keydown', (event) => this.onKeydown(event));
    }

    this.layout(initialIndex, true);

    // The first layout runs before the rail is in the document, where the slot
    // unit cannot be measured. Observing the rail re-solves it the moment it
    // has a box, and again whenever the viewport changes it.
    this.observer = new ResizeObserver(() => this.layout(this.index, true));
    this.observer.observe(this.element);
  }

  private readonly observer: ResizeObserver;

  private onKeydown(event: KeyboardEvent) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const order = this.order(this.index);
    const current = order.indexOf(Number((event.currentTarget as HTMLElement).dataset.index));
    const next = order[(current + delta + order.length) % order.length];
    this.cards[next].focus();
  }

  /** The campaigns after the active one, wrapping — the order they queue up in. */
  private order(active: number): number[] {
    return PRODUCTS.map((_, i) => i)
      .filter((i) => i !== active)
      .sort((a, b) => {
        const da = (a - active + PRODUCTS.length) % PRODUCTS.length;
        const db = (b - active + PRODUCTS.length) % PRODUCTS.length;
        return da - db;
      });
  }

  /**
   * The slot unit, in pixels.
   *
   * Measured from a zero-height probe rather than read off the custom property:
   * `--card-w` is a `clamp()`, and a custom property holding one is returned
   * verbatim by `getComputedStyle` — it is only resolved where it is used.
   */
  private cardWidth(): number {
    const probe = this.element.querySelector<HTMLElement>('.variants__probe');
    return probe?.getBoundingClientRect().width || 180;
  }

  /**
   * Places every card in its slot. Cards that have no slot are parked just off
   * the trailing edge, so they leave and arrive along the rail rather than
   * appearing out of nowhere.
   */
  private layout(active: number, immediate = false) {
    this.index = active;
    const stacked = window.innerWidth < 1024;
    const width = this.cardWidth();
    const order = this.order(active);

    let cursor = 0;
    const placements = new Map<number, { x: number; slot: number }>();
    order.forEach((productIndex, position) => {
      const slot = SLOTS[Math.min(position, SLOTS.length - 1)];
      placements.set(productIndex, { x: cursor, slot: Math.min(position, SLOTS.length - 1) });
      cursor += width * slot.width + width * GAP;
    });
    const parked = cursor;

    this.items.forEach((item, i) => {
      const card = this.cards[i];
      const placement = placements.get(i);
      const hidden = !placement;
      const slot = SLOTS[placement?.slot ?? SLOTS.length - 1];

      card.setAttribute('aria-hidden', String(hidden));
      card.tabIndex = hidden ? -1 : 0;
      card.classList.toggle('is-lead', placement?.slot === 0);

      const to = {
        x: stacked ? 0 : (placement?.x ?? parked),
        width: stacked ? '' : `${width * slot.width}px`,
        height: stacked ? '' : `${width * slot.height}px`,
        opacity: hidden ? 0 : slot.opacity,
        duration: immediate || prefersReducedMotion() ? 0 : dur(0.75),
        ease: 'power3.out',
        overwrite: 'auto' as const,
      };

      if (stacked) {
        // The touch rail is a plain scrolling row; slots do not apply.
        gsap.set(item, { clearProps: 'transform' });
        item.style.transform = '';
        card.style.width = '';
        card.style.height = '';
        item.style.display = hidden ? 'none' : '';
        card.style.opacity = '1';
        return;
      }

      item.style.display = '';
      // `yPercent` is set explicitly rather than left to the stylesheet: the
      // first layout runs before the rail is in the document, and GSAP would
      // resolve a CSS `translateY(-50%)` against a zero height and drop it.
      gsap.to(item, {
        x: to.x,
        yPercent: -50,
        duration: to.duration,
        ease: to.ease,
        overwrite: 'auto',
      });
      gsap.to(card, {
        width: to.width,
        height: to.height,
        opacity: to.opacity,
        duration: to.duration,
        ease: to.ease,
        overwrite: 'auto',
      });
    });
  }

  /**
   * Card artwork. Studio photography where a campaign has it, otherwise a still
   * rendered from its own model.
   */
  setArtwork(index: number, src: string, label: string) {
    const card = this.cards[index];
    const image = card?.querySelector<HTMLImageElement>('.variant-card__image');
    if (!image) return;

    const reveal = () => {
      if (card.classList.contains('has-artwork')) return;
      card.classList.add('has-artwork');
      gsap.fromTo(
        image,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: dur(0.7), ease: 'power3.out' },
      );
    };

    if (image.src === new URL(src, location.href).href) {
      // Re-applying the same source fires no load event, so the card would sit
      // on its placeholder forever.
      reveal();
      return;
    }
    image.alt = label;
    image.addEventListener('load', reveal, { once: true });
    image.src = src;
    if (image.complete && image.naturalWidth > 0) reveal();
  }

  transition(_product: Product, index: number, timeline: gsap.core.Timeline, at = 0) {
    timeline.call(() => this.layout(index), undefined, at);
  }

  reveal(timeline: gsap.core.Timeline, at = 0) {
    // The intro animates the cards themselves, never the items: the items carry
    // the slot transform, and touching it here — even to clear it — would wipe
    // the positions `layout` just set.
    timeline.from(
      this.cards,
      {
        opacity: 0,
        scale: 0.9,
        duration: dur(0.9),
        ease: 'power3.out',
        stagger: 0.08,
        transformOrigin: '50% 50%',
      },
      at,
    );
  }

  destroy() {
    this.observer.disconnect();
  }
}
