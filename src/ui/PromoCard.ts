import gsap from 'gsap';
import type { Product } from '../data/products';
import { el, qs } from '../core/dom';
import { dur } from '../core/motion';
import * as icons from './icons';

/**
 * Bottom-left promotional card. The artwork is composed from the campaign's own
 * colour identity and a render of the actual controller, so it stays truthful
 * to the product on show rather than standing in as generic key art.
 */
export class PromoCard {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly duration: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly figure: HTMLElement;

  constructor(product: Product) {
    this.element = el('article', 'promo-card');
    this.element.innerHTML = `
      <button class="promo-card__button" type="button">
        <span class="promo-card__art">
          <span class="promo-card__wash" aria-hidden="true"></span>
          <span class="promo-card__grain" aria-hidden="true"></span>
          <span class="promo-card__figure">
            <img class="promo-card__image" alt="" decoding="async" />
          </span>
          <svg class="promo-card__corner" viewBox="0 0 46 46" aria-hidden="true">
            <path d="M0 0h46L0 46Z" fill="url(#promo-corner)"/>
            <defs>
              <linearGradient id="promo-corner" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#2f7fe0"/>
                <stop offset="1" stop-color="#7ec6ff"/>
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span class="promo-card__copy">
          <span class="promo-card__title"></span>
          <span class="promo-card__caption"></span>
        </span>
        <span class="promo-card__play">${icons.play}</span>
        <span class="promo-card__duration"></span>
      </button>
    `;

    this.title = qs(this.element, '.promo-card__title');
    this.caption = qs(this.element, '.promo-card__caption');
    this.duration = qs(this.element, '.promo-card__duration');
    this.image = qs<HTMLImageElement>(this.element, '.promo-card__image');
    this.figure = qs(this.element, '.promo-card__figure');

    this.write(product);
  }

  private write(product: Product) {
    this.title.textContent = product.promo.title;
    this.caption.textContent = product.promo.caption;
    this.duration.textContent = product.promo.duration;
    qs<HTMLButtonElement>(this.element, '.promo-card__button').setAttribute(
      'aria-label',
      `Play ${product.promo.title} \u2014 ${product.promo.caption}, ${product.promo.duration}`,
    );
  }

  setArtwork(src: string) {
    this.image.src = src;
    this.image.addEventListener(
      'load',
      () => {
        gsap.fromTo(
          this.figure,
          { opacity: 0, scale: 1.08 },
          { opacity: 1, scale: 1, duration: dur(0.8), ease: 'power3.out' },
        );
      },
      { once: true },
    );
  }

  transition(product: Product, timeline: gsap.core.Timeline, at = 0) {
    const copy = [this.title, this.caption];
    timeline
      .to(copy, { y: -14, opacity: 0, duration: dur(0.26), ease: 'power2.in' }, at)
      .to(this.figure, { opacity: 0, duration: dur(0.3), ease: 'power2.in' }, at)
      .call(() => this.write(product), undefined, at + dur(0.3))
      .fromTo(
        copy,
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: dur(0.6), ease: 'power3.out', stagger: 0.05 },
        at + dur(0.42),
      );
  }

  reveal(timeline: gsap.core.Timeline, at = 0) {
    timeline.fromTo(
      this.element,
      { y: 34, opacity: 0 },
      { y: 0, opacity: 1, duration: dur(0.9), ease: 'power3.out' },
      at,
    );
  }
}
