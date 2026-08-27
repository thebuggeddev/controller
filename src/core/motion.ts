import gsap from 'gsap';

/**
 * Motion language for the whole experience.
 *
 * A campaign change is one full revolution with the product swapped at the far
 * side of it. The controller accelerates into a turn, and as it comes round to
 * face away — the fastest part of the arc, and the only moment its front is
 * hidden — the next product takes over and decelerates the remaining half-turn
 * into the hero pose.
 *
 * Nothing cross-fades. Every attempt to hand over by opacity dipped: two
 * products at different angles cannot overlap without ghosting, so their fades
 * have to be sequential, and sequential fades leave the frame between them
 * carrying almost nothing — the hero dimmed to a fifth and came back, which is
 * exactly what a blink is. Swapping outright at the halfway point keeps the
 * product's presence in the frame constant at one throughout, and hides the
 * change on the back of a controller travelling at the peak of its arc.
 */
export const MOTION = {
  ease: 'power3.out',
  easeIn: 'power2.in',
  easeInOut: 'power2.inOut',
  easeExpo: 'expo.out',

  /** A complete turn, in radians, split half to each product. */
  turn: Math.PI * 2,
  /** Depth the turn breathes back through at the swap, in world units. */
  depth: -0.35,

  /** How long each half of the revolution takes, in seconds. */
  half: 0.46,

  /** Length of the atmosphere and lighting crossfade. */
  crossfade: 1.05,
  /** Length of the shader light-sweep that carries the change. */
  sweep: 1.05,
} as const;

const query =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

let reduced = query?.matches ?? false;

query?.addEventListener('change', (event) => {
  reduced = event.matches;
  gsap.globalTimeline.timeScale(reduced ? 100 : 1);
});

/** True when the visitor has asked the OS to minimise animation. */
export function prefersReducedMotion(): boolean {
  return reduced;
}

/** Scales a duration to zero-ish when reduced motion is requested. */
export function dur(seconds: number): number {
  return reduced ? 0.001 : seconds;
}

/** Frame-rate independent damping factor for lerps inside the render loop. */
export function damp(lambda: number, delta: number): number {
  return 1 - Math.exp(-lambda * delta);
}

export { gsap };
