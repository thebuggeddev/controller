/**
 * Product configuration.
 *
 * Everything that differs between the three limited-edition controllers lives
 * here: copy, pricing, model, colour identity, scene lighting and promotional
 * artwork. The UI and the WebGL scene both read from this structure, so adding
 * a fourth campaign is a data change rather than a code change.
 */

export type SpecIcon = 'battery' | 'latency';

export interface ProductSpec {
  icon: SpecIcon;
  value: string;
  label: string;
}

export interface ProductTheme {
  /** Primary interface accent — nav borders, category label, CTA fill, arrows. */
  accent: string;
  /** Slightly brighter accent used for hover / focus states. */
  accentStrong: string;
  /** Ink colour that sits legibly on top of an `accent` fill. */
  accentInk: string;

  /** Background: darkest corner colour. */
  bgBase: string;
  /** Background: mid-radius colour. */
  bgMid: string;
  /** Background: centre glow behind the product. */
  bgGlow: string;
  /** Multiplier on the radial glow strength. */
  glowIntensity: number;

  /** Colour of the elliptical floor illumination. */
  groundGlow: string;
  groundIntensity: number;

  /** Brush artwork tint and how strongly it reads against the background. */
  brushTint: string;
  brushOpacity: number;

  /**
   * Three-point product lighting.
   *
   * Intensities are per-campaign rather than shared because albedo is: the gold
   * shell is dark and takes a strong key, while the two white shells reflect
   * most of what reaches them and blow out on the same rig — measured, a tenth
   * of the God of War surface was sitting above 0.96 luma with no detail left
   * in it.
   */
  keyLight: string;
  keyIntensity: number;
  fillLight: string;
  fillIntensity: number;
  rimLight: string;
  rimIntensity: number;
  /** Strength of the procedural studio environment reflection. */
  envIntensity: number;
  /**
   * Linear multiplier applied to the model's base colour, used to reconcile the
   * render with the physical product.
   *
   * Measured against the campaign's own studio photography, comparing the
   * brightest third of the gold in each: the scan renders at hue 34.5° and
   * saturation 0.459 where the real finish sits at 37.6° and 0.406 — a little
   * too red and a little too saturated. The multiplier corrects both and is
   * normalised so luminance is unchanged, because brightness is the one thing
   * not worth matching: a product on a white sweep is lit nothing like a
   * product in a dark room. Campaigns with no reference photography leave it
   * neutral.
   */
  finish?: [number, number, number];
}

/**
 * Studio photography of the physical product, where it exists.
 *
 * Supplied as cut-outs by `npm run photos`. Campaigns that have it use it for
 * the variant card and the promotional artwork; the rest fall back to stills
 * rendered from their own model, so the interface never waits on assets that
 * were never shot.
 */
export interface ProductPhotography {
  front: string;
  back: string;
}

export interface ProductPromo {
  /** Title lockup drawn over the promotional artwork. */
  title: string;
  /** Small caption under the title. */
  caption: string;
  /** Duration badge / label used by the play affordance. */
  duration: string;
}

export interface Product {
  id: string;
  /** Full accessible name, e.g. for aria-labels and document title. */
  name: string;
  /** Display title, split exactly as it wraps in the reference composition. */
  titleLines: [string, string];
  category: string;
  description: string;
  price: string;
  model: string;
  photography?: ProductPhotography;
  theme: ProductTheme;
  specs: [ProductSpec, ProductSpec];
  promo: ProductPromo;
}

const SPECS: [ProductSpec, ProductSpec] = [
  { icon: 'battery', value: '12 hr', label: 'Battery Life' },
  { icon: 'latency', value: '1 ms', label: 'Low Latency' },
];

