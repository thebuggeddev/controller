import { NAV_ITEMS } from '../data/products';
import { el, esc, qs, qsa } from '../core/dom';
import * as icons from './icons';

/**
 * Top navigation: the PlayStation mark, the outlined pill menu, and the
 * circular utility actions. Below the desktop breakpoint the pill menu is
 * replaced by a menu button that drives the full-screen overlay.
 */
export class Header {
  readonly element: HTMLElement;
  private readonly menuButton: HTMLButtonElement;

  constructor(private readonly onMenuToggle: () => void) {
    this.element = el('header', 'header');
    this.element.innerHTML = `
      <a class="header__logo" href="#top" aria-label="PlayStation home">${icons.psLogo}</a>

      <nav class="header__nav" aria-label="Primary">
        <ul class="nav-pills">
          ${NAV_ITEMS.map(
            (item) =>
              `<li><a class="nav-pill" href="${esc(item.href)}">${esc(item.label)}</a></li>`,
          ).join('')}
        </ul>
      </nav>

      <div class="header__utility">
        <button class="utility-button" type="button" aria-label="Search">${icons.search}</button>
        <button class="utility-button" type="button" aria-label="Your account">${icons.user}</button>
        <button class="utility-button" type="button" aria-label="Cart, 0 items">${icons.bag}</button>
        <button class="utility-button utility-button--menu" type="button"
                aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">
          ${icons.menu}
        </button>
      </div>
    `;

    this.menuButton = qs<HTMLButtonElement>(this.element, '.utility-button--menu');
    this.menuButton.addEventListener('click', this.onMenuToggle);

    // The nav is decorative in this showcase; keep the links from navigating
    // away while still exposing real anchors to assistive technology.
    for (const link of qsa<HTMLAnchorElement>(this.element, '.nav-pill')) {
      link.addEventListener('click', (event) => event.preventDefault());
    }
  }

  setMenuOpen(open: boolean) {
    this.menuButton.setAttribute('aria-expanded', String(open));
    this.menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    this.menuButton.innerHTML = open ? icons.close : icons.menu;
  }
}
