/**
 * Product photography pipeline.
 *
 * Turns the supplied studio shots into cut-outs the dark interface can use.
 *
 * The obvious approach — key on how far a pixel sits from the sweep's tone —
 * does not survive these images. Four of the six controllers are largely white
 * on a near-white sweep, and measurement shows the product's whites do not sit
 * to one side of the sweep but straddle it: the palest part of a Genshin grip
 * reads 0.938 against a sweep of 0.934, while its shaded flank reads 0.87 and
 * the contact shadow beneath reaches 0.88. Tone alone cannot separate them.
 *
 * What can is the boundary. The sweep and its shadow vary by a value or two per
 * pixel; the silhouette drops twenty to thirty in one or two. So the background
 * is flood-filled inward from the frame edge through a Sobel edge map used as a
 * barrier — it flows freely across the sweep and down into the shadow, and
 * stops at the product's contour whatever tone lies on either side. The barrier
 * is dilated a pixel to seal any hairline gap in that contour, then given back
 * to the background afterwards so the cut lands on the true edge.
 *
 * Run with:  npm run photos
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join('public', 'photography');

const SOURCES = [
  { file: '518644ea-21eb-47f5-ad23-37cf5d413f50.png', name: 'first-light-front' },
  { file: '09a8ed22-a686-4b2c-9962-241d7650b785.png', name: 'first-light-back' },
  { file: '3d60b235-de3b-4219-bc7b-f5a400496e6d.png', name: 'genshin-impact-front' },
  { file: '915fc5d2-3022-447e-9bd0-02cc934e96d1.png', name: 'genshin-impact-back' },
  { file: '82d769b6-b06c-4275-8f0e-cddbe0ba15ee.png', name: 'god-of-war-front' },
  { file: '009eff09-d262-406c-a052-98cbb7d18076.png', name: 'god-of-war-back' },
];

/**
 * Barrier thresholds, applied with hysteresis.
 *
 * A single threshold cannot serve here: set high enough to ignore the contact
 * shadow's own falloff and the silhouette stops being watertight along a white
 * flank, so the fill eats the product; set low enough to hold that flank and
 * the shadow walls itself in and survives as a halo around the base.
 *
 * So only gradients above `EDGE_HIGH` are barriers outright. Anything above
 * `EDGE_LOW` becomes one *if it connects to a strong edge* — which the weak
 * stretches of a silhouette do, being part of the same contour, and which an
 * isolated patch of shadow gradient does not.
 */
const EDGE_HIGH = 0.1;
const EDGE_LOW = 0.03;
/**
 * How far a weak edge may be promoted from a strong one, for each of the two
 * barriers the matte is built from.
 *
 * Neither setting works alone. Promote without limit and the silhouette is
 * watertight — but the contact shadow's falloff is a long chain of weak
 * gradient that *touches* the hard edge where a grip meets the surface, so the
 * whole smear inherits barrier status and the fill can never reach it, leaving
 * pale patches beside the grips. Cap the reach and the shadow goes, but the
 * silhouette springs a leak and the fill runs deep into the product, hollowing
 * out anything near the sweep's tone — the Genshin touchpad, for one.
 *
 * So both are built, and each is used for what it is good at.
 */
const REACH_SEALED = Infinity;
const REACH_OPEN = 4;
/**
 * Where the open pass's verdict is allowed to apply, as a fraction of the
 * product's own height measured from its top.
 *
 * Contact shadow is a fact about the base: it exists where the product meets
 * the surface and nowhere else. Confining the verdict to the lowest quarter is
 * therefore not a fudge but the physical constraint, and it is what stops the
 * open barrier's leaks from mattering — the Genshin touchpad sits in the upper
 * half of the frame and is simply never eligible.
 */
const SHADOW_ZONE = 0.76;
/** How far the verdict may travel inward from the true exterior, in pixels. */
const SHADOW_REACH = 0.12;
/** Pixels of dilation used to seal hairline gaps in the contour. */
const SEAL = 1;
/** Thinning applied before the component search, to snap shadow bridges. */

/**
 * Radius, in pixels, of the blur used to resolve the matte's edge.
 *
 * The mask comes out of a flood fill and two rounds of four-connected dilation,
 * which leaves a hard, stair-stepped, faintly diamond-shaped boundary — legible
 * as a ragged outline once the cut-out sits on a dark card. Blurring the mask
 * and re-thresholding it through a smoothstep rounds that boundary off and
 * leaves a genuinely anti-aliased edge in its place.
 */
const EDGE_BLUR = 2;
/**
 * Where the blurred mask is cut. Biased past the halfway mark so the boundary
 * settles just inside the silhouette: land it outside and the edge pixels carry
 * a little of the white sweep, which reads as a pale outline on a dark ground.
 */
