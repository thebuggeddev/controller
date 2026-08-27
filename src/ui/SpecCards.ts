import type { Product } from '../data/products';
import { el, esc, qsa } from '../core/dom';
import { dur } from '../core/motion';
import { SPEC_ICONS } from './icons';

/** Bottom-right specification cards, on the same glass system as the variants. */
export class SpecCards {
  readonly element: HTMLElement;
  private readonly cards: HTMLElement[];

  constructor(product: Product) {
    this.element = el('ul', 'spec-cards');
    this.element.setAttribute('aria-label', 'Key specifications');
    this.element.innerHTML = product.specs
      .map(
        (spec) => `
        <li class="spec-card">
          <span class="spec-card__icon">${SPEC_ICONS[spec.icon]}</span>
          <span class="spec-card__body">
            <span class="spec-card__value">${esc(spec.value)}</span>
            <span class="spec-card__label">${esc(spec.label)}</span>
          </span>
        </li>`,
      )
      .join('');
    this.cards = qsa(this.element, '.spec-card');
  }

  private write(product: Product) {
    product.specs.forEach((spec, i) => {
      const card = this.cards[i];
      if (!card) return;
      (card.querySelector('.spec-card__icon') as HTMLElement).innerHTML = SPEC_ICONS[spec.icon];
      (card.querySelector('.spec-card__value') as HTMLElement).textContent = spec.value;
      (card.querySelector('.spec-card__label') as HTMLElement).textContent = spec.label;
    });
  }

  transition(product: Product, timeline: gsap.core.Timeline, at = 0) {
    const bodies = this.cards.map((card) => card.querySelector('.spec-card__body') as HTMLElement);
    timeline
      .to(
        bodies,
        { y: -12, opacity: 0, duration: dur(0.26), ease: 'power2.in', stagger: 0.04 },
        at,
      )
      .call(() => this.write(product), undefined, at + dur(0.32))
      .fromTo(
        bodies,
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: dur(0.6), ease: 'power3.out', stagger: 0.06 },
        at + dur(0.44),
      );
  }

  reveal(timeline: gsap.core.Timeline, at = 0) {
    timeline.fromTo(
      this.cards,
      { y: 34, opacity: 0 },
      { y: 0, opacity: 1, duration: dur(0.9), ease: 'power3.out', stagger: 0.09 },
      at,
    );
  }
}
