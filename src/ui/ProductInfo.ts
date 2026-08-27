import type { Product } from '../data/products';
import { el, esc, qs } from '../core/dom';
import { dur } from '../core/motion';
import * as icons from './icons';

/**
 * The left-hand product lockup: category, display title, description, and the
 * call-to-action paired with the price on one row.
 *
 * On a campaign change the block leaves and returns as a staggered rise, timed
 * against the model transition so the copy lands as the new product settles.
 */
export class ProductInfo {
  readonly element: HTMLElement;
  private readonly category: HTMLElement;
  private readonly line1: HTMLElement;
  private readonly line2: HTMLElement;
  private readonly description: HTMLElement;
  private readonly price: HTMLElement;
  private readonly cta: HTMLButtonElement;

  constructor(product: Product) {
    this.element = el('section', 'product-info');
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = `
      <p class="product-info__category"><span class="bracket">(</span><span class="product-info__category-text"></span><span class="bracket">)</span></p>
      <h1 class="product-info__title">
        <span class="product-info__line"><span class="product-info__line-inner" data-line="1"></span></span>
        <span class="product-info__line"><span class="product-info__line-inner" data-line="2"></span></span>
      </h1>
      <p class="product-info__description"></p>
      <div class="product-info__actions">
        <button class="cta" type="button">
          <span class="cta__icon">${icons.cart}</span>
          <span class="cta__label">Add to cart</span>
        </button>
        <p class="product-info__price"></p>
      </div>
    `;

    this.category = qs(this.element, '.product-info__category-text');
    this.line1 = qs(this.element, '[data-line="1"]');
    this.line2 = qs(this.element, '[data-line="2"]');
    this.description = qs(this.element, '.product-info__description');
    this.price = qs(this.element, '.product-info__price');
    this.cta = qs<HTMLButtonElement>(this.element, '.cta');

    this.write(product);
  }

  private write(product: Product) {
    this.category.textContent = product.category;
    this.line1.textContent = product.titleLines[0];
    this.line2.textContent = product.titleLines[1];
    this.description.textContent = product.description;
    this.price.innerHTML = `<span class="visually-hidden">Price </span>${esc(product.price)}`;
    this.cta.setAttribute('aria-label', `Add ${product.name} to cart`);
  }

  private get lines(): HTMLElement[] {
    return [this.category.parentElement as HTMLElement, this.line1, this.line2];
  }

  private get tail(): HTMLElement[] {
    return [this.description, qs(this.element, '.product-info__actions')];
  }

  /** Adds this block's half of a campaign change to the shared timeline. */
  transition(product: Product, timeline: gsap.core.Timeline, at = 0) {
    const out = [...this.lines, ...this.tail];
    timeline
      .to(
        out,
        {
          yPercent: -42,
          opacity: 0,
          duration: dur(0.3),
          ease: 'power2.in',
          stagger: 0.03,
        },
        at,
      )
      .call(() => this.write(product), undefined, at + dur(0.32))
      .fromTo(
        this.lines,
        { yPercent: 62, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          duration: dur(0.72),
          ease: 'power3.out',
          stagger: 0.05,
        },
        at + dur(0.36),
      )
      .fromTo(
        this.tail,
        // yPercent is reset explicitly: the exit tween moves these elements by
        // percentage and the entrance moves them by pixels, so the percentage
        // offset would otherwise persist and pull the copy up.
        { y: 22, yPercent: 0, opacity: 0 },
        { y: 0, yPercent: 0, opacity: 1, duration: dur(0.62), ease: 'power3.out', stagger: 0.06 },
        at + dur(0.46),
      );
  }

  /** Intro reveal used once, after the first model is ready. */
  reveal(timeline: gsap.core.Timeline, at = 0) {
    timeline
      .fromTo(
        this.lines,
        { yPercent: 92, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: dur(1), ease: 'expo.out', stagger: 0.08 },
        at,
      )
      .fromTo(
        this.tail,
        { y: 28, yPercent: 0, opacity: 0 },
        { y: 0, yPercent: 0, opacity: 1, duration: dur(0.85), ease: 'power3.out', stagger: 0.09 },
        at + 0.18,
      );
  }
}
