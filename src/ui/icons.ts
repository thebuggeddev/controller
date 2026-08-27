/**
 * SVG icon set. Every vector in the interface is drawn here rather than
 * rasterised, so the marks stay crisp at any density and can inherit the
 * active product accent through `currentColor`.
 */

const stroke = (d: string, w = 1.6) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * PlayStation family "PS" monogram — the italic P with its counter cut out and
 * the heavier S set behind it, drawn as vector so it inherits the product
 * accent through `currentColor`.
 */
export const psLogo = `
<svg class="icon icon--logo" viewBox="0 0 112 60" role="img" aria-label="PlayStation">
  <g fill="currentColor">
    <path fill-rule="evenodd" d="M22.6 3h25.2c13.6 0 22 6.3 22 16.3 0 10.8-9.6 17.6-25.1 17.6h-9.9L32.4 57H17.4L22.6 3Zm12.4 11.6-1.2 12.1h9.4c5.8 0 9.4-2.5 9.4-6.4 0-3.6-3.2-5.7-9-5.7h-8.6Z"/>
    <path d="M104.8 14.9c-3.6-2.7-8.6-4.3-13.4-4.3-4.6 0-7.3 1.8-7.3 4.4 0 2.2 2 3.5 8.1 5.4 9.4 2.9 13.6 6.7 13.6 13.3 0 9.3-8 15.4-19.9 15.4-7.3 0-14.1-2.3-18.6-6.1l7-9.1c3.6 3.1 8.4 5.1 13 5.1 4.2 0 6.7-1.6 6.7-4.2 0-2.3-1.9-3.6-8-5.6-9.1-2.9-13.3-6.6-13.3-13.2C72.7 6.4 80.7.4 92.4.4c6.5 0 12.4 1.9 16.8 5l-4.4 9.5Z"/>
  </g>
</svg>`;

export const search = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM15.7 15.7 20 20', 1.9)}
</svg>`;

export const user = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M12 12.1a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4Z', 1.9)}
  ${stroke('M4.9 20a7.4 7.4 0 0 1 14.2 0', 1.9)}
</svg>`;

export const bag = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M5.4 7.6h13.2l1 12.1a1.4 1.4 0 0 1-1.4 1.5H5.8a1.4 1.4 0 0 1-1.4-1.5Z', 1.8)}
  ${stroke('M8.7 9.6V6.4a3.3 3.3 0 1 1 6.6 0v3.2', 1.8)}
</svg>`;

export const cart = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M2.6 3.4h2.6l2.3 10.9h9.8l2.1-8H6.2', 1.8)}
  <circle cx="9.4" cy="19" r="1.7" fill="currentColor"/>
  <circle cx="16.6" cy="19" r="1.7" fill="currentColor"/>
</svg>`;

export const battery = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M8.4 6.2h7.2a2 2 0 0 1 2 2v11.4a2 2 0 0 1-2 2H8.4a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2Z', 1.7)}
  ${stroke('M9.9 4.2h4.2', 1.7)}
  <path d="M12.9 9.4 9.6 14.6h2.3l-.8 4.2 3.4-5.4h-2.4Z" fill="currentColor"/>
</svg>`;

export const latency = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M13.4 2.6 4.8 13.5h6L9.9 21.4l9-11.2h-6.2Z', 1.7)}
</svg>`;

export const arrowLeft = `
<svg class="icon" viewBox="0 0 28 16" aria-hidden="true">
  ${stroke('M26 8H2M9 1.5 2 8l7 6.5', 2.1)}
</svg>`;

export const arrowRight = `
<svg class="icon" viewBox="0 0 28 16" aria-hidden="true">
  ${stroke('M2 8h24M19 1.5 26 8l-7 6.5', 2.1)}
</svg>`;

export const play = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M9 6.4 18.4 12 9 17.6Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

export const menu = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M4 8h16M4 16h16', 1.9)}
</svg>`;

export const close = `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  ${stroke('M6 6l12 12M18 6 6 18', 1.9)}
</svg>`;

/** The small left/right handle that sits on the ground ellipse. */
export const dragHandle = `
<svg class="icon" viewBox="0 0 26 12" aria-hidden="true">
  <path d="M8.6 2.4 4.1 6l4.5 3.6Z" fill="currentColor"/>
  <path d="M17.4 2.4 21.9 6l-4.5 3.6Z" fill="currentColor"/>
</svg>`;

export const SPEC_ICONS = { battery, latency };
