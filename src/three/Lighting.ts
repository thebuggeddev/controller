import { Color, DirectionalLight, Group, HemisphereLight, PointLight } from 'three/webgpu';
import type { ProductTheme } from '../data/products';

/**
 * Product lighting: a classic three-point studio rig plus a coloured bounce
 * from the illuminated floor. Restrained rather than dramatic — the goal is a
 * luxury product shot, so the key does the shaping and the rims only draw the
 * silhouette.
 */
export class Lighting {
  readonly group = new Group();

  readonly key = new DirectionalLight('#ffe9c4', 3.1);
  readonly fill = new DirectionalLight('#7d5f38', 1.15);
  readonly rimLeft = new DirectionalLight('#ffd89a', 1.7);
  readonly rimRight = new DirectionalLight('#ffd89a', 1.7);
  readonly bounce = new PointLight('#d7a854', 1.5, 6, 2);
  readonly ambient = new HemisphereLight('#39414c', '#0a0908', 0.62);

  constructor() {
    this.key.position.set(-1.9, 3.1, 2.6);
    this.fill.position.set(2.6, 0.9, 2.2);
    this.rimLeft.position.set(-3.1, 1.4, -2.2);
    this.rimRight.position.set(3.1, 1.5, -2.0);
    // Sits just above the floor and slightly forward, so the underside of the
    // grips picks up the colour of the ground ellipse rather than going dead.
    this.bounce.position.set(0, 0.08, 0.62);

    this.group.add(
      this.key,
      this.fill,
      this.rimLeft,
      this.rimRight,
      this.bounce,
      this.ambient,
    );
  }

  /** Colour/intensity targets for a product, consumed by the transition tween. */
  targets(theme: ProductTheme) {
    return {
      key: new Color(theme.keyLight),
      keyIntensity: theme.keyIntensity,
      fill: new Color(theme.fillLight),
      fillIntensity: theme.fillIntensity,
      rim: new Color(theme.rimLight),
      rimIntensity: theme.rimIntensity,
      bounce: new Color(theme.groundGlow),
    };
  }

  apply(theme: ProductTheme) {
    const t = this.targets(theme);
    this.key.color.copy(t.key);
    this.key.intensity = t.keyIntensity;
    this.fill.color.copy(t.fill);
    this.fill.intensity = t.fillIntensity;
    this.rimLeft.color.copy(t.rim);
    this.rimRight.color.copy(t.rim);
    this.rimLeft.intensity = t.rimIntensity;
    this.rimRight.intensity = t.rimIntensity * 0.85;
    this.bounce.color.copy(t.bounce);
  }
}