const EDGE_LOW_CUT = 0.44;
const EDGE_HIGH_CUT = 0.78;
/**
 * Height of the fade applied at the product's base, as a fraction of its own
 * height.
 *
 * The last of the contact shadow cannot be told from the product by tone: both
 * the shadow and the grip tips resting in it measure 0.73 to 0.74, and any
 * threshold that removes one removes the other — or, set the other way, bites a
 * notch out of the lit white above it. So neither is singled out. The base is
 * simply ramped away over a short band, which takes the shadow with it and
 * costs a few rows of grip that were sitting in deep shadow anyway. On a dark
 * card the result reads as a product grounded on the surface rather than one
 * cut out and pasted onto it.
 */
const BASE_FADE = 0.085;

const SIZE = 1100;

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Sobel magnitude, thresholded with hysteresis and sealed into a barrier.
 *
 * `reach` caps how far a weak edge may be promoted from a strong one, and the
 * two settings it is called with do different jobs — see `growBackground`.
 */
function contour(lum, width, height, reach) {
  const count = width * height;
  const strong = new Uint8Array(count);
  const weak = new Uint8Array(count);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -lum[i - width - 1] - 2 * lum[i - 1] - lum[i + width - 1] +
        lum[i - width + 1] + 2 * lum[i + 1] + lum[i + width + 1];
      const gy =
        -lum[i - width - 1] - 2 * lum[i - width] - lum[i - width + 1] +
        lum[i + width - 1] + 2 * lum[i + width] + lum[i + width + 1];
      const magnitude = Math.hypot(gx, gy);
      if (magnitude > EDGE_HIGH) strong[i] = 1;
      else if (magnitude > EDGE_LOW) weak[i] = 1;
    }
  }

  // Promote weak edges that lie within a short reach of a strong one.
  const edge = Uint8Array.from(strong);
  const depth = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    if (edge[i]) {
      depth[i] = 0;
      queue[tail++] = i;
    }
  }
  const promote = (index, from) => {
    if (depth[index] >= 0 || !weak[index]) return;
    if (depth[from] + 1 > reach) return;
    depth[index] = depth[from] + 1;
    edge[index] = 1;
    queue[tail++] = index;
  };
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) promote(index - 1, index);
    if (x < width - 1) promote(index + 1, index);
    if (y > 0) promote(index - width, index);
    if (y < height - 1) promote(index + width, index);
    if (x > 0 && y > 0) promote(index - width - 1, index);
    if (x < width - 1 && y > 0) promote(index - width + 1, index);
    if (x > 0 && y < height - 1) promote(index + width - 1, index);
    if (x < width - 1 && y < height - 1) promote(index + width + 1, index);
  }

  dilate(edge, width, height, SEAL);
  return edge;
}

function erode(mask, width, height, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) next[i] = 0;
      }
    }
    mask.set(next);
  }
}

function dilate(mask, width, height, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width]) next[i] = 1;
      }
    }
    mask.set(next);
  }
}

/** Floods the background in from the frame edge, blocked by the contour. */
function floodFrom(edge, width, height) {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (index) => {
    if (mask[index] || edge[index]) return;
    mask[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  return mask;
}

/**
 * Builds the background mask from both barriers.
 *
 * The sealed barrier gives a silhouette the fill cannot breach, so it defines
 * the product. The open barrier lets the fill cross the contact shadow, so it
 * says which pixels are shadow. Intersecting them is not enough — the open pass
 * also condemns pale passages *inside* the product — so the verdict is only
 * accepted where it can be reached from the true exterior. The halo beside a
 * grip can; a touchpad sealed inside the silhouette cannot.
 */
function growBackground(lum, width, height) {
  const sealed = floodFrom(contour(lum, width, height, REACH_SEALED), width, height);
  const open = floodFrom(contour(lum, width, height, REACH_OPEN), width, height);

  // Locate the product so the shadow zone can be expressed against its own
  // height rather than the frame's.
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!sealed[y * width + x]) {
        if (y < top) top = y;
        bottom = y;
        break;
      }
    }
  }
  const zone = top + (bottom - top) * SHADOW_ZONE;

  const limit = Math.round(height * SHADOW_REACH);
  const depth = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < sealed.length; i++) {
    if (sealed[i]) {
      depth[i] = 0;
      queue[tail++] = i;
    }
  }

  const claim = (index, from) => {
    if (sealed[index] || !open[index] || depth[index] >= 0) return;
    if (Math.floor(index / width) < zone) return;
    if (depth[from] + 1 > limit) return;
    depth[index] = depth[from] + 1;
    sealed[index] = 1;
    queue[tail++] = index;
  };
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) claim(index - 1, index);
    if (x < width - 1) claim(index + 1, index);
    if (y > 0) claim(index - width, index);
    if (y < height - 1) claim(index + width, index);
  }

  // The barrier belongs to whichever side it was drawn from, so hand the
  // sealing ring back and let the cut settle on the true silhouette.
  dilate(sealed, width, height, SEAL + 1);
  return sealed;
}

