import { PRODUCT_INDICATOR } from '../data/products';
import { el } from '../core/dom';

/**
 * The vertical platform marker on the right edge — set in rotated type with a
 * hairline arc, drawn as SVG so the curve stays crisp at any density.
 */
export class ProductIndicator {
  readonly element: HTMLElement;

  constructor() {
    this.element = el('div', 'indicator');
    this.element.innerHTML = `
      <svg class="indicator__arc" viewBox="0 0 26 150" aria-hidden="true" preserveAspectRatio="none">
        <path d="M23 3C10 28 4 62 5 92c.4 20 3 38 8 55"
              fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"
              opacity="0.42" vector-effect="non-scaling-stroke"/>
      </svg>
      <p class="indicator__label">
        <span class="bracket">(</span>${PRODUCT_INDICATOR}<span class="bracket">)</span>
      </p>
    `;
  }
}
