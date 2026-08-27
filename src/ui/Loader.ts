import gsap from 'gsap';
import { el, qs } from '../core/dom';
import { dur } from '../core/motion';
import * as icons from './icons';

/**
 * Loading composition. Rather than a blank frame, the visitor sees the same
 * atmosphere the hero will occupy — a soft radial glow, the platform mark, and
 * a hairline progress rule that resolves into the product reveal.
 */
export class Loader {
  readonly element: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly proxy = { value: 0 };
  private shown = 0;

  constructor() {
    this.element = el('div', 'loader');
    this.element.innerHTML = `
      <div class="loader__glow" aria-hidden="true"></div>
      <div class="loader__mark">${icons.psLogo}</div>
      <div class="loader__meta" role="status" aria-live="polite">
        <p class="loader__label"><span class="bracket">(</span>Preparing the showcase<span class="bracket">)</span></p>
        <div class="loader__bar"><i></i></div>
        <p class="loader__percent">0%</p>
      </div>
    `;
    this.bar = qs(this.element, '.loader__bar i');
    this.percent = qs(this.element, '.loader__percent');
  }

  /** Progress is eased rather than snapped so the bar never stutters. */
  set(ratio: number) {
    const target = Math.max(this.shown, Math.min(1, ratio));
    this.shown = target;
    gsap.to(this.proxy, {
      value: target,
      duration: dur(0.5),
      ease: 'power2.out',
      onUpdate: () => {
        this.bar.style.transform = `scaleX(${this.proxy.value})`;
        this.percent.textContent = `${Math.round(this.proxy.value * 100)}%`;
      },
    });
  }

  /** Hands off to the hero reveal; resolves when the overlay is gone. */
  dismiss(): gsap.core.Timeline {
    return gsap
      .timeline({
        onComplete: () => {
          this.element.remove();
        },
      })
      .to(this.percent.parentElement, { opacity: 0, duration: dur(0.3), ease: 'power2.in' })
      .to(
        this.element,
        { opacity: 0, duration: dur(0.7), ease: 'power2.inOut' },
        dur(0.15),
      );
  }
}