/**
 * Keeps only the largest connected subject and closes holes inside it, so a
 * speck of unkeyed sweep is discarded and an enclosed highlight is recovered.
 */
function cleanSubject(background, width, height) {
  const mask = background;

  const label = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  const sizes = [];

  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] || label[seed] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    label[seed] = id;
    queue[tail++] = seed;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      const visit = (n) => {
        if (mask[n] || label[n] >= 0) return;
        label[n] = id;
        queue[tail++] = n;
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
    sizes.push(tail);
  }

  let best = -1;
  let bestSize = 0;
  sizes.forEach((size, id) => {
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  });

  const subject = new Uint8Array(width * height);
  for (let i = 0; i < subject.length; i++) subject[i] = label[i] === best ? 1 : 0;

  // Close holes: background not reachable from the frame edge sits inside the
  // subject and belongs to it.
  // Close holes: background the frame edge cannot reach is enclosed by the
  // product and belongs to it — an interior highlight, or a pale passage of
  // artwork the contour walled off. Judging these on tone was tried and
  // reverted: the whites in the Genshin touchpad read as sweep and were punched
  // straight out of the design.
  const outside = new Uint8Array(width * height);
  let head = 0;
  let tail = 0;
  const open = (index) => {
    if (outside[index] || subject[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    open(x);
    open((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    open(y * width);
    open(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) open(index - 1);
    if (x < width - 1) open(index + 1);
    if (y > 0) open(index - width);
    if (y < height - 1) open(index + width);
  }

  for (let i = 0; i < subject.length; i++) if (!outside[i]) subject[i] = 1;

  return subject;
}

/** Ramps the matte away at the product's base, taking the contact shadow with it. */
function trimBase(alpha, width, height) {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 16) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  if (bottom < 0) return;

  const band = Math.max(10, Math.round((bottom - top) * BASE_FADE));
  for (let y = Math.max(0, bottom - band); y <= bottom; y++) {
    const t = Math.min(1, Math.max(0, (bottom - y) / band));
    const ramp = 1 - t * t * (3 - 2 * t);
    for (let x = 0; x < width; x++) alpha[y * width + x] *= ramp;
  }
}

/** Blurs the binary mask and re-thresholds it into a smooth, anti-aliased edge. */
function feather(subject, width, height) {
  const count = width * height;
  let field = new Float32Array(count);
  for (let i = 0; i < count; i++) field[i] = subject[i] ? 1 : 0;

  // Two separable box passes approximate a Gaussian closely enough here, and
  // cost a fraction of one.
  for (let pass = 0; pass < 2; pass++) {
    field = boxBlur(field, width, height, EDGE_BLUR);
  }

  const alpha = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) {
    const t = Math.min(
      1,
      Math.max(0, (field[i] - EDGE_LOW_CUT) / (EDGE_HIGH_CUT - EDGE_LOW_CUT)),
    );
    alpha[i] = 255 * t * t * (3 - 2 * t);
  }
  return alpha;
}

function boxBlur(source, width, height, radius) {
  const span = radius * 2 + 1;
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        sum += source[y * width + sx];
      }
      horizontal[y * width + x] = sum / span;
    }
  }
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        sum += horizontal[sy * width + x];
      }
      result[y * width + x] = sum / span;
    }
  }
  return result;
}

mkdirSync(OUT, { recursive: true });

for (const { file, name } of SOURCES) {
  if (!existsSync(file)) {
    console.warn(`skip ${file} — source photograph not present`);
    continue;
  }

  const image = sharp(file).removeAlpha();
  const { width, height } = await image.metadata();
  const data = await image.raw().toBuffer();

  // The contour is traced on a lightly denoised copy: sensor grain of ±1.5/255
  // is enough to speckle the sweep with false edges the fill cannot cross.
  const smoothed = await sharp(file).removeAlpha().blur(1).raw().toBuffer();

  const count = width * height;
  const lum = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lum[i] = luma(smoothed[i * 3], smoothed[i * 3 + 1], smoothed[i * 3 + 2]);
  }

  const background = growBackground(lum, width, height);
  const subject = cleanSubject(background, width, height);
  const alpha = feather(subject, width, height);
  // The base fade is the last step: it only scales alpha, so nothing it does
  // can sever the subject or need re-selecting.
  trimBase(alpha, width, height);

  const rgba = Buffer.alloc(count * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
    if (alpha[i] > 16) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const pad = 6;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const cropWidth = Math.min(width - left, maxX - minX + pad * 2);
  const cropHeight = Math.min(height - top, maxY - minY + pad * 2);

  const out = join(OUT, `${name}.webp`);
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: SIZE, height: SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 95 })
    .toFile(out);

  const kept = ((subject.reduce((n, v) => n + v, 0) / count) * 100).toFixed(1);
  console.log(`${name}: ${cropWidth}×${cropHeight}, ${kept}% of frame kept → ${out}`);
}