export const PRODUCTS: Product[] = [
  {
    id: 'first-light',
    name: '007 First Light DualSense Wireless Controller',
    titleLines: ['007 FIRST', 'LIGHT'],
    category: 'PS5 CONTROLLER',
    description:
      "Style. Power. Precision. Make your mark and don't live tomorrow with the 007 First Light limited edition DualSense controller.",
    price: '$79.99',
    model: '/models/first-light-controller.glb',
    photography: {
      front: '/photography/first-light-front.webp',
      back: '/photography/first-light-back.webp',
    },
    theme: {
      accent: '#e9cb92',
      accentStrong: '#f6e0b4',
      accentInk: '#1a1208',
      bgBase: '#080605',
      bgMid: '#1d1408',
      bgGlow: '#8f6323',
      glowIntensity: 1,
      groundGlow: '#d7a854',
      groundIntensity: 0.78,
      brushTint: '#d6b57c',
      brushOpacity: 0.24,
      keyLight: '#fffcf5',
      keyIntensity: 3.1,
      fillLight: '#9fb2c6',
      fillIntensity: 2.1,
      rimLight: '#ffeed6',
      rimIntensity: 3.2,
      envIntensity: 1.5,
      finish: [0.9, 1.0, 1.27],
    },
    specs: SPECS,
    promo: {
      title: 'First Light',
      caption: 'Behind the design',
      duration: '2:14',
    },
  },
  {
    id: 'genshin-impact',
    name: 'Genshin Impact DualSense Wireless Controller',
    titleLines: ['GENSHIN', 'IMPACT'],
    category: 'PS5 CONTROLLER',
    description:
      'Master elemental energy in Teyvat with an ethereal design, dual tone gradients inspired by iconic Lumine, Paimon and elemental arches.',
    price: '$79.99',
    model: '/models/genshin-impact-controller.glb',
    photography: {
      front: '/photography/genshin-impact-front.webp',
      back: '/photography/genshin-impact-back.webp',
    },
    theme: {
      accent: '#7cd3f7',
      accentStrong: '#a6e4ff',
      accentInk: '#062031',
      bgBase: '#0a1526',
      bgMid: '#152b4a',
      bgGlow: '#3f7fb8',
      glowIntensity: 0.95,
      groundGlow: '#8fdcff',
      groundIntensity: 0.85,
      brushTint: '#a9d8f5',
      brushOpacity: 0.34,
      keyLight: '#fbfeff',
      keyIntensity: 2.2,
      // Warm, unlike the others. A cool fill on a product that is already white
      // and teal leaves nothing to separate its materials from each other; a
      // warm one puts the shadow side on the opposite side of neutral from the
      // key and the teal reads as teal again.
      fillLight: '#b3a696',
      fillIntensity: 1.5,
      rimLight: '#b6e9ff',
      rimIntensity: 2.6,
      envIntensity: 1,
    },
    specs: SPECS,
    promo: {
      title: 'Genshin Impact',
      caption: 'Elemental edition',
      duration: '1:48',
    },
  },
  {
    id: 'god-of-war',
    name: 'God of War DualSense Wireless Controller',
    titleLines: ['GOD OF', 'WAR'],
    category: 'PS5 CONTROLLER',
    description:
      "Unleash your Spartan Rage with the God of War PS5 controller, inspired by Kratos' iconic blades and his relentless journey.",
    price: '$79.99',
    model: '/models/god-of-war-controller.glb',
    photography: {
      front: '/photography/god-of-war-front.webp',
      back: '/photography/god-of-war-back.webp',
    },
    theme: {
      accent: '#f6f1ee',
      accentStrong: '#ffffff',
      accentInk: '#1a0d0c',
      bgBase: '#0e0807',
      bgMid: '#2b1513',
      bgGlow: '#6b342b',
      glowIntensity: 0.92,
      groundGlow: '#e6d3cd',
      groundIntensity: 0.7,
      brushTint: '#c99a8e',
      brushOpacity: 0.22,
      keyLight: '#fffaf7',
      keyIntensity: 2.02,
      fillLight: '#9aa8bb',
      fillIntensity: 1.42,
      rimLight: '#ffe2d6',
      rimIntensity: 2.5,
      envIntensity: 0.94,
    },
    specs: SPECS,
    promo: {
      title: 'God of War',
      caption: 'Forged for Kratos',
      duration: '2:36',
    },
  },
];

export const PRODUCT_INDICATOR = 'PS5';

export const NAV_ITEMS = [
  { label: 'Games', href: '#games' },
  { label: 'Accessories', href: '#accessories' },
  { label: 'News', href: '#news' },
  { label: 'Store', href: '#store' },
  { label: 'Support', href: '#support' },
];
