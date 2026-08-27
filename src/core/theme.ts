import { dur } from './motion';
import type { Product } from '../data/products';

/**
 * Bridges a product's colour identity into the CSS custom properties that the
 * interface is built on. Because every component reads the same tokens, one
 * tween here re-skins the whole UI in step with the WebGL transition.
 */

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const int = parseInt(full, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

function tokens(product: Product): Record<string, string> {
  const { theme } = product;
  return {
    '--accent': theme.accent,
    '--accent-strong': theme.accentStrong,
    '--accent-soft': rgba(theme.accent, 0.45),
    '--accent-faint': rgba(theme.accent, 0.13),
    '--accent-ink': theme.accentInk,
    '--product-glow': theme.bgGlow,
    '--background': theme.bgBase,
  };
}

/** Sets the theme with no animation — used for the first paint. */
export function applyTheme(product: Product): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tokens(product))) {
    root.style.setProperty(key, value);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', product.theme.bgBase);
}

/** Tweens the theme onto a shared timeline so UI and 3D resolve together. */
export function transitionTheme(product: Product, timeline: gsap.core.Timeline): void {
  timeline.to(
    document.documentElement,
    { ...tokens(product), duration: dur(1.0), ease: 'power2.inOut' },
    0,
  );
  timeline.call(
    () =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', product.theme.bgBase),
    undefined,
    0.5,
  );
}
