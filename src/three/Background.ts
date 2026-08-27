import { Color, Vector2, type Node, type Texture } from 'three/webgpu';
import {
  Fn,
  dot,
  float,
  fract,
  mix,
  oneMinus,
  screenUV,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { ProductTheme } from '../data/products';

/**
 * The layered atmosphere behind the product, authored entirely in TSL and bound
 * to `scene.backgroundNode` so it is evaluated per screen pixel:
 *
 *   base charcoal  →  atmospheric falloff  →  brush artwork  →
 *   product radial glow  →  transition light-sweep  →  vignette  →  grain
 *
 * Every product-specific value is a uniform, so switching campaigns is a tween
 * of shader inputs rather than a swap of assets.
 */
export class Background {
  readonly uBase = uniform(new Color('#0a0705'));
  readonly uMid = uniform(new Color('#2a1c09'));
  readonly uGlow = uniform(new Color('#8a5f20'));
  readonly uGlowIntensity = uniform(1);
  readonly uBrushTint = uniform(new Color('#d6b57c'));
  readonly uBrushOpacity = uniform(0.12);

  /** Glow centre in screen UV — matches the product's optical centre. */
  readonly uCenter = uniform(new Vector2(0.492, 0.514));
  readonly uAspect = uniform(1.6);
  /** Pointer parallax offset, kept tiny so the light merely breathes. */
  readonly uParallax = uniform(new Vector2(0, 0));
  /** Radius of the expanding ring driven during a product change. */
  readonly uSweep = uniform(0);
  readonly uSweepStrength = uniform(0);
  /** Intro reveal — 0 while the first model is still loading. */
  readonly uReveal = uniform(0);

  readonly node: Node;

  constructor(brushMap: Texture | null) {
    const brush = brushMap ? texture(brushMap) : null;

    this.node = Fn(() => {
      const centre = this.uCenter.add(this.uParallax);
      const offset = screenUV.sub(centre);
      // Aspect-correct so the light pool stays circular in any window shape,
      // then squash it slightly: the reference glow spreads sideways.
      const p = vec2(offset.x.mul(this.uAspect).mul(0.86), offset.y.mul(1.24));
      const r = p.length();

      /* --- base + atmospheric falloff ---------------------------------- */
      const body = mix(this.uMid, this.uBase, smoothstep(0.06, 0.62, r));

      /* --- brush artwork ------------------------------------------------ */
      // Anchored to the glow so the artwork and the light read as one gesture.
      const brushed = brush
        ? (() => {
            // Normalised against the reference 16:10 frame so the artwork keeps
            // its proportions on ultrawide displays instead of smearing out.
            const widthScale = this.uAspect.div(1.6).max(1).mul(1.04);
            const bUv = screenUV
              .sub(centre)
              .mul(vec2(float(1).div(widthScale), float(1).div(0.68)))
              .add(vec2(0.5, 0.5));
            // Clip to the artwork's own bounds with a soft edge on all four sides.
            const inside = smoothstep(0, 0.015, bUv.x)
              .mul(oneMinus(smoothstep(0.985, 1, bUv.x)))
              .mul(smoothstep(0, 0.015, bUv.y))
              .mul(oneMinus(smoothstep(0.985, 1, bUv.y)));
            // Washed out where the light pools; swallowed by the dark corners.
            const visibility = smoothstep(0.04, 0.4, r).mul(oneMinus(smoothstep(0.42, 1.05, r)));
            const stroke = brush.sample(bUv).a.mul(inside).mul(visibility);
            return body.add(this.uBrushTint.mul(stroke.mul(this.uBrushOpacity)));
          })()
        : body;

      /* --- product radial glow ------------------------------------------ */
      const core = r.mul(r).mul(-13).exp().mul(0.46);
      const halo = r.mul(r).mul(-3).exp().mul(0.15);
      const drift = sin(time.mul(0.32)).mul(0.045).add(1); // slow ambient breathing
      const glow = core.add(halo).mul(this.uGlowIntensity).mul(drift).mul(this.uReveal);
      const lit = brushed.add(this.uGlow.mul(glow));

      /* --- transition light sweep ---------------------------------------- */
      // An expanding ring of the incoming product's light, tying the background
      // change to the model change.
      const ringR = r.sub(this.uSweep.mul(1.45)).div(0.24);
      const ring = ringR.mul(ringR).mul(-1).exp().mul(this.uSweepStrength).mul(0.9);
      const swept = lit.add(this.uGlow.mul(ring));

      /* --- vignette ------------------------------------------------------- */
      const vignetted = swept.mul(mix(float(1), float(0.05), smoothstep(0.13, 0.88, r)));

      /* --- grain ---------------------------------------------------------- */
      // Hash noise at ~1.5% keeps these very wide gradients free of banding.
      const seed = dot(screenUV, vec2(12.9898, 78.233));
      const grain = fract(sin(seed).mul(43758.5453)).sub(0.5).mul(0.014);

      return vec4(vignetted.add(grain), 1);
    })() as unknown as Node;
  }

  /** Colour targets for a product; tweened onto the shared timeline. */
  targets(theme: ProductTheme) {
    return {
      base: new Color(theme.bgBase),
      mid: new Color(theme.bgMid),
      glow: new Color(theme.bgGlow),
      glowIntensity: theme.glowIntensity,
      brushTint: new Color(theme.brushTint),
      brushOpacity: theme.brushOpacity,
    };
  }

  setAspect(width: number, height: number) {
    this.uAspect.value = width / height;
  }
}
