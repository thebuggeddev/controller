/**
 * Generates the abstract brush-stroke artwork that sits behind the product.
 *
 * Each stroke is a cubic centre-line that gets sampled and offset by a width
 * profile (a taper curve modulated by low-frequency noise), then emitted as a
 * closed path. That produces genuinely calligraphic, slightly irregular marks
 * rather than the uniform outlines a stroked path would give.
 */
import fs from 'node:fs';

const W = 1800;
const H = 900;

// Deterministic value noise so the artwork is stable between builds.
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const table = Array.from({ length: 256 }, rnd);
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = table[((i % 256) + 256) % 256];
    const b = table[(((i + 1) % 256) + 256) % 256];
    return a + (b - a) * u;
  };
}

const bez = (p, t) => {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
};

const bezTangent = (p, t) => {
  const u = 1 - t;
  return [
    3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
};

/**
 * @param pts   four control points of the centre line
 * @param width peak half-width of the stroke, in user units
 * @param opts  taper exponents at each end, noise seed and amount
 */
function strokePath(pts, width, opts = {}) {
  const {
    headTaper = 0.55,
    tailTaper = 0.85,
    seed = 1,
    wobble = 0.28,
    steps = 96,
    bias = 0,
  } = opts;
  const noise = makeNoise(seed);
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = bez(pts, t);
    const [tx, ty] = bezTangent(pts, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    // Taper: thin at both ends, fullest just past the middle like a real brush.
    const taper =
      Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.62) *
      (1 - headTaper * Math.pow(1 - t, 3)) *
      (1 - tailTaper * Math.pow(t, 4.5));
    const n = (noise(t * 7 + seed) - 0.5) * 2;
    const w = Math.max(0.6, width * taper * (1 + n * wobble));
    const skew = bias * width * 0.25;
    left.push([x + nx * (w + skew), y + ny * (w + skew)]);
    right.push([x - nx * (w - skew), y - ny * (w - skew)]);
  }
  const f = (n) => n.toFixed(1);
  const d =
    `M${f(left[0][0])} ${f(left[0][1])}` +
    left.slice(1).map((p) => `L${f(p[0])} ${f(p[1])}`).join('') +
    right.reverse().map((p) => `L${f(p[0])} ${f(p[1])}`).join('') +
    'Z';
  return d;
}

// A sweeping, script-like gesture: heavy down-strokes joined by light up-strokes,
// closing on two long trailing flicks. Mirrors the mark behind the reference product.
const STROKES = [
  { p: [[200, 250], [250, 640], [330, 720], [395, 470]], w: 58, o: { seed: 3, bias: 0.3 } },
  { p: [[380, 500], [430, 250], [455, 180], [470, 415]], w: 26, o: { seed: 11, wobble: 0.34 } },
  { p: [[455, 400], [510, 700], [600, 745], [665, 470]], w: 62, o: { seed: 5, bias: -0.2 } },
  { p: [[650, 500], [700, 240], [726, 170], [742, 430]], w: 24, o: { seed: 17 } },
  { p: [[726, 415], [790, 730], [905, 760], [980, 430]], w: 66, o: { seed: 23, bias: 0.25 } },
  { p: [[955, 470], [1010, 210], [1055, 150], [1082, 420]], w: 28, o: { seed: 31 } },
  { p: [[1065, 400], [1130, 700], [1245, 720], [1320, 300]], w: 60, o: { seed: 41, bias: -0.3 } },
  { p: [[1290, 380], [1380, 180], [1470, 150], [1560, 250]], w: 32, o: { seed: 53, tailTaper: 0.95 } },
  { p: [[300, 640], [560, 780], [980, 800], [1420, 620]], w: 16, o: { seed: 67, wobble: 0.5 } },
  { p: [[520, 180], [760, 105], [1080, 120], [1300, 210]], w: 13, o: { seed: 71, wobble: 0.55 } },
];

const paths = STROKES.map(
  (s, i) =>
    `    <path d="${strokePath(s.p, s.w, s.o)}" opacity="${(0.55 + ((i * 37) % 45) / 100).toFixed(2)}"/>`,
).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <filter id="bristle" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.021" numOctaves="4" seed="9" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="11" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="3" seed="4" result="grain"/>
      <feColorMatrix in="grain" type="matrix"
        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0 0 0 -0.16" result="grainA"/>
      <feComposite in="rough" in2="grainA" operator="in"/>
    </filter>
  </defs>
  <g fill="#ffffff" filter="url(#bristle)">
${paths}
  </g>
</svg>
`;

fs.writeFileSync('public/brush/brush-strokes.svg', svg);
console.log('wrote public/brush/brush-strokes.svg', svg.length, 'bytes');
