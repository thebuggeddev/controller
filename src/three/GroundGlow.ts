import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
} from 'three/webgpu';
import { Fn, float, mix, oneMinus, smoothstep, time, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { ProductTheme } from '../data/products';

/**
 * The illuminated floor beneath the product: a soft pool of light, a thin
 * elliptical contour, and a separate occlusion pass that grounds the controller
 * so it sits *in* the atmosphere rather than floating over it.
 *
 * Both passes are TSL materials on non-uniformly scaled planes — the circle
 * maths stays simple while the result reads as a true ellipse in perspective.
 */
export class GroundGlow {
  readonly group = new Group();

  readonly uColour = uniform(new Color('#d7a854'));
  readonly uIntensity = uniform(1);
  readonly uReveal = uniform(0);
  readonly uContact = uniform(1);

  private readonly glow: Mesh;
  private readonly contact: Mesh;

  constructor() {
    const plane = new PlaneGeometry(1, 1, 1, 1);

    /* --- soft pool + contour ---------------------------------------- */
    const glowMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: true,
    });

    glowMaterial.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const d = p.length();

      // Broad illuminated pool, brightest just inside the contour.
      const pool = oneMinus(smoothstep(0, 1, d)).pow(2.6).mul(0.07);
      // Thin elliptical contour line.
      const edge = d.sub(0.9).div(0.05);
      const contour = edge.mul(edge).mul(-1).exp().mul(0.22);
      // A second, wider bloom just outside the contour so it does not read as
      // a hard vector stroke.
      const bleed = d.sub(0.9).div(0.26);
      const spill = bleed.mul(bleed).mul(-1).exp().mul(0.055);

      // The near half of the ellipse catches more light than the far half.
      const depthBias = mix(float(1.25), float(0.55), uv().y);
      // Slow, near-imperceptible breathing keeps the light alive.
      const breathe = time.mul(0.45).sin().mul(0.05).add(1);

      const strength = pool
        .add(contour)
        .add(spill)
        .mul(depthBias)
        .mul(breathe)
        .mul(this.uIntensity)
        .mul(this.uReveal);

      return this.uColour.mul(strength);
    })();

    this.glow = new Mesh(plane, glowMaterial);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.scale.set(1.02, 0.44, 1);
    this.glow.position.y = 0.0012;
    this.glow.renderOrder = -1;

    /* --- contact occlusion ------------------------------------------- */
    const contactMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: false,
    });
    contactMaterial.colorNode = vec3(0, 0, 0);
    contactMaterial.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      // Two overlapping lobes under the grips give a truer contact shadow than
      // a single radial blob.
      const core = oneMinus(smoothstep(0.05, 1, p.length())).pow(1.9);
      const left = oneMinus(smoothstep(0, 1, p.sub(vec2(-0.52, 0.06)).length().mul(1.7)));
      const right = oneMinus(smoothstep(0, 1, p.sub(vec2(0.52, 0.06)).length().mul(1.7)));
      return core
        .mul(0.5)
        .add(left.mul(0.28))
        .add(right.mul(0.28))
        .mul(this.uContact)
        .mul(this.uReveal)
        .clamp(0, 0.82);
    })();

    this.contact = new Mesh(plane, contactMaterial);
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.scale.set(0.94, 0.34, 1);
    this.contact.position.y = 0.0006;
    this.contact.renderOrder = -2;

    this.group.add(this.contact, this.glow);
  }

  targets(theme: ProductTheme) {
    return {
      colour: new Color(theme.groundGlow),
      intensity: theme.groundIntensity,
    };
  }

  dispose() {
    this.glow.geometry.dispose();
    (this.glow.material as MeshBasicNodeMaterial).dispose();
    (this.contact.material as MeshBasicNodeMaterial).dispose();
  }
}
