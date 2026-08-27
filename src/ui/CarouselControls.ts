import { PRODUCTS } from '../data/products';
import { el, qs, qsa } from '../core/dom';
import { dur } from '../core/motion';
import * as icons from './icons';

/**
 * Previous / next controls and the segmented progress indicator, positioned on
 * the product's optical axis directly beneath the floor ellipse.
 */
export class CarouselControls {
  readonly element: HTMLElement;
  private readonly segments: HTMLElement[];
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  constructor(
    initialIndex: number,
    private readonly onStep: (direction: 1 | -1) => void,
  ) {
    this.element = el('div', 'carousel');
    this.element.innerHTML = `
      <div class="carousel__progress" role="group" aria-label="Product position">
        ${PRODUCTS.map(
          (_, i) => `<span class="carousel__segment" data-index="${i}"><i></i></span>`,
        ).join('')}
      </div>
      <div class="carousel__buttons">
        <button class="arrow-button arrow-button--prev" type="button" aria-label="Previous controller">
          ${icons.arrowLeft}
        </button>
        <button class="arrow-button arrow-button--next" type="button" aria-label="Next controller">
          ${icons.arrowRight}
        </button>
      </div>
    `;

    this.segments = qsa(this.element, '.carousel__segment');
    this.prev = qs<HTMLButtonElement>(this.element, '.arrow-button--prev');
    this.next = qs<HTMLButtonElement>(this.element, '.arrow-button--next');

    this.prev.addEventListener('click', () => this.onStep(-1));
    this.next.addEventListener('click', () => this.onStep(1));

    this.setIndex(initialIndex);
  }

  setIndex(index: number) {
    this.segments.forEach((segment, i) => segment.classList.toggle('is-active', i === index));
    this.element.setAttribute(
      'aria-label',
      `Controller ${index + 1} of ${PRODUCTS.length}`,
    );
  }

  /** Locks navigation while a transition is mid-flight. */
  setBusy(busy: boolean) {
    this.prev.disabled = busy;
    this.next.disabled = busy;
    this.element.classList.toggle('is-busy', busy);
  }

  transition(index: number, timeline: gsap.core.Timeline, at = 0) {
    timeline.call(() => this.setIndex(index), undefined, at);
  }

  reveal(timeline: gsap.core.Timeline, at = 0) {
    timeline.fromTo(
      this.element,
      { y: 26, opacity: 0 },
      { y: 0, opacity: 1, duration: dur(0.8), ease: 'power3.out' },
      at,
    );
  }
}
