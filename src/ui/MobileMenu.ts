import gsap from 'gsap';
import { NAV_ITEMS } from '../data/products';
import { el, esc, qsa } from '../core/dom';
import { dur } from '../core/motion';

/**
 * Full-screen navigation for touch layouts. It reuses the same tokens as the
 * desktop pill menu — black ground, accent typography, glass surfaces — so the
 * motion language stays continuous across breakpoints.
 */
export class MobileMenu {
  readonly element: HTMLElement;
  private readonly items: HTMLElement[];
  private timeline: gsap.core.Timeline | null = null;
  private open = false;

  constructor(private readonly onRequestClose: () => void) {
    this.element = el('div', 'mobile-menu');
    this.element.id = 'mobile-menu';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="mobile-menu__panel" role="dialog" aria-modal="true" aria-label="Menu">
        <ul class="mobile-menu__list">
          ${NAV_ITEMS.map(
            (item, index) => `
            <li class="mobile-menu__item">
              <a href="${esc(item.href)}"><span class="mobile-menu__index">0${index + 1}</span>${esc(item.label)}</a>
            </li>`,
          ).join('')}
        </ul>
      </div>
    `;

    this.items = qsa(this.element, '.mobile-menu__item');
    for (const link of qsa<HTMLAnchorElement>(this.element, 'a')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.onRequestClose();
      });
    }
    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.onRequestClose();
    });
  }

  toggle(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    this.timeline?.kill();

    if (open) {
      this.element.hidden = false;
      this.timeline = gsap
        .timeline()
        .fromTo(
          this.element,
          { opacity: 0 },
          { opacity: 1, duration: dur(0.3), ease: 'power2.out' },
        )
        .fromTo(
          this.items,
          { y: 26, opacity: 0 },
          { y: 0, opacity: 1, duration: dur(0.55), stagger: 0.055, ease: 'power3.out' },
          0.06,
        );
      qsa<HTMLAnchorElement>(this.element, 'a')[0]?.focus();
    } else {
      this.timeline = gsap.timeline({
        onComplete: () => {
          this.element.hidden = true;
        },
      });
      this.timeline
        .to(this.items, { y: -14, opacity: 0, duration: dur(0.22), ease: 'power2.in' })
        .to(this.element, { opacity: 0, duration: dur(0.24), ease: 'power2.in' }, 0.08);
    }
  }
}
